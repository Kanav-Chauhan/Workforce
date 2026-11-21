// The GitHub loop (SPEC §10). Every 30 s (sooner after an agent's turn ends) one query per project;
// each PR is matched to its task by the "[ID]" title, and what changed becomes task moves, messages
// to the author and the lead, and "ready to merge" items for the owner. Only the owner merges,
// unless the project lets the lead merge ready PRs.

import type { MergeMethod, Project, PullRequest, SyncStatus, Task, Workflow } from "../shared/types.ts";
import { now, publicPr, type PrRow } from "./db.ts";
import { ghCli, taskIdFromTitle, type FeedbackItem, type GhPort, type PrSnapshot, type RepoSnapshot } from "./github.ts";
import { agentFolder } from "./paths.ts";
import type { Store } from "./store.ts";
import type { Work } from "./work.ts";

export const SYNC_EVERY_MS = 30_000;
const SOON_MS = 4_000; // after a turn ends
const MIN_GAP_MS = 10_000; // never two syncs of one project closer than this
const MAX_BACKOFF_MS = 10 * 60_000;
const LOW_RATE = 300; // GraphQL points left this hour before we slow down

/** Review bots and how their GitHub login looks. */
export const BOT_LOGINS: Record<string, string[]> = { coderabbit: ["coderabbit"], greptile: ["greptile"], copilot: ["copilot"] };
export const REVIEWER_NAMES: Record<Workflow["reviewer"], string> = { none: "no reviewer", owner: "you", coderabbit: "CodeRabbit", greptile: "Greptile", copilot: "Copilot", custom: "a custom command" };

/** Comments the team wrote themselves start with "[Name]" (role-file rule), so they never come back to them. */
export function fromTeam(text: string, names: string[]): boolean {
  const t = text.trimStart().toLowerCase();
  return names.some((n) => t.startsWith(`[${n.toLowerCase()}]`));
}

/** The task a PR belongs to: by "[ID]" in its title, else a task that reported this PR number. */
export function matchTask(pr: Pick<PrSnapshot, "number" | "title">, prefix: string, tasks: Task[]): Task | undefined {
  const id = taskIdFromTitle(pr.title, prefix);
  if (id) {
    const t = tasks.find((x) => x.id.toUpperCase() === id);
    if (t) return t;
  }
  return tasks.find((x) => x.prNumber === pr.number);
}

/** Has the chosen review bot looked at the PR yet? */
export function botReviewed(wf: Workflow, reviewers: string[]): boolean {
  const keys = BOT_LOGINS[wf.reviewer];
  if (!keys) return true;
  return reviewers.some((l) => keys.some((k) => l.toLowerCase().includes(k)));
}

/** Ready for the owner to merge: open, not draft, no conflict, checks passing (or none), no changes
 * requested, nothing waiting on the author, and the chosen reviewer has spoken (approval counts). */
export function isReady(pr: Pick<PrSnapshot, "state" | "draft" | "checks" | "mergeable" | "review" | "reviewers">, wf: Workflow, waitingOnAuthor: boolean): boolean {
  if (pr.state !== "open" || pr.draft || waitingOnAuthor) return false;
  if (pr.checks === "failing" || pr.checks === "pending") return false;
  if (pr.mergeable === "conflict" || pr.review === "changes") return false;
  if (pr.review === "approved") return true;
  return botReviewed(wf, pr.reviewers);
}

/** New feedback for the author: unseen, not written by the team, not empty. */
export function newFeedback(items: FeedbackItem[], teamNames: string[], seen: (key: string) => boolean): FeedbackItem[] {
  return items.filter((f) => !seen(f.key) && (f.text || f.changesRequested) && !fromTeam(f.text, teamNames));
}

/** The message the author gets: what to fix, where, from whom. */
export function feedbackMessage(task: Task, pr: Pick<PrSnapshot, "number" | "branch">, items: FeedbackItem[]): string {
  const clip = (s: string) => (s.length > 700 ? `${s.slice(0, 700)}…` : s);
  const lines = items.map((f) => `- ${f.where ? `${f.where} ` : ""}(${f.kind === "check" ? "check" : f.who}${f.changesRequested ? ", changes requested" : ""}): ${clip(f.text.replace(/\s+/g, " ").trim())}`);
  return [
    `New review feedback on PR #${pr.number} (${task.id} ${task.title}):`,
    ...lines,
    `Fix it on the same branch (${pr.branch}), commit and push (never force-push). Reply on each comment thread starting with your name in brackets. Then call report with status review and pr ${pr.number}.`,
  ].join("\n");
}

/** Picks the merge method: the project's choice if the repo allows it, else the first allowed one. */
export function mergeMethodFor(wf: Workflow, allowed: MergeMethod[]): MergeMethod {
  return allowed.includes(wf.mergeMethod) || !allowed.length ? wf.mergeMethod : allowed[0]!;
}

