import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW, type MergeMethod, type Project, type Workflow } from "../shared/types.ts";
import { roleText } from "./agentFiles.ts";
import { Courier } from "./courier.ts";
import { Db, now } from "./db.ts";
import { parsePr, parseRepo, taskIdFromTitle, type GhPort, type PrSnapshot, type RepoSnapshot } from "./github.ts";
import { checkWorkflow } from "./http.ts";
import { feedbackMessage, fromTeam, isReady, matchTask, mergeMethodFor, newFeedback, PrSync } from "./prSync.ts";
import { Projects } from "./projects.ts";
import { Store } from "./store.ts";
import { Work } from "./work.ts";

// ------------------------------------------------------------------ a fake GitHub

class FakeGh implements GhPort {
  repo: RepoSnapshot = { prs: [], mergeMethods: ["squash", "merge"], rateRemaining: 4900, rateResetAt: null };
  merged: { number: number; method: MergeMethod }[] = [];
  deleted: string[] = [];
  fail = "";
  async fetchRepo() {
    if (this.fail) throw new Error(this.fail);
    return structuredClone(this.repo);
  }
  async merge(_repo: string, number: number, method: MergeMethod) {
    this.merged.push({ number, method });
    const pr = this.repo.prs.find((p) => p.number === number)!;
    pr.state = "merged";
  }
  async deleteBranch(_repo: string, branch: string) {
    this.deleted.push(branch);
  }
  async runReview() {
    return { ok: false, output: "lint: 1 error in a.ts" };
  }
}

const snap = (patch: Partial<PrSnapshot> = {}): PrSnapshot => ({
  number: 7, title: "[DM-1] Add CONTRIBUTING.md", url: "https://github.com/me/demo/pull/7", state: "open", draft: false, branch: "dm-1", headSha: "aaa",
  review: "none", checks: "none", mergeable: "yes", updatedAt: now(), feedback: [], failedChecks: [], reviewers: [], ...patch,
});

function setup(workflow: Partial<Workflow> = {}) {
  const db = new Db(":memory:");
  const store = new Store(db);
  const courier = new Courier(store, { put: async () => true, submit: async () => true });
  const work = new Work(store, courier);
  const projects = new Projects(store);
  const project: Project = { id: "demo", repo: "me/demo", name: "demo", prefix: "DM", defaultBranch: "main", permissionStyle: "careful", createdAt: now(), stack: [], boards: ["Main"], planExport: false, workflow: { ...DEFAULT_WORKFLOW, ...workflow } };
  db.addProject(project);
  for (const sign of ["leo", "aries"]) projects.addAgent("demo", sign);
  const gh = new FakeGh();
  const sync = new PrSync(store, work, gh);
  const task = work.createTask("demo", { title: "Add CONTRIBUTING.md" }, "demo.leo");
  work.assign("demo", task.id, "aries", "demo.leo");
  work.myTask("demo.aries");
  const inbox = (id: string) => db.pendingMessages(id).map((m) => m.text);
  return { db, store, work, gh, sync, project, task, inbox };
}

describe("PR ↔ task matching", () => {
  it("reads [ID] from the start of the title, only with the project's prefix", () => {
    expect(taskIdFromTitle("[DM-3] Footer", "DM")).toBe("DM-3");
    expect(taskIdFromTitle("  [dm-12] lower", "DM")).toBe("DM-12");
    expect(taskIdFromTitle("Footer [DM-3]", "DM")).toBeNull();
    expect(taskIdFromTitle("[XY-3] other project", "DM")).toBeNull();
  });
  it("falls back to the PR number the worker reported", () => {
    const t = { id: "DM-2", prNumber: 9 } as never;
    expect(matchTask({ number: 9, title: "no id" }, "DM", [t])).toBe(t);
    expect(matchTask({ number: 8, title: "no id" }, "DM", [t])).toBeUndefined();
  });
});

