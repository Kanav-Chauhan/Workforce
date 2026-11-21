// One SQLite file holds everything (Node's built-in node:sqlite, nothing to install).
// Small typed helpers per table; every change goes through `store` so it can be broadcast.

import { DatabaseSync } from "node:sqlite";
import type { Activity, Agent, AgentState, Message, Need, NeedKind, PermissionStyle, Project, Task, TaskStatus } from "../shared/types.ts";
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
`;

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
});
const toAgent = (r: Row): Agent => ({
  id: s(r.id), projectId: s(r.project_id), sign: s(r.sign), name: s(r.name), isLead: !!r.is_lead,
  extraRole: s(r.extra_role), model: s(r.model), sessionId: s(r.session_id), state: s(r.state) as AgentState,
  note: s(r.note), taskId: r.task_id == null ? null : s(r.task_id), stateSince: s(r.state_since),
});
const toTask = (r: Row): Task => ({
  id: s(r.id), projectId: s(r.project_id), title: s(r.title), details: s(r.details), files: json(r.files, []),
  doneWhen: s(r.done_when), dependsOn: json(r.depends_on, []), phase: s(r.phase), status: s(r.status) as TaskStatus,
  ownerId: r.owner_id == null ? null : s(r.owner_id), prNumber: r.pr_number == null ? null : Number(r.pr_number),
  note: s(r.note), createdAt: s(r.created_at), updatedAt: s(r.updated_at),
});
const toMessage = (r: Row): Message => ({
  id: Number(r.id), projectId: s(r.project_id), fromId: s(r.from_id), toId: s(r.to_id), text: s(r.text), delivered: !!r.delivered, at: s(r.at),
});
const toNeed = (r: Row): Need => ({
  id: Number(r.id), projectId: s(r.project_id), agentId: r.agent_id == null ? null : s(r.agent_id), kind: s(r.kind) as NeedKind,
  title: s(r.title), details: s(r.details), status: s(r.status) as Need["status"], answer: s(r.answer), at: s(r.at),
});
const toActivity = (r: Row): Activity => ({ id: Number(r.id), projectId: s(r.project_id), agentId: r.agent_id == null ? null : s(r.agent_id), text: s(r.text), at: s(r.at) });

export class Db {
  readonly sql: DatabaseSync;

  constructor(file = dbFile()) {
    if (file !== ":memory:") ensureDir(home());
    this.sql = new DatabaseSync(file);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.sql.exec(SCHEMA);
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
      "INSERT INTO projects (id, repo, name, prefix, default_branch, permission_style, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      p.id, p.repo, p.name, p.prefix, p.defaultBranch, p.permissionStyle, p.createdAt,
    );
  }
  setPermissionStyle(id: string, style: PermissionStyle) {
    this.run("UPDATE projects SET permission_style = ? WHERE id = ?", style, id);
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
      "INSERT INTO agents (id, project_id, sign, name, is_lead, extra_role, model, session_id, token, state, note, task_id, state_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      a.id, a.projectId, a.sign, a.name, a.isLead ? 1 : 0, a.extraRole, a.model, a.sessionId, token, a.state, a.note, a.taskId, a.stateSince,
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
      `INSERT INTO tasks (id, project_id, title, details, files, done_when, depends_on, phase, status, owner_id, pr_number, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, details = excluded.details, files = excluded.files, done_when = excluded.done_when,
         depends_on = excluded.depends_on, phase = excluded.phase, status = excluded.status, owner_id = excluded.owner_id,
         pr_number = excluded.pr_number, note = excluded.note, updated_at = excluded.updated_at`,
      t.id, t.projectId, t.title, t.details, JSON.stringify(t.files), t.doneWhen, JSON.stringify(t.dependsOn), t.phase, t.status,
      t.ownerId, t.prNumber, t.note, t.createdAt, t.updatedAt,
    );
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
