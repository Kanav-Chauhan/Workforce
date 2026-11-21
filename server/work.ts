// The team's rules: tasks, assignments, reports, messages and questions for the owner.
// Used by the MCP tools (agents) and the API (owner), so both follow the same rules.

import { boardsOf, cleanBoardName } from "../shared/boards.ts";
import type { Agent, Need, Task, TaskStatus } from "../shared/types.ts";
import { now } from "./db.ts";
import type { Courier } from "./courier.ts";
import type { Store } from "./store.ts";

export interface NewTask {
  title: string;
  details?: string;
  files?: string[];
  doneWhen?: string;
  dependsOn?: string[];
  phase?: string;
  /** The plan board (same as phase; board wins if both are given). */
  board?: string;
}

export type ReportStatus = "working" | "blocked" | "review" | "done";

export class Work {
  constructor(private store: Store, private courier: Courier) {}

  private get db() {
    return this.store.db;
  }

  lead(projectId: string): Agent | undefined {
    return this.db.agents(projectId).find((a) => a.isLead);
  }

  /** An agent of this project by id, sign, name, or "lead". */
  findAgent(projectId: string, ref: string): Agent | undefined {
    const r = ref.trim().toLowerCase();
    const team = this.db.agents(projectId);
    if (r === "lead") return team.find((a) => a.isLead);
    return team.find((a) => a.id === r || a.sign === r || a.name.toLowerCase() === r);
  }

  private mustAgent(projectId: string, ref: string): Agent {
    const a = this.findAgent(projectId, ref);
    if (!a) throw new Error(`No teammate "${ref}". Team: ${this.db.agents(projectId).map((x) => x.name).join(", ")}`);
    return a;
  }

  private mustTask(projectId: string, id: string): Task {
    const t = this.db.task(id);
    if (!t || t.projectId !== projectId) throw new Error(`No task ${id}`);
    return t;
  }

  // -------------------------------------------------------------- messages

  /** Saves a message and delivers it (now if the agent is idle, else when its turn ends). */
  message(projectId: string, fromId: string, toRef: string, text: string) {
    const to = this.mustAgent(projectId, toRef);
    const clean = text.trim().slice(0, 4000);
    if (!clean) throw new Error("Empty message");
    if (to.id === fromId) throw new Error("That's you");
    const msg = this.db.addMessage({ projectId, fromId, toId: to.id, text: clean, delivered: false, at: now() });
    this.store.emit({ type: "message", message: msg });
    if (fromId !== "workforce") this.store.activity(projectId, fromId === "owner" ? null : fromId, `${this.store.nameOf(fromId)} → ${to.name}: ${clean.slice(0, 100)}`);
    this.courier.queued(to.id);
    return msg;
  }

  /** A note from Workforce itself (assignments, review results). */
  notify(agentId: string, text: string) {
    const a = this.db.agent(agentId);
    if (a) this.message(a.projectId, "workforce", a.id, text);
  }

  // -------------------------------------------------------------- tasks

  createTask(projectId: string, input: NewTask, byId: string): Task {
    const project = this.db.project(projectId);
    if (!project) throw new Error("No such project");
    const title = input.title.trim().slice(0, 140);
    if (!title) throw new Error("A task needs a title");
    for (const dep of input.dependsOn ?? []) this.mustTask(projectId, dep);
    const board = this.useBoard(projectId, input.board ?? input.phase ?? "");
    const t: Task = {
      id: `${project.prefix}-${this.db.nextTaskNumber(projectId)}`, projectId, title,
      details: (input.details ?? "").slice(0, 8000), files: (input.files ?? []).slice(0, 50), doneWhen: (input.doneWhen ?? "").slice(0, 2000),
      dependsOn: input.dependsOn ?? [], phase: board, status: "todo", ownerId: null, prNumber: null, note: "", deployResult: "",
      createdAt: now(), updatedAt: now(),
    };
    this.store.saveTask(t);
    this.store.activity(projectId, byId === "owner" ? null : byId, `${this.store.nameOf(byId)} added ${t.id}: ${t.title}`);
    return t;
  }

