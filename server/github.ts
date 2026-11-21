// Talking to GitHub through the machine's `gh` login: one GraphQL query per project per sync,
// parsed into plain snapshots. Pure parsing lives here so it can be tested without GitHub.

import type { ChecksState, MergeMethod, PrState, ReviewState } from "../shared/types.ts";
import { run } from "./tmux.ts";

/** Everything the sync needs about a repo's recent PRs, in one request (about 1 point of the hourly budget). */
export const PRS_QUERY = `query($owner: String!, $name: String!) {
  rateLimit { remaining resetAt cost }
  repository(owner: $owner, name: $name) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed
    pullRequests(first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title url state isDraft headRefName headRefOid mergeable reviewDecision updatedAt
        commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 30) { nodes {
          __typename
          ... on CheckRun { databaseId name conclusion detailsUrl }
          ... on StatusContext { context state targetUrl }
        } } } } } }
        reviews(last: 30) { nodes { id state body author { login } } }
        reviewThreads(last: 50) { nodes { isResolved comments(last: 20) { nodes { id databaseId body path line originalLine author { login } } } } }
        comments(last: 30) { nodes { id body author { login } } }
      }
    }
  }
}`;

/** One piece of feedback on a PR: a review, an inline comment, a PR comment or a failed check. */
export interface FeedbackItem {
  key: string; // unique per project, for "only new ones"
  who: string; // GitHub login or check name
  kind: "review" | "inline" | "comment" | "check";
  text: string;
  where?: string; // "path:line" for inline comments
  changesRequested?: boolean;
}

export interface PrSnapshot {
  number: number;
  title: string;
  url: string;
  state: PrState;
  draft: boolean;
  branch: string;
  headSha: string;
  review: ReviewState;
  checks: ChecksState;
  mergeable: "yes" | "conflict" | "unknown";
  updatedAt: string;
  /** Reviews, inline comments and PR comments, oldest first. */
  feedback: FeedbackItem[];
  /** Failed checks on the head commit (keyed by commit). */
  failedChecks: FeedbackItem[];
  /** Logins that left a review or comment (to know whether a review bot has spoken). */
  reviewers: string[];
}

export interface RepoSnapshot {
  prs: PrSnapshot[];
  mergeMethods: MergeMethod[];
  rateRemaining: number | null;
  rateResetAt: string | null;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const nodes = (x: J | undefined | null): J[] => (Array.isArray(x?.nodes) ? x!.nodes.filter(Boolean) : []);
const login = (x: J | undefined | null) => String(x?.author?.login ?? "ghost");

const CHECKS: Record<string, ChecksState> = { SUCCESS: "passing", FAILURE: "failing", ERROR: "failing", PENDING: "pending", EXPECTED: "pending" };
const REVIEW: Record<string, ReviewState> = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "waiting" };
const MERGEABLE: Record<string, "yes" | "conflict" | "unknown"> = { MERGEABLE: "yes", CONFLICTING: "conflict" };

/** Parses `gh api graphql` output for PRS_QUERY. Throws a readable error for GitHub errors. */
export function parseRepo(json: string): RepoSnapshot {
  const data = JSON.parse(json) as J;
  if (data.errors?.length) throw new Error(`GitHub: ${data.errors.map((e: J) => e.message).join("; ")}`);
  const repo = data.data?.repository;
  if (!repo) throw new Error("GitHub returned no repository (is the gh login allowed to see it?)");
  const methods: MergeMethod[] = [];
  if (repo.squashMergeAllowed) methods.push("squash");
  if (repo.mergeCommitAllowed) methods.push("merge");
  if (repo.rebaseMergeAllowed) methods.push("rebase");
  const rate = data.data?.rateLimit;
  return { prs: nodes(repo.pullRequests).map(parsePr), mergeMethods: methods, rateRemaining: rate ? Number(rate.remaining) : null, rateResetAt: rate?.resetAt ?? null };
}