describe("parsing GitHub's answer", () => {
  it("turns reviews, threads, comments and checks into feedback", () => {
    const pr = parsePr({
      number: 4, title: "[DM-1] x", url: "u", state: "OPEN", isDraft: false, headRefName: "dm-1", headRefOid: "abc", mergeable: "MERGEABLE", reviewDecision: "CHANGES_REQUESTED",
      commits: { nodes: [{ commit: { oid: "abc", statusCheckRollup: { state: "FAILURE", contexts: { nodes: [{ __typename: "CheckRun", name: "test", conclusion: "FAILURE", detailsUrl: "d" }, { __typename: "CheckRun", name: "lint", conclusion: "SUCCESS" }] } } } }] },
      reviews: { nodes: [{ id: "R1", state: "CHANGES_REQUESTED", body: "Please shorten", author: { login: "kanav" } }, { id: "R2", state: "APPROVED", body: "", author: { login: "x" } }, { id: "R3", state: "COMMENTED", body: "", author: { login: "coderabbitai" } }] },
      reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ id: "C1", body: "Typo", path: "CONTRIBUTING.md", line: 3, author: { login: "coderabbitai" } }] } }, { isResolved: true, comments: { nodes: [{ id: "C2", body: "old", path: "a", line: 1 }] } }] },
      comments: { nodes: [{ id: "I1", body: "[Aries] Fixed", author: { login: "kanav" } }] },
    });
    expect(pr.review).toBe("changes");
    expect(pr.checks).toBe("failing");
    expect(pr.feedback.map((f) => f.key)).toEqual(["review:R1", "inline:C1", "comment:I1"]);
    expect(pr.feedback[1]!.where).toBe("CONTRIBUTING.md:3");
    expect(pr.failedChecks.map((f) => f.key)).toEqual(["check:abc:test"]);
    expect(pr.reviewers).toContain("coderabbitai");
  });
  it("reads merge methods and the rate limit; GitHub errors become readable", () => {
    const r = parseRepo(JSON.stringify({ data: { rateLimit: { remaining: 4000, resetAt: "z" }, repository: { squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true, pullRequests: { nodes: [] } } } }));
    expect(r.mergeMethods).toEqual(["merge", "rebase"]);
    expect(r.rateRemaining).toBe(4000);
    expect(() => parseRepo(JSON.stringify({ errors: [{ message: "API rate limit exceeded" }] }))).toThrow(/rate limit/);
  });
});

describe("feedback dedupe and readiness", () => {
  it("skips seen items and the team's own [Name] comments", () => {
    const items = [
      { key: "a", who: "kanav", kind: "comment" as const, text: "Fix the title" },
      { key: "b", who: "kanav", kind: "comment" as const, text: "[Aries] Done" },
      { key: "c", who: "kanav", kind: "comment" as const, text: "seen before" },
    ];
    expect(newFeedback(items, ["Leo", "Aries"], (k) => k === "c").map((f) => f.key)).toEqual(["a"]);
    expect(fromTeam("  [leo] hi", ["Leo"])).toBe(true);
  });
  it("is ready only when checks pass, nothing is waiting, and the chosen reviewer has spoken", () => {
    const base = snap();
    expect(isReady(base, DEFAULT_WORKFLOW, false)).toBe(true);
    expect(isReady(base, DEFAULT_WORKFLOW, true)).toBe(false);
    expect(isReady({ ...base, checks: "pending" }, DEFAULT_WORKFLOW, false)).toBe(false);
    expect(isReady({ ...base, mergeable: "conflict" }, DEFAULT_WORKFLOW, false)).toBe(false);
    const rabbit = { ...DEFAULT_WORKFLOW, reviewer: "coderabbit" as const };
    expect(isReady(base, rabbit, false)).toBe(false);
    expect(isReady({ ...base, reviewers: ["coderabbitai"] }, rabbit, false)).toBe(true);
  });
  it("merge method follows the project, within what the repo allows", () => {
    expect(mergeMethodFor(DEFAULT_WORKFLOW, ["squash", "merge"])).toBe("squash");
    expect(mergeMethodFor(DEFAULT_WORKFLOW, ["merge"])).toBe("merge");
  });
  it("the feedback message names the file:line, who and what", () => {
    const m = feedbackMessage({ id: "DM-1", title: "t" } as never, { number: 7, branch: "dm-1" }, [{ key: "k", who: "coderabbitai", kind: "inline", text: "Use a list", where: "a.md:2" }]);
    expect(m).toContain("a.md:2 (coderabbitai): Use a list");
    expect(m).toContain("same branch (dm-1)");
  });
});

