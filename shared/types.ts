// Types shared by the server and the dashboard.

export type AgentState = "off" | "ready" | "working" | "needs-you" | "blocked";
export type TaskStatus = "todo" | "working" | "review" | "blocked" | "done";
export type PermissionStyle = "careful" | "trusted";

export interface Project {
  id: string; // slug, e.g. "workforce-sandbox"
  repo: string; // "owner/name"
  name: string;
  prefix: string; // task id prefix, e.g. "WS"
  defaultBranch: string;
  permissionStyle: PermissionStyle;
  createdAt: string;
  /** Tools ticked in the stack picker (ids from shared/stacks.ts). */
  stack: string[];
  /** Plan boards, in order. Tasks with no board belong to the first one. */
  boards: string[];
  /** Write the plan to docs/plan.md in the lead's folder (never committed by Workforce). */
  planExport: boolean;
  /** How PRs get reviewed and merged (Settings → Workflow). */
  workflow: Workflow;
}

/** Who reviews a PR before it may be merged. Bots: agents wait for and address the bot's review.
 * "custom": Workforce runs `reviewCommand` in the author's folder on each push and sends the output back. */
export type Reviewer = "none" | "owner" | "coderabbit" | "greptile" | "copilot" | "custom";
export type MergeMethod = "squash" | "merge" | "rebase";

export interface Workflow {
  reviewer: Reviewer;
  reviewCommand: string;
  /** The owner merges (default). "lead": the lead gets a merge_pr tool, for ready PRs only. */
  mergeBy: "owner" | "lead";
  mergeMethod: MergeMethod;
  /** Optional step a worker runs before opening a PR (e.g. `npm run build`). */
  deployCommand: string;
  /** The agents that run the deploy step. */
  deployAgents: string[];
}

export const DEFAULT_WORKFLOW: Workflow = { reviewer: "owner", reviewCommand: "", mergeBy: "owner", mergeMethod: "squash", deployCommand: "", deployAgents: [] };

export type PrState = "open" | "merged" | "closed";
export type ChecksState = "passing" | "failing" | "pending" | "none";
export type ReviewState = "approved" | "changes" | "waiting" | "none";

/** A pull request Workforce saw on GitHub, linked to a task when its title starts with "[ID]". */
export interface PullRequest {
  projectId: string;
  number: number;
  taskId: string | null;
  authorId: string | null; // the agent who owns the task
  title: string;
  url: string;
  state: PrState;
  draft: boolean;
  branch: string;
  headSha: string;
  review: ReviewState;
  checks: ChecksState;
  mergeable: "yes" | "conflict" | "unknown";
  comments: number; // review comments + PR comments
  ready: boolean; // ready for the owner to merge
  updatedAt: string;
}

/** The GitHub sync for one project (Settings → Debug). */
export interface SyncStatus {
  projectId: string;
  lastAt: string | null;
  ok: boolean;
  error: string;
  nextAt: string | null;
  failures: number;
  rateRemaining: number | null;
  rateResetAt: string | null;
}

export interface Agent {
  id: string; // unique across projects: "<project>.<sign>"
  projectId: string;
  sign: string; // "leo"
  name: string; // "Leo"
  isLead: boolean;
  extraRole: string; // owner's own text, added to the role
  model: string; // "" = Claude Code's default
  role: string; // custom agents: the owner's role name ("QA"); "" = Lead / Worker
  color: string; // custom agents: shirt colour "#rrggbb"; "" = the sign's colour
  folder: string; // custom agents: an existing folder to work in; "" = Workforce's own clone
  sessionId: string; // Claude Code conversation id, kept across restarts
  state: AgentState;
  note: string;
  taskId: string | null;
  stateSince: string;
}

export interface Task {
  id: string; // "WS-3"
  projectId: string;
  title: string;
  details: string;
  files: string[];
  doneWhen: string;
  dependsOn: string[];
  phase: string; // the board the task is on ("" = the project's first board)
  status: TaskStatus;
  ownerId: string | null;
  prNumber: number | null;
  note: string;
  /** What the worker reported for the deploy step ("" = none). */
  deployResult: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  projectId: string;
  fromId: string; // agent id, "owner" or "workforce"
  toId: string; // agent id
  text: string;
  delivered: boolean;
  at: string;
}

export type NeedKind = "question" | "permission" | "trust" | "blocked" | "merge";

export interface Need {
  id: number;
  projectId: string;
  agentId: string | null;
  kind: NeedKind;
  title: string;
  details: string;
  status: "open" | "done";
  answer: string;
  at: string;
}

export interface Activity {
  id: number;
  projectId: string;
  agentId: string | null;
  text: string;
  at: string;
}

/** Live update pushed to the dashboard. */
export type LiveEvent =
  | { type: "agent"; agent: Agent }
  | { type: "task"; task: Task }
  | { type: "message"; message: Message }
  | { type: "need"; need: Need }
  | { type: "activity"; activity: Activity }
  | { type: "project"; project: Project }
  | { type: "agentRemoved"; id: string; projectId: string }
  | { type: "office"; office: Office }
  | { type: "pr"; pr: PullRequest };

/** Machine-wide settings shown in the office. */
export interface Office {
  name: string; // the sign on the office wall; "" = none yet
}

export interface Usage {
  percent: number | null; // null = unknown (no status line data yet)
  resetsAt: string | null;
  limit: number;
  pausedByOwner: boolean;
  paused: boolean; // owner paused, or at/over the limit
}

/** Everything the dashboard needs, sent once when /live connects. */
export interface LiveState {
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  needs: Need[]; // open ones
  usage: Usage;
  activity: Activity[];
  messages: Message[];
  office: Office;
  prs: PullRequest[];
}

/** What /live sends: the state first, then events. */
export type LiveFrame = { type: "init"; state: LiveState } | { type: "usage"; usage: Usage } | LiveEvent;

/** One extra MCP server the owner added (Settings → MCP). Secret values never live here: an http
 * server's header value comes from the agent's environment variable `envName`. */
export interface McpServer {
  id: number;
  name: string;
  kind: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
  headerName: string;
  envName: string;
  agentIds: string[];
}

/** One line of the setup checklist. */
export interface SetupCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** A fix from the fixed list in shared/setup.ts (the Run button), or a hint to do by hand. */
  fix?: { id: string; command: string };
  hint?: string;
}

/** A port some agent's program is listening on. */
export interface OpenPort {
  agentId: string;
  port: number;
  address: string;
  program: string;
  pid: number;
}
