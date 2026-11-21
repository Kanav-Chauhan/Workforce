// One SQLite file holds everything (Node's built-in node:sqlite, nothing to install).
// Small typed helpers per table; every change goes through `store` so it can be broadcast.

import { DatabaseSync } from "node:sqlite";
import { DEFAULT_WORKFLOW } from "../shared/types.ts";
import type { Activity, Agent, AgentState, McpServer, Message, Need, NeedKind, PermissionStyle, Project, PullRequest, Task, TaskStatus, Workflow } from "../shared/types.ts";
import { dbFile, ensureDir, home } from "./paths.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, repo TEXT NOT NULL UNIQUE, name TEXT NOT NULL, prefix TEXT NOT NULL,
  default_branch TEXT NOT NULL, permission_style TEXT NOT NULL DEFAULT 'careful', created_at TEXT NOT NULL,
  task_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sign TEXT NOT NULL, name TEXT NOT NULL, is_lead INTEGER NOT NULL DEFAULT 0, extra_role TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'off', note TEXT NOT NULL DEFAULT '', task_id TEXT, state_since TEXT NOT NULL,
  UNIQUE (project_id, sign)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]', done_when TEXT NOT NULL DEFAULT '',
  depends_on TEXT NOT NULL DEFAULT '[]', phase TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo',
  owner_id TEXT, pr_number INTEGER, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  text TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_pending ON messages (to_id, delivered);