interface Sched {
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  again: boolean;
  status: SyncStatus;
  methods: MergeMethod[];
}

export class PrSync {
  private sched = new Map<string, Sched>();
  private stopped = true;

  constructor(private store: Store, private work: Work, private gh: GhPort = ghCli) {}

  private get db() {
    return this.store.db;
  }

  // ------------------------------------------------------------ scheduling

  private s(projectId: string): Sched {
    let x = this.sched.get(projectId);
    if (!x) {
      x = { running: false, again: false, methods: [], status: { projectId, lastAt: null, ok: true, error: "", nextAt: null, failures: 0, rateRemaining: null, rateResetAt: null } };
      this.sched.set(projectId, x);
    }
    return x;
  }

  status(): SyncStatus[] {
    return this.db.projects().map((p) => ({ ...this.s(p.id).status }));
  }

  start() {
    this.stopped = false;
    let i = 0;
    for (const p of this.db.projects()) this.plan(p.id, 1500 + i++ * 2000);
  }

  stop() {
    this.stopped = true;
    for (const x of this.sched.values()) clearTimeout(x.timer);
  }

  private plan(projectId: string, ms: number) {
    if (this.stopped) return;
    const x = this.s(projectId);
    clearTimeout(x.timer);
    x.status.nextAt = new Date(Date.now() + ms).toISOString();
    x.timer = setTimeout(() => void this.tick(projectId), ms);
    x.timer.unref?.();
  }

  /** An agent's turn just ended: look at GitHub soon (it may have pushed or opened a PR). */
  soon(projectId: string) {
    const x = this.s(projectId);
    if (this.stopped || x.status.failures) return;
    const last = x.status.lastAt ? Date.parse(x.status.lastAt) : 0;
    const at = Math.max(Date.now() + SOON_MS, last + MIN_GAP_MS);
    const next = x.status.nextAt ? Date.parse(x.status.nextAt) : Infinity;
    if (at < next) this.plan(projectId, at - Date.now());
  }

  private async tick(projectId: string) {
    if (!this.db.project(projectId)) return void this.sched.delete(projectId);
    await this.syncNow(projectId);
    const st = this.s(projectId).status;
    let wait = SYNC_EVERY_MS;
    if (st.failures) wait = Math.min(MAX_BACKOFF_MS, SYNC_EVERY_MS * 2 ** st.failures);
    else if (st.rateRemaining !== null && st.rateRemaining < LOW_RATE) {
      const reset = st.rateResetAt ? Date.parse(st.rateResetAt) - Date.now() : MAX_BACKOFF_MS;
      wait = Math.max(5 * 60_000, Math.min(reset, 60 * 60_000));
    }
    this.plan(projectId, wait);
  }