export function parsePr(n: J): PrSnapshot {
  const commit = nodes(n.commits)[0]?.commit;
  const rollup = commit?.statusCheckRollup;
  const headSha = String(n.headRefOid ?? commit?.oid ?? "");
  const feedback: FeedbackItem[] = [];
  const reviewers = new Set<string>();
  for (const r of nodes(n.reviews)) {
    reviewers.add(login(r));
    const body = String(r.body ?? "").trim();
    // An approval is not feedback; a review with only inline comments shows up through its threads.
    if (r.state === "CHANGES_REQUESTED" || (r.state === "COMMENTED" && body))
      feedback.push({ key: `review:${r.id}`, who: login(r), kind: "review", text: body || "Changes requested (see the inline comments).", changesRequested: r.state === "CHANGES_REQUESTED" });
  }
  for (const t of nodes(n.reviewThreads)) {
    if (t.isResolved) continue;
    for (const c of nodes(t.comments)) {
      reviewers.add(login(c));
      const line = c.line ?? c.originalLine;
      feedback.push({ key: `inline:${c.id}`, who: login(c), kind: "inline", text: String(c.body ?? "").trim(), where: c.path ? `${c.path}${line ? `:${line}` : ""}` : undefined });
    }
  }
  for (const c of nodes(n.comments)) {
    reviewers.add(login(c));
    feedback.push({ key: `comment:${c.id}`, who: login(c), kind: "comment", text: String(c.body ?? "").trim() });
  }
  const failedChecks: FeedbackItem[] = [];
  for (const c of nodes(rollup?.contexts)) {
    const failed = c.__typename === "CheckRun" ? ["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(c.conclusion) : ["FAILURE", "ERROR"].includes(c.state);
    if (!failed) continue;
    const name = String(c.name ?? c.context ?? "check");
    failedChecks.push({ key: `check:${headSha}:${name}`, who: name, kind: "check", text: `The check "${name}" failed${c.detailsUrl || c.targetUrl ? `: ${c.detailsUrl || c.targetUrl}` : ""}` });
  }
  const state: PrState = n.state === "MERGED" ? "merged" : n.state === "CLOSED" ? "closed" : "open";
  return {
    number: Number(n.number),
    title: String(n.title ?? ""),
    url: String(n.url ?? ""),
    state,
    draft: !!n.isDraft,
    branch: String(n.headRefName ?? ""),
    headSha,
    review: REVIEW[String(n.reviewDecision)] ?? "none",
    checks: rollup ? CHECKS[String(rollup.state)] ?? "pending" : "none",
    mergeable: MERGEABLE[String(n.mergeable)] ?? "unknown",
    updatedAt: String(n.updatedAt ?? ""),
    feedback,
    failedChecks,
    reviewers: [...reviewers],
  };
}

/** "[WS-3] Add footer" → "WS-3" (only ids with the project's prefix). */
export function taskIdFromTitle(title: string, prefix: string): string | null {
  const m = /^\s*\[([A-Za-z0-9]+-\d+)\]/.exec(title);
  if (!m) return null;
  const id = m[1]!.toUpperCase();
  return id.startsWith(`${prefix.toUpperCase()}-`) ? id : null;
}

/** What the sync needs from GitHub. Swapped for a fake in tests. */
export interface GhPort {
  fetchRepo(repo: string): Promise<RepoSnapshot>;
  merge(repo: string, number: number, method: MergeMethod): Promise<void>;
  deleteBranch(repo: string, branch: string): Promise<void>;
  /** Runs the owner's custom review command in a folder. */
  runReview(command: string, cwd: string): Promise<{ ok: boolean; output: string }>;
}

export const ghCli: GhPort = {
  async fetchRepo(repo) {
    const [owner, name] = repo.split("/");
    const r = await run("gh", ["api", "graphql", "-f", `query=${PRS_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`], { timeoutMs: 30_000 });
    if (!r.ok && !r.stdout.trim().startsWith("{")) throw new Error(r.stderr.trim().split("\n").slice(-2).join(" ") || "gh api failed");
    return parseRepo(r.stdout);
  },
  async merge(repo, number, method) {
    const r = await run("gh", ["pr", "merge", String(number), "--repo", repo, `--${method}`], { timeoutMs: 60_000 });
    if (!r.ok) throw new Error(r.stderr.trim() || "gh pr merge failed");
  },
  async deleteBranch(repo, branch) {
    if (!branch) return;
    await run("gh", ["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${branch}`], { timeoutMs: 30_000 });
  },
  async runReview(command, cwd) {
    const r = await run("bash", ["-lc", command], { cwd, timeoutMs: 5 * 60_000 });
    const output = `${r.stdout}\n${r.stderr}`.trim();
    return { ok: r.ok, output: output.length > 3000 ? `…${output.slice(-3000)}` : output };
  },
};
