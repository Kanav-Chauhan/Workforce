// The database plus live updates: every change is saved, then pushed to subscribers (the dashboard).

import type { Agent, LiveEvent, Need, NeedKind, Task } from "../shared/types.ts";
import { Db, now } from "./db.ts";

type Subscriber = (e: LiveEvent) => void;

export class Store {
  private subscribers: Subscriber[] = [];

  constructor(readonly db: Db) {}

  on(fn: Subscriber) {
    this.subscribers.push(fn);
    return () => {
      this.subscribers = this.subscribers.filter((f) => f !== fn);
    };
  }

  emit(e: LiveEvent) {
    for (const fn of this.subscribers) {
      try {
        fn(e);
      } catch {
        /* one bad subscriber must not break the others */
      }
    }
  }

  /** Display name for an id: an agent's name, "You" or "Workforce". */
  nameOf(id: string | null): string {
    if (!id) return "Someone";
    if (id === "owner") return "You";
    if (id === "workforce") return "Workforce";
    return this.db.agent(id)?.name ?? id;
  }

  // -------------------------------------------------------------- agents

  updateAgent(id: string, patch: Partial<Pick<Agent, "state" | "note" | "taskId">>) {
    const before = this.db.agent(id);
    if (!before) return;
    const changedState = patch.state !== undefined && patch.state !== before.state;
    this.db.updateAgent(id, { ...patch, ...(changedState ? { stateSince: now() } : {}) });
    const after = this.db.agent(id)!;
    if (JSON.stringify(after) !== JSON.stringify(before)) this.emit({ type: "agent", agent: after });
  }

  // -------------------------------------------------------------- tasks

  saveTask(task: Task) {
    task.updatedAt = now();
    this.db.saveTask(task);
    this.emit({ type: "task", task: { ...task } });
  }

  // -------------------------------------------------------------- activity + needs

  activity(projectId: string, agentId: string | null, text: string) {
    const a = this.db.addActivity({ projectId, agentId, text: text.slice(0, 300), at: now() });
    this.emit({ type: "activity", activity: a });
  }

  addNeed(projectId: string, agentId: string | null, kind: NeedKind, title: string, details = ""): Need {
    const need = this.db.addNeed({ projectId, agentId, kind, title: title.slice(0, 200), details: details.slice(0, 4000), status: "open", answer: "", at: now() });
    this.emit({ type: "need", need });
    return need;
  }

  closeNeed(id: number, answer: string): Need | undefined {
    this.db.closeNeed(id, answer.slice(0, 2000));
    const need = this.db.need(id);
    if (need) this.emit({ type: "need", need });
    return need;
  }
}