  /** One sync of one project. Never throws: errors are kept for the Debug panel. */
  async syncNow(projectId: string): Promise<SyncStatus> {
    const x = this.s(projectId);
    if (x.running) {
      x.again = true;
      return x.status;
    }
    const project = this.db.project(projectId);
    if (!project) return x.status;
    x.running = true;
    try {
      const snap = await this.gh.fetchRepo(project.repo);
      x.methods = snap.mergeMethods;
      await this.apply(project, snap);
      Object.assign(x.status, { lastAt: now(), ok: true, error: "", failures: 0, rateRemaining: snap.rateRemaining, rateResetAt: snap.rateResetAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const wasOk = x.status.ok;
      Object.assign(x.status, { lastAt: now(), ok: false, error: msg.slice(0, 400), failures: x.status.failures + 1 });
      if (/rate limit/i.test(msg)) x.status.rateRemaining = 0;
      if (wasOk) this.store.activity(projectId, null, `GitHub sync failed: ${msg.slice(0, 160)}`);
    } finally {
      x.running = false;
    }
    if (x.again) {
      x.again = false;
      return this.syncNow(projectId);
    }
    return x.status;
  }

  // ------------------------------------------------------------ what changed

  /** Applies a repo snapshot. Public for tests. */
  async apply(project: Project, snap: RepoSnapshot) {
    for (const pr of snap.prs) await this.applyPr(project, pr);
  }

  private async applyPr(project: Project, snap: PrSnapshot) {
    const db = this.db;
    const prev = db.pr(project.id, snap.number);
    const tasks = db.tasks(project.id);
    // Once linked, a PR stays with its task even if the title changes.
    const task = (prev?.taskId ? tasks.find((t) => t.id === prev.taskId) : undefined) ?? matchTask(snap, project.prefix, tasks);
    // Unlinked PRs we've never seen and that are already closed are noise.
    if (!task && !prev && snap.state !== "open") return;
    const authorId = task?.ownerId ?? prev?.authorId ?? null;
    const row: PrRow = {
      projectId: project.id, number: snap.number, taskId: task?.id ?? null, authorId, title: snap.title, url: snap.url, state: snap.state, draft: snap.draft,
      branch: snap.branch, headSha: snap.headSha, review: snap.review, checks: snap.checks, mergeable: snap.mergeable,
      comments: snap.feedback.filter((f) => f.kind !== "review").length, ready: false, updatedAt: snap.updatedAt,
      feedbackSha: prev?.feedbackSha ?? "", mergeNeedId: prev?.mergeNeedId ?? null,
    };
    if (task) await this.followTask(project, task, prev, snap, row);
    else row.ready = false;
    if (!prev || JSON.stringify(publicPr(prev)) !== JSON.stringify(publicPr(row)) || prev.feedbackSha !== row.feedbackSha || prev.mergeNeedId !== row.mergeNeedId) {
      db.savePr(row);
      if (!prev || JSON.stringify(publicPr(prev)) !== JSON.stringify(publicPr(row))) this.store.emit({ type: "pr", pr: publicPr(row) });
    }
  }

  private teamNames(projectId: string) {
    return this.db.agents(projectId).map((a) => a.name);
  }

  private async followTask(project: Project, task: Task, prev: PrRow | undefined, snap: PrSnapshot, row: PrRow) {
    const db = this.db;
    const wf = project.workflow;
    const lead = this.work.lead(project.id);
    const author = row.authorId ? db.agent(row.authorId) : undefined;
    const tell = (agentId: string | undefined, text: string) => agentId && this.work.notify(agentId, text);
    const tag = `PR #${snap.number} (${task.id} ${task.title})`;

    // ---- merged or closed
    if (snap.state !== "open") {
      this.closeMergeNeed(row, snap.state === "merged" ? "Merged" : "Closed on GitHub");
      if (prev?.state === snap.state && task.status !== "review") return;
      if (snap.state === "merged" && task.status !== "done") {
        task.status = "done";
        task.prNumber = snap.number;
        task.note = `Merged as PR #${snap.number}`;
        this.store.saveTask(task);
        if (author?.taskId === task.id) this.store.updateAgent(author.id, { taskId: null });
        this.store.activity(project.id, null, `PR #${snap.number} merged · ${task.id} done`);
        tell(lead?.id, `${tag} was merged. ${task.id} is done. Assign the next task if there is one.`);
        if (author && author.id !== lead?.id) tell(author.id, `${tag} was merged. Nice work. ${task.id} is done; wait for your next task.`);
      } else if (snap.state === "closed" && task.status !== "done" && task.prNumber === snap.number && prev?.state !== "closed") {
        task.status = "todo";
        task.note = `PR #${snap.number} was closed without merging`;
        task.ownerId = null;
        this.store.saveTask(task);
        if (author?.taskId === task.id) this.store.updateAgent(author.id, { taskId: null });
        this.store.activity(project.id, null, `PR #${snap.number} closed without merging · ${task.id} back to To do`);
        tell(lead?.id, `${tag} was closed without merging, so ${task.id} is back in To do with no owner. Decide whether to re-plan or re-assign it.`);
      }
      return;
    }

    // ---- open: link it and move the task to Review
    if (task.prNumber !== snap.number || (task.status !== "review" && task.status !== "done" && !row.feedbackSha)) {
      const firstLink = task.prNumber !== snap.number || !prev;
      task.prNumber = snap.number;
      if (task.status !== "done" && !row.feedbackSha) task.status = "review";
      this.store.saveTask(task);
      if (firstLink) this.store.activity(project.id, author?.id ?? null, `PR #${snap.number} opened for ${task.id}`);
    }

    // ---- the author pushed after feedback: back to Review
    if (row.feedbackSha && snap.headSha && snap.headSha !== row.feedbackSha) {
      row.feedbackSha = "";
      if (task.status === "working") {
        task.status = "review";
        this.store.saveTask(task);
        this.store.activity(project.id, author?.id ?? null, `${author?.name ?? "The author"} pushed a fix to PR #${snap.number}`);
      }
    }

    // ---- new feedback (reviews, comments, failed checks, conflicts) goes to the author
    const items = newFeedback([...snap.feedback, ...snap.failedChecks], this.teamNames(project.id), (k) => db.seen(project.id, k));
    if (snap.mergeable === "conflict" && !db.seen(project.id, `conflict:${snap.headSha}`))
      items.push({ key: `conflict:${snap.headSha}`, who: "GitHub", kind: "check", text: `The branch has a merge conflict with ${project.defaultBranch}. Merge origin/${project.defaultBranch} into your branch, fix the conflict and push.` });
    if (items.length) {
      for (const f of items) db.markSeen(project.id, f.key);
      if (author) {
        tell(author.id, feedbackMessage(task, snap, items));
        row.feedbackSha = snap.headSha;
        if (task.status === "review") {
          task.status = "working";
          task.note = `Fixing review feedback on PR #${snap.number}`;
          this.store.saveTask(task);
        }
      }
      const who = [...new Set(items.map((f) => (f.kind === "check" ? "a check" : f.who)))].join(", ");
      this.store.activity(project.id, null, `PR #${snap.number}: ${items.length} new review item${items.length > 1 ? "s" : ""} from ${who}${author ? ` → ${author.name}` : ""}`);
    }

    // ---- custom review command: once per pushed commit, output goes back to the author
    if (wf.reviewer === "custom" && wf.reviewCommand.trim() && author && snap.headSha && !row.feedbackSha && db.markSeen(project.id, `custom:${snap.number}:${snap.headSha}`))
      void this.customReview(project, task, snap, author.id);

    // ---- ready to merge?
    row.ready = isReady(snap, wf, !!row.feedbackSha || task.status === "working");
    if (row.ready && !row.mergeNeedId) {
      const by = wf.mergeBy === "lead" ? "the lead (or you)" : "you";
      const need = this.store.addNeed(project.id, row.authorId, "merge", `PR #${snap.number} is ready to merge: ${task.id} ${task.title}`, snap.url);
      row.mergeNeedId = need.id;
      this.store.activity(project.id, null, `PR #${snap.number} is ready to merge (${by})`);
      if (db.markSeen(project.id, `ready:${snap.number}:${snap.headSha}`))
        tell(lead?.id, wf.mergeBy === "lead"
          ? `${tag} is ready: checks pass and the review is done. You may merge it with merge_pr, or leave it for the owner.`
          : `${tag} is ready to merge. The owner merges; tell them the merge order if it matters.`);
    } else if (!row.ready && row.mergeNeedId) this.closeMergeNeed(row, "No longer ready");
  }

  private closeMergeNeed(row: PrRow, why: string) {
    if (!row.mergeNeedId) return;
    const n = this.db.need(row.mergeNeedId);
    if (n?.status === "open") this.store.closeNeed(n.id, why);
    row.mergeNeedId = null;
  }

  private async customReview(project: Project, task: Task, snap: PrSnapshot, authorId: string) {
    const a = this.db.agent(authorId);
    if (!a) return;
    this.store.activity(project.id, null, `Running the review command on PR #${snap.number}`);
    const r = await this.gh.runReview(project.workflow.reviewCommand, agentFolder(a));
    const verdict = r.ok ? "passed" : "failed";
    this.store.activity(project.id, null, `Review command ${verdict} on PR #${snap.number}`);
    if (r.ok && !r.output) return;
    this.work.notify(a.id, `The review command \`${project.workflow.reviewCommand}\` ${verdict} on PR #${snap.number} (${task.id}).${r.ok ? " Its notes:" : " Fix what it reports, push, and report review again:"}\n${r.output}`);
    if (!r.ok) {
      const row = this.db.pr(project.id, snap.number);
      if (row) this.db.savePr({ ...row, feedbackSha: snap.headSha, ready: false });
      const t = this.db.task(task.id);
      if (t && t.status === "review") this.store.saveTask({ ...t, status: "working", note: `Fixing the review command's findings on PR #${snap.number}` });
    }
  }

  // ------------------------------------------------------------ merging (owner, or the lead if allowed)

  /** Merges a PR. `by` = "owner" (the dashboard's Merge button) or the lead's agent id. */
  async merge(projectId: string, number: number, by: string): Promise<PullRequest> {
    const project = this.db.project(projectId);
    if (!project) throw new Error("No such project");
    // Fresh data first, so nobody merges on a stale picture.
    await this.syncNow(projectId);
    const pr = this.db.pr(projectId, number);
    if (!pr) throw new Error(`Workforce doesn't know PR #${number} yet`);
    if (pr.state !== "open") throw new Error(`PR #${number} is already ${pr.state}`);
    if (by !== "owner") {
      if (project.workflow.mergeBy !== "lead") throw new Error("Only the owner merges in this project.");
      if (!pr.taskId) throw new Error(`PR #${number} isn't linked to a task`);
      if (!pr.ready) throw new Error(`PR #${number} isn't ready: checks must pass and the review must be done`);
    }
    if (pr.mergeable === "conflict") throw new Error(`PR #${number} has a merge conflict`);
    const method = mergeMethodFor(project.workflow, this.s(projectId).methods);
    await this.gh.merge(project.repo, number, method);
    this.store.activity(projectId, by === "owner" ? null : by, `${this.store.nameOf(by)} merged PR #${number} (${method})`);
    await this.gh.deleteBranch(project.repo, pr.branch).catch(() => {});
    await this.syncNow(projectId);
    return publicPr(this.db.pr(projectId, number)!);
  }
}