CREATE TABLE IF NOT EXISTS needs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, agent_id TEXT, kind TEXT NOT NULL,
  title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', answer TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, agent_id TEXT, text TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, command TEXT NOT NULL DEFAULT '',
  args TEXT NOT NULL DEFAULT '[]', url TEXT NOT NULL DEFAULT '', header_name TEXT NOT NULL DEFAULT '', env_name TEXT NOT NULL DEFAULT '',
  agent_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS prs (
  project_id TEXT NOT NULL, number INTEGER NOT NULL, task_id TEXT, author_id TEXT, title TEXT NOT NULL, url TEXT NOT NULL,
  state TEXT NOT NULL, draft INTEGER NOT NULL DEFAULT 0, branch TEXT NOT NULL DEFAULT '', head_sha TEXT NOT NULL DEFAULT '',
  review TEXT NOT NULL DEFAULT 'none', checks TEXT NOT NULL DEFAULT 'none', mergeable TEXT NOT NULL DEFAULT 'unknown',
  comments INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  feedback_sha TEXT NOT NULL DEFAULT '', merge_need_id INTEGER,
  PRIMARY KEY (project_id, number)
);
CREATE TABLE IF NOT EXISTS pr_seen (project_id TEXT NOT NULL, key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project_id, key));
`;

/** Columns added after the first release: added to older databases on open. */
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ["projects", "stack", "TEXT NOT NULL DEFAULT '[]'"],
  ["projects", "boards", "TEXT NOT NULL DEFAULT '[]'"],
  ["projects", "plan_export", "INTEGER NOT NULL DEFAULT 0"],
  ["agents", "role", "TEXT NOT NULL DEFAULT ''"],
  ["agents", "color", "TEXT NOT NULL DEFAULT ''"],
  ["agents", "folder", "TEXT NOT NULL DEFAULT ''"],
  ["projects", "workflow", "TEXT NOT NULL DEFAULT '{}'"],
  ["tasks", "deploy_result", "TEXT NOT NULL DEFAULT ''"],
];

export const now = () => new Date().toISOString();

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

const toProject = (r: Row): Project => ({
  id: s(r.id), repo: s(r.repo), name: s(r.name), prefix: s(r.prefix), defaultBranch: s(r.default_branch),
  permissionStyle: s(r.permission_style) as PermissionStyle, createdAt: s(r.created_at),
  stack: json(r.stack, []), boards: json(r.boards, []), planExport: !!r.plan_export,
  workflow: { ...DEFAULT_WORKFLOW, ...json<Partial<Workflow>>(r.workflow, {}) },
});
const toAgent = (r: Row): Agent => ({
  id: s(r.id), projectId: s(r.project_id), sign: s(r.sign), name: s(r.name), isLead: !!r.is_lead,
  extraRole: s(r.extra_role), model: s(r.model), role: s(r.role), color: s(r.color), folder: s(r.folder), sessionId: s(r.session_id), state: s(r.state) as AgentState,
  note: s(r.note), taskId: r.task_id == null ? null : s(r.task_id), stateSince: s(r.state_since),
});
const toTask = (r: Row): Task => ({
  id: s(r.id), projectId: s(r.project_id), title: s(r.title), details: s(r.details), files: json(r.files, []),
  doneWhen: s(r.done_when), dependsOn: json(r.depends_on, []), phase: s(r.phase), status: s(r.status) as TaskStatus,
  ownerId: r.owner_id == null ? null : s(r.owner_id), prNumber: r.pr_number == null ? null : Number(r.pr_number),
  note: s(r.note), deployResult: s(r.deploy_result), createdAt: s(r.created_at), updatedAt: s(r.updated_at),
});
/** A PR row plus the sync's own bookkeeping. */
export interface PrRow extends PullRequest {
  feedbackSha: string; // head commit when feedback was last sent ("" = none waiting)
  mergeNeedId: number | null;
}
const toPr = (r: Row): PrRow => ({
  projectId: s(r.project_id), number: Number(r.number), taskId: r.task_id == null ? null : s(r.task_id), authorId: r.author_id == null ? null : s(r.author_id),
  title: s(r.title), url: s(r.url), state: s(r.state) as PullRequest["state"], draft: !!r.draft, branch: s(r.branch), headSha: s(r.head_sha),
  review: s(r.review) as PullRequest["review"], checks: s(r.checks) as PullRequest["checks"], mergeable: s(r.mergeable) as PullRequest["mergeable"],
  comments: Number(r.comments), ready: !!r.ready, updatedAt: s(r.updated_at), feedbackSha: s(r.feedback_sha), mergeNeedId: r.merge_need_id == null ? null : Number(r.merge_need_id),
});
/** What the dashboard sees of a PR row. */
export const publicPr = ({ feedbackSha: _f, mergeNeedId: _m, ...pr }: PrRow): PullRequest => pr;
const toMessage = (r: Row): Message => ({
  id: Number(r.id), projectId: s(r.project_id), fromId: s(r.from_id), toId: s(r.to_id), text: s(r.text), delivered: !!r.delivered, at: s(r.at),
});
const toNeed = (r: Row): Need => ({
  id: Number(r.id), projectId: s(r.project_id), agentId: r.agent_id == null ? null : s(r.agent_id), kind: s(r.kind) as NeedKind,
  title: s(r.title), details: s(r.details), status: s(r.status) as Need["status"], answer: s(r.answer), at: s(r.at),
});
const toMcp = (r: Row): McpServer => ({
  id: Number(r.id), name: s(r.name), kind: s(r.kind) === "http" ? "http" : "stdio", command: s(r.command), args: json(r.args, []),
  url: s(r.url), headerName: s(r.header_name), envName: s(r.env_name), agentIds: json(r.agent_ids, []),
});
const toActivity = (r: Row): Activity => ({ id: Number(r.id), projectId: s(r.project_id), agentId: r.agent_id == null ? null : s(r.agent_id), text: s(r.text), at: s(r.at) });

export class Db {
  readonly sql: DatabaseSync;

  constructor(file = dbFile()) {
    if (file !== ":memory:") ensureDir(home());
    this.sql = new DatabaseSync(file);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.sql.exec(SCHEMA);
    for (const [table, column, type] of ADDED_COLUMNS) {
      const has = (this.sql.prepare(`PRAGMA table_info(${table})`).all() as Row[]).some((c) => c.name === column);
      if (!has) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  private all(q: string, ...p: (string | number | null)[]) {
    return this.sql.prepare(q).all(...p) as Row[];
  }
  private one(q: string, ...p: (string | number | null)[]) {
    return this.sql.prepare(q).get(...p) as Row | undefined;
  }
  private run(q: string, ...p: (string | number | null)[]) {
    return this.sql.prepare(q).run(...p);
  }

  // -------------------------------------------------------------- projects

  projects(): Project[] {
    return this.all("SELECT * FROM projects ORDER BY created_at").map(toProject);
  }
  project(id: string): Project | undefined {
    const r = this.one("SELECT * FROM projects WHERE id = ?", id);
    return r && toProject(r);
  }
  addProject(p: Project) {
    this.run(
      "INSERT INTO projects (id, repo, name, prefix, default_branch, permission_style, created_at, stack, boards, plan_export, workflow) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      p.id, p.repo, p.name, p.prefix, p.defaultBranch, p.permissionStyle, p.createdAt, JSON.stringify(p.stack), JSON.stringify(p.boards), p.planExport ? 1 : 0, JSON.stringify(p.workflow ?? DEFAULT_WORKFLOW),
    );
  }
  setPermissionStyle(id: string, style: PermissionStyle) {
    this.run("UPDATE projects SET permission_style = ? WHERE id = ?", style, id);
  }
  updateProject(id: string, patch: Partial<Pick<Project, "stack" | "boards" | "planExport" | "permissionStyle" | "workflow">>) {
    if (patch.workflow) this.run("UPDATE projects SET workflow = ? WHERE id = ?", JSON.stringify(patch.workflow), id);
    if (patch.stack) this.run("UPDATE projects SET stack = ? WHERE id = ?", JSON.stringify(patch.stack), id);
    if (patch.boards) this.run("UPDATE projects SET boards = ? WHERE id = ?", JSON.stringify(patch.boards), id);
    if (patch.planExport !== undefined) this.run("UPDATE projects SET plan_export = ? WHERE id = ?", patch.planExport ? 1 : 0, id);
    if (patch.permissionStyle) this.setPermissionStyle(id, patch.permissionStyle);
  }
  /** Next task number for a project (WS-1, WS-2, …). */
  nextTaskNumber(projectId: string): number {
    this.run("UPDATE projects SET task_seq = task_seq + 1 WHERE id = ?", projectId);
    return Number(this.one("SELECT task_seq FROM projects WHERE id = ?", projectId)?.task_seq ?? 1);
  }

  // -------------------------------------------------------------- agents

  agents(projectId?: string): Agent[] {
    const rows = projectId
      ? this.all("SELECT * FROM agents WHERE project_id = ? ORDER BY is_lead DESC, rowid", projectId)
      : this.all("SELECT * FROM agents ORDER BY project_id, is_lead DESC, rowid");
    return rows.map(toAgent);
  }
  agent(id: string): Agent | undefined {
    const r = this.one("SELECT * FROM agents WHERE id = ?", id);
    return r && toAgent(r);
  }
  agentByToken(token: string): Agent | undefined {
    if (!token) return undefined;
    const r = this.one("SELECT * FROM agents WHERE token = ?", token);
    return r && toAgent(r);
  }
  agentToken(id: string): string {
    return s(this.one("SELECT token FROM agents WHERE id = ?", id)?.token);
  }
  addAgent(a: Agent, token: string) {
    this.run(
      "INSERT INTO agents (id, project_id, sign, name, is_lead, extra_role, model, role, color, folder, session_id, token, state, note, task_id, state_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      a.id, a.projectId, a.sign, a.name, a.isLead ? 1 : 0, a.extraRole, a.model, a.role, a.color, a.folder, a.sessionId, token, a.state, a.note, a.taskId, a.stateSince,
    );
  }
  updateAgent(id: string, patch: Partial<Pick<Agent, "state" | "note" | "taskId" | "stateSince" | "extraRole" | "model" | "name" | "sessionId">>) {
    const cols: Record<string, string> = { state: "state", note: "note", taskId: "task_id", stateSince: "state_since", extraRole: "extra_role", model: "model", name: "name", sessionId: "session_id" };
    const keys = Object.keys(patch).filter((k) => k in cols && patch[k as keyof typeof patch] !== undefined);
    if (!keys.length) return;
    const set = keys.map((k) => `${cols[k]} = ?`).join(", ");
    const vals = keys.map((k) => patch[k as keyof typeof patch] as string | null);
    this.run(`UPDATE agents SET ${set} WHERE id = ?`, ...vals, id);
  }
  removeAgent(id: string) {
    this.run("DELETE FROM agents WHERE id = ?", id);
    this.run("UPDATE tasks SET owner_id = NULL, status = CASE WHEN status IN ('working', 'blocked') THEN 'todo' ELSE status END WHERE owner_id = ?", id);
    for (const m of this.mcpServers()) if (m.agentIds.includes(id)) this.saveMcpServer({ ...m, agentIds: m.agentIds.filter((x) => x !== id) });
  }

  // -------------------------------------------------------------- extra MCP servers

  mcpServers(): McpServer[] {
    return this.all("SELECT * FROM mcp_servers ORDER BY name").map(toMcp);
  }
  /** Adds (id 0) or replaces a server; returns it with its id. */
  saveMcpServer(m: McpServer): McpServer {
    const vals = [m.name, m.kind, m.command, JSON.stringify(m.args), m.url, m.headerName, m.envName, JSON.stringify(m.agentIds)] as const;
    if (m.id) {
      this.run("UPDATE mcp_servers SET name = ?, kind = ?, command = ?, args = ?, url = ?, header_name = ?, env_name = ?, agent_ids = ? WHERE id = ?", ...vals, m.id);
      return m;
    }
    const r = this.run("INSERT INTO mcp_servers (name, kind, command, args, url, header_name, env_name, agent_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ...vals);
    return { ...m, id: Number(r.lastInsertRowid) };
  }
  removeMcpServer(id: number) {
    this.run("DELETE FROM mcp_servers WHERE id = ?", id);
  }

  // -------------------------------------------------------------- tasks

  tasks(projectId: string): Task[] {
    return this.all("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at", projectId).map(toTask);
  }
  task(id: string): Task | undefined {
    const r = this.one("SELECT * FROM tasks WHERE id = ? COLLATE NOCASE", id.trim());
    return r && toTask(r);
  }
  saveTask(t: Task) {
    this.run(
      `INSERT INTO tasks (id, project_id, title, details, files, done_when, depends_on, phase, status, owner_id, pr_number, note, deploy_result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, details = excluded.details, files = excluded.files, done_when = excluded.done_when,
         depends_on = excluded.depends_on, phase = excluded.phase, status = excluded.status, owner_id = excluded.owner_id,
         pr_number = excluded.pr_number, note = excluded.note, deploy_result = excluded.deploy_result, updated_at = excluded.updated_at`,
      t.id, t.projectId, t.title, t.details, JSON.stringify(t.files), t.doneWhen, JSON.stringify(t.dependsOn), t.phase, t.status,
      t.ownerId, t.prNumber, t.note, t.deployResult ?? "", t.createdAt, t.updatedAt,
    );
  }

  // -------------------------------------------------------------- pull requests

  prs(projectId?: string): PrRow[] {
    const rows = projectId ? this.all("SELECT * FROM prs WHERE project_id = ? ORDER BY number DESC", projectId) : this.all("SELECT * FROM prs ORDER BY project_id, number DESC");
    return rows.map(toPr);
  }
  pr(projectId: string, number: number): PrRow | undefined {
    const r = this.one("SELECT * FROM prs WHERE project_id = ? AND number = ?", projectId, number);
    return r && toPr(r);
  }
  savePr(p: PrRow) {
    this.run(
      `INSERT INTO prs (project_id, number, task_id, author_id, title, url, state, draft, branch, head_sha, review, checks, mergeable, comments, ready, updated_at, feedback_sha, merge_need_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, number) DO UPDATE SET task_id = excluded.task_id, author_id = excluded.author_id, title = excluded.title, url = excluded.url,
         state = excluded.state, draft = excluded.draft, branch = excluded.branch, head_sha = excluded.head_sha, review = excluded.review, checks = excluded.checks,
         mergeable = excluded.mergeable, comments = excluded.comments, ready = excluded.ready, updated_at = excluded.updated_at,
         feedback_sha = excluded.feedback_sha, merge_need_id = excluded.merge_need_id`,
      p.projectId, p.number, p.taskId, p.authorId, p.title, p.url, p.state, p.draft ? 1 : 0, p.branch, p.headSha, p.review, p.checks, p.mergeable,
      p.comments, p.ready ? 1 : 0, p.updatedAt, p.feedbackSha, p.mergeNeedId,
    );
  }
  /** Marks a GitHub item (comment, review, failed check run…) as handled. True if it was new. */
  markSeen(projectId: string, key: string): boolean {
    return Number(this.run("INSERT OR IGNORE INTO pr_seen (project_id, key, at) VALUES (?, ?, ?)", projectId, key, now()).changes) > 0;
  }
  seen(projectId: string, key: string): boolean {
    return !!this.one("SELECT 1 FROM pr_seen WHERE project_id = ? AND key = ?", projectId, key);
  }

  // -------------------------------------------------------------- messages

  addMessage(m: Omit<Message, "id">): Message {
    const r = this.run("INSERT INTO messages (project_id, from_id, to_id, text, delivered, at) VALUES (?, ?, ?, ?, ?, ?)", m.projectId, m.fromId, m.toId, m.text, m.delivered ? 1 : 0, m.at);
    return { ...m, id: Number(r.lastInsertRowid) };
  }
  pendingMessages(agentId: string): Message[] {
    return this.all("SELECT * FROM messages WHERE to_id = ? AND delivered = 0 ORDER BY id", agentId).map(toMessage);
  }
  markDelivered(ids: number[]) {
    for (const id of ids) this.run("UPDATE messages SET delivered = 1 WHERE id = ?", id);
  }
  messages(projectId: string, limit = 200): Message[] {
    return this.all("SELECT * FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT ?", projectId, limit).map(toMessage);
  }

  // -------------------------------------------------------------- needs

  addNeed(n: Omit<Need, "id">): Need {
    const r = this.run("INSERT INTO needs (project_id, agent_id, kind, title, details, status, answer, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", n.projectId, n.agentId, n.kind, n.title, n.details, n.status, n.answer, n.at);
    return { ...n, id: Number(r.lastInsertRowid) };
  }
  need(id: number): Need | undefined {
    const r = this.one("SELECT * FROM needs WHERE id = ?", id);
    return r && toNeed(r);
  }
  openNeeds(projectId?: string): Need[] {
    const rows = projectId ? this.all("SELECT * FROM needs WHERE status = 'open' AND project_id = ? ORDER BY id", projectId) : this.all("SELECT * FROM needs WHERE status = 'open' ORDER BY id");
    return rows.map(toNeed);
  }
  closeNeed(id: number, answer: string) {
    this.run("UPDATE needs SET status = 'done', answer = ? WHERE id = ?", answer, id);
  }

  // -------------------------------------------------------------- activity + settings

  addActivity(a: Omit<Activity, "id">): Activity {
    const r = this.run("INSERT INTO activity (project_id, agent_id, text, at) VALUES (?, ?, ?, ?)", a.projectId, a.agentId, a.text, a.at);
    return { ...a, id: Number(r.lastInsertRowid) };
  }
  activity(projectId: string, limit = 100): Activity[] {
    return this.all("SELECT * FROM activity WHERE project_id = ? ORDER BY id DESC LIMIT ?", projectId, limit).map(toActivity);
  }
  setting(key: string): string | undefined {
    const r = this.one("SELECT value FROM settings WHERE key = ?", key);
    return r ? s(r.value) : undefined;
  }
  setSetting(key: string, value: string) {
    this.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }
}