  editTask(projectId: string, id: string, patch: Partial<NewTask> & { status?: TaskStatus }): Task {
    const t = this.mustTask(projectId, id);
    if (patch.title !== undefined) t.title = patch.title.trim().slice(0, 140) || t.title;
    if (patch.details !== undefined) t.details = patch.details.slice(0, 8000);
    if (patch.files !== undefined) t.files = patch.files.slice(0, 50);
    if (patch.doneWhen !== undefined) t.doneWhen = patch.doneWhen.slice(0, 2000);
    if (patch.dependsOn !== undefined) t.dependsOn = patch.dependsOn;
    const board = patch.board ?? patch.phase;
    if (board !== undefined) t.phase = this.useBoard(projectId, board);
    if (patch.status !== undefined) this.setTaskStatus(t, patch.status);
    this.store.saveTask(t);
    return t;
  }

  // -------------------------------------------------------------- boards

  /** Adds a plan board to the project (no-op if it's there). Returns the board's name as stored. */
  addBoard(projectId: string, name: string): string {
    const project = this.db.project(projectId);
    if (!project) throw new Error("No such project");
    const clean = cleanBoardName(name);
    if (!clean) throw new Error("Give the board a name");
    const boards = boardsOf(project);
    const existing = boards.find((b) => b.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    if (boards.length >= 12) throw new Error("That's a lot of boards; remove one first");
    this.db.updateProject(projectId, { boards: [...boards, clean] });
    this.store.emit({ type: "project", project: this.db.project(projectId)! });
    return clean;
  }

  /** Removes an empty board (never the last one). */
  removeBoard(projectId: string, name: string) {
    const project = this.db.project(projectId);
    if (!project) throw new Error("No such project");
    const boards = boardsOf(project);
    const first = boards[0]!.toLowerCase();
    const n = name.toLowerCase();
    if (boards.length <= 1) throw new Error("A project keeps at least one board");
    const used = this.db.tasks(projectId).some((t) => (t.phase.toLowerCase() || first) === n);
    if (used) throw new Error("Move or finish the tasks on that board first");
    this.db.updateProject(projectId, { boards: boards.filter((b) => b.toLowerCase() !== n) });
    this.store.emit({ type: "project", project: this.db.project(projectId)! });
  }

  /** The board a task should go on: "" stays "" (the first board); a new name is added to the project. */
  private useBoard(projectId: string, name: string): string {
    const clean = cleanBoardName(name);
    return clean ? this.addBoard(projectId, clean) : "";
  }

  private setTaskStatus(t: Task, status: TaskStatus) {
    t.status = status;
    if (status === "done" && t.ownerId) {
      const owner = this.db.agent(t.ownerId);
      if (owner?.taskId === t.id) this.store.updateAgent(owner.id, { taskId: null });
    }
  }

  /** Gives a task to a developer and tells them to start. */
  assign(projectId: string, taskId: string, agentRef: string, byId: string, note = ""): Task {
    const t = this.mustTask(projectId, taskId);
    const a = this.mustAgent(projectId, agentRef);
    if (a.isLead) throw new Error("The lead plans; give tasks to developers.");
    if (t.status === "done") throw new Error(`${t.id} is already done`);
    const waiting = t.dependsOn.map((d) => this.db.task(d)).filter((d) => d && d.status !== "done" && d.status !== "review");
    if (waiting.length) throw new Error(`${t.id} depends on ${waiting.map((d) => d!.id).join(", ")}, which isn't finished yet`);
    t.ownerId = a.id;
    if (t.status === "blocked") t.status = "todo";
    this.store.saveTask(t);
    this.store.updateAgent(a.id, { taskId: t.id });
    this.store.activity(projectId, byId === "owner" ? null : byId, `${this.store.nameOf(byId)} gave ${t.id} (${t.title}) to ${a.name}`);
    const extra = note.trim() ? ` Note from ${this.store.nameOf(byId)}: ${note.trim().slice(0, 1500)}` : "";
    this.notify(a.id, `${this.store.nameOf(byId)} assigned you ${t.id}: ${t.title}. Call my_task for the details, then start.${extra}`);
    return t;
  }

  /** The agent's current task: the one it was given, else its oldest open one. */
  activeTaskOf(agentId: string): Task | undefined {
    const a = this.db.agent(agentId);
    if (!a) return undefined;
    const tasks = this.db.tasks(a.projectId).filter((t) => t.ownerId === agentId && t.status !== "done");
    return tasks.find((t) => t.id === a.taskId) ?? tasks.find((t) => t.status === "working") ?? tasks.find((t) => t.status === "todo") ?? tasks[0];
  }

  myTask(agentId: string): Task | null {
    const t = this.activeTaskOf(agentId);
    if (!t) return null;
    if (t.status === "todo") {
      t.status = "working";
      this.store.saveTask(t);
      this.store.activity(t.projectId, agentId, `${this.store.nameOf(agentId)} started ${t.id}`);
    }
    this.store.updateAgent(agentId, { taskId: t.id });
    return t;
  }

  /** A developer reports progress on its current task. The lead is told about blocked/review/done. */
  report(agentId: string, status: ReportStatus, note = "", prNumber?: number, deploy?: string): Task {
    const a = this.db.agent(agentId);
    const t = this.activeTaskOf(agentId);
    if (!a || !t) throw new Error("You have no task. Ask the lead for one.");
    this.setTaskStatus(t, status);
    t.note = note.slice(0, 500);
    if (prNumber) t.prNumber = prNumber;
    if (deploy?.trim()) t.deployResult = deploy.trim().slice(0, 300);
    this.store.saveTask(t);
    if (deploy?.trim()) this.store.activity(a.projectId, a.id, `${a.name}'s deploy step for ${t.id}: ${t.deployResult}`);
    if (status === "blocked") this.store.updateAgent(a.id, { state: "blocked", note: `Blocked: ${note}`.slice(0, 200) });
    const words = { working: "is working on", blocked: "is blocked on", review: "sent for review", done: "finished" }[status];
    this.store.activity(a.projectId, a.id, `${a.name} ${words} ${t.id}${note ? `: ${note}` : ""}${prNumber ? ` (PR #${prNumber})` : ""}`);
    const lead = this.lead(a.projectId);
    if (lead && lead.id !== a.id && status !== "working")
      this.notify(lead.id, `${a.name} ${words} ${t.id} (${t.title})${note ? `: ${note}` : ""}${prNumber ? `, PR #${prNumber}` : ""}.`);
    if (status === "blocked") this.store.addNeed(a.projectId, a.id, "blocked", `${a.name} is blocked on ${t.id}`, note);
    return t;
  }

  // -------------------------------------------------------------- owner

  askOwner(agentId: string, title: string, details: string): Need {
    const a = this.db.agent(agentId);
    if (!a) throw new Error("Unknown agent");
    const need = this.store.addNeed(a.projectId, a.id, "question", title, details);
    this.store.activity(a.projectId, a.id, `${a.name} asks you: ${title}`);
    return need;
  }

  /** The owner answers a question (or clears a blocked item); the agent is told. */
  answer(needId: number, answer: string): Need {
    const need = this.db.need(needId);
    if (!need || need.status !== "open") throw new Error("Nothing open with that id");
    if (need.kind === "permission" || need.kind === "trust") throw new Error("Use allow/deny for permission prompts");
    // A "ready to merge" item the owner put aside: nobody needs to hear about it.
    if (need.kind === "merge") return this.store.closeNeed(needId, answer || "Later")!;
    const closed = this.store.closeNeed(needId, answer)!;
    if (need.agentId) {
      const reply = answer.trim() || "Done.";
      this.notify(need.agentId, `The owner answered "${need.title}": ${reply}`);
      const a = this.db.agent(need.agentId);
      if (a?.state === "blocked") this.store.updateAgent(a.id, { state: "ready", note: "Owner answered" });
    }
    return closed;
  }
}
