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
}

export interface Agent {
  id: string; // unique across projects: "<project>.<sign>"
  projectId: string;
  sign: string; // "simha"
  name: string; // "Simha"
  isLead: boolean;
  extraRole: string; // owner's own text, added to the role
  model: string; // "" = Claude Code's default
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
  phase: string;
  status: TaskStatus;
  ownerId: string | null;
  prNumber: number | null;
  note: string;
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
  | { type: "project"; project: Project };

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
}

/** What /live sends: the state first, then events. */
export type LiveFrame = { type: "init"; state: LiveState } | { type: "usage"; usage: Usage } | LiveEvent;