describe("the GitHub loop", () => {
  it("ignores an old merged PR that reuses a new task's id", async () => {
    const { db, gh, sync, task } = setup();
    gh.repo.prs = [snap({ state: "merged", updatedAt: "2020-01-01T00:00:00.000Z" })];
    await sync.syncNow("demo");
    expect(db.task(task.id)!.status).toBe("working");
    expect(db.task(task.id)!.prNumber).toBeNull();
  });

  it("links a PR, sends new review comments once, waits for the push, then offers the merge", async () => {
    const { db, gh, sync, task, inbox } = setup();
    gh.repo.prs = [snap()];
    await sync.syncNow("demo");
    expect(db.task(task.id)!.status).toBe("review");
    expect(db.task(task.id)!.prNumber).toBe(7);
    const merge1 = db.openNeeds("demo").find((n) => n.kind === "merge");
    expect(merge1?.title).toContain("PR #7 is ready");
    expect(inbox("demo.leo").some((t) => t.includes("ready to merge"))).toBe(true);

    // The owner leaves a comment: it reaches Aries once; the task goes back to Working; no merge item.
    gh.repo.prs[0]!.feedback = [{ key: "review:R1", who: "kanav", kind: "review", text: "Make rule 2 shorter" }];
    await sync.syncNow("demo");
    await sync.syncNow("demo");
    const toAries = inbox("demo.aries").filter((t) => t.includes("Make rule 2 shorter"));
    expect(toAries).toHaveLength(1);
    expect(db.task(task.id)!.status).toBe("working");
    expect(db.openNeeds("demo").some((n) => n.kind === "merge")).toBe(false);

    // Aries replies on GitHub ([Aries] …) and pushes: back to Review, ready again, the reply isn't sent back.
    gh.repo.prs[0]!.feedback.push({ key: "comment:I9", who: "kanav", kind: "comment", text: "[Aries] Done, shortened." });
    gh.repo.prs[0]!.headSha = "bbb";
    await sync.syncNow("demo");
    expect(db.task(task.id)!.status).toBe("review");
    expect(inbox("demo.aries").some((t) => t.includes("Done, shortened"))).toBe(false);
    expect(db.openNeeds("demo").some((n) => n.kind === "merge")).toBe(true);

    // The owner merges from the dashboard: squash, branch deleted, task Done, lead told, item closed.
    const pr = await sync.merge("demo", 7, "owner");
    expect(pr.state).toBe("merged");
    expect(gh.merged).toEqual([{ number: 7, method: "squash" }]);
    expect(gh.deleted).toEqual(["dm-1"]);
    expect(db.task(task.id)!.status).toBe("done");
    expect(db.agent("demo.aries")!.taskId).toBeNull();
    expect(inbox("demo.leo").some((t) => t.includes("was merged"))).toBe(true);
    expect(db.openNeeds("demo").some((n) => n.kind === "merge")).toBe(false);
  });

  it("a failed check goes to the author once per commit", async () => {
    const { gh, sync, inbox } = setup();
    gh.repo.prs = [snap({ checks: "failing", failedChecks: [{ key: "check:aaa:test", who: "test", kind: "check", text: 'The check "test" failed' }] })];
    await sync.syncNow("demo");
    await sync.syncNow("demo");
    expect(inbox("demo.aries").filter((t) => t.includes('"test" failed'))).toHaveLength(1);
  });

  it("closed without merge: task back to To do with a note, the lead is told", async () => {
    const { db, gh, sync, task, inbox } = setup();
    gh.repo.prs = [snap()];
    await sync.syncNow("demo");
    gh.repo.prs[0]!.state = "closed";
    await sync.syncNow("demo");
    const t = db.task(task.id)!;
    expect(t.status).toBe("todo");
    expect(t.note).toContain("closed without merging");
    expect(inbox("demo.leo").some((x) => x.includes("closed without merging"))).toBe(true);
  });

  it("only the owner merges unless lead-merge is on, and then only ready PRs", async () => {
    const { gh, sync } = setup();
    gh.repo.prs = [snap({ checks: "pending" })];
    await expect(sync.merge("demo", 7, "demo.leo")).rejects.toThrow(/Only the owner/);
    const on = setup({ mergeBy: "lead" });
    on.gh.repo.prs = [snap({ checks: "pending" })];
    await expect(on.sync.merge("demo", 7, "demo.leo")).rejects.toThrow(/isn't ready/);
    on.gh.repo.prs[0]!.checks = "passing";
    expect((await on.sync.merge("demo", 7, "demo.leo")).state).toBe("merged");
  });

  it("keeps errors for Debug and backs off", async () => {
    const { gh, sync } = setup();
    gh.fail = "HTTP 502";
    const st = await sync.syncNow("demo");
    expect(st.ok).toBe(false);
    expect(st.error).toContain("502");
    expect(st.failures).toBe(1);
    gh.fail = "";
    expect((await sync.syncNow("demo")).failures).toBe(0);
  });
});

describe("workflow settings", () => {
  it("validates and defaults", () => {
    const { project } = setup();
    expect(project.workflow.mergeBy).toBe("owner");
    expect(() => checkWorkflow(project, { reviewer: "custom" })).toThrow(/command/);
    expect(checkWorkflow(project, { reviewer: "coderabbit", deployCommand: "npm run build\nrm -rf /" }).deployCommand).toBe("npm run build rm -rf /");
  });
  it("role files follow the loop: [ID] title, same branch, never merge; merge_pr only when allowed", () => {
    const { db, project } = setup({ deployCommand: "npm run build", deployAgents: ["demo.aries"] });
    const team = db.agents("demo");
    const aries = roleText(team[1]!, project, team);
    expect(aries).toContain("`[TASK-ID] title`");
    expect(aries).toContain("SAME branch");
    expect(aries).toContain("Never merge");
    expect(aries).toContain("npm run build");
    expect(roleText(team[0]!, project, team)).not.toContain("merge_pr");
    expect(roleText(team[0]!, { ...project, workflow: { ...project.workflow, mergeBy: "lead" } }, team)).toContain("merge_pr");
  });
});
