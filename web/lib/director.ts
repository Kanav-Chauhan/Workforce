// Turns live events into things the office should act out. Pure: no DOM, no timers, so it is tested.
// The office engine plays the returned acts; per-agent acts go through an ActQueue so bursts stay tidy.

import type { Agent, LiveEvent, LiveState, Need, PullRequest, Task } from "../../shared/types";

export type Act =
  /** A walks to B's cabin, says `text`, walks back. */
  | { kind: "visit"; agentId: string; toId: string; text: string }
  /** An envelope flies to the agent (from your CEO cabin, or from Workforce itself). */
  | { kind: "envelope"; toId: string; from: "owner" | "workforce" }
  /** The agent walks to the CEO cabin and waits there until the need is closed. */
  | { kind: "askCeo"; agentId: string; needId: number; text: string; instant?: boolean }
  /** The need was answered: whoever waits for it may go back. */
  | { kind: "needDone"; needId: number }
  /** The task's owner carries a parcel "PR #n" to the review gate. */
  | { kind: "parcel"; agentId: string; taskId: string; pr: number; instant?: boolean }
  /** Changes requested: the author walks to the gate, takes the parcel back to their cabin. */
  | { kind: "rework"; agentId: string; taskId: string }
  /** The PR is ready to merge: its parcel passes through the gate and waits for you there. */
  | { kind: "approve"; taskId: string; instant?: boolean }
  /** Merged/done: confetti at the gate, its parcel goes away. */
  | { kind: "done"; taskId: string; pr: number | null }
  /** The agent's state changed: sit, type, dim the cabin… */
  | { kind: "pose"; agentId: string };

/** Acts that make one agent walk, so they wait their turn in that agent's queue. */
export const queuedFor = (a: Act): string | null => (a.kind === "visit" || a.kind === "askCeo" || a.kind === "parcel" || a.kind === "rework" ? a.agentId : null);

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/** A short line for a speech bubble. */
export function bubbleText(text: string, max = 34): string {
  const t = text.replace(/^\[Workforce\]\s*/i, "").replace(/\s+/g, " ").trim();
  // First sentence is usually enough.
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return clip(first || t, max);
}

/** "Aries: Running npm install zod" → "May I run npm install zod?" */
export function askText(need: Pick<Need, "kind" | "title">, max = 34): string {
  const title = need.title.replace(/^[A-Z][a-z]+:\s*/, "").trim();
  if (need.kind === "permission") {
    const m = /^(Running|Editing|Reading|Using|Writing)\s+(.*)$/.exec(title);
    const verb = m ? { Running: "run", Editing: "edit", Reading: "read", Using: "use", Writing: "write" }[m[1] as "Running"] : "";
    return clip(m ? `May I ${verb} ${m[2]}?` : `May I: ${title}?`, max);
  }
  if (need.kind === "trust") return "May I start in this folder?";
  return clip(/[?]$/.test(title) ? title : `${title}?`, max);
}

const walksToCeo = (n: Need) => !!n.agentId && (n.kind === "question" || n.kind === "permission" || n.kind === "trust");

export class Director {
  private agents = new Map<string, Agent>();
  private tasks = new Map<string, Task>();
  private needs = new Map<number, Need>();
  private seenMessages = new Set<number>();
  private prs = new Map<number, PullRequest>();

  constructor(readonly projectId: string) {}

  /** Start from a snapshot: open needs put agents at the CEO cabin, PRs in review sit on the gate. */
  init(state: Pick<LiveState, "agents" | "tasks" | "needs" | "messages"> & { prs?: PullRequest[] }): Act[] {
    this.prs.clear();
    this.agents.clear();
    this.tasks.clear();
    this.needs.clear();
    this.seenMessages.clear();
    const acts: Act[] = [];
    for (const a of state.agents) if (a.projectId === this.projectId) this.agents.set(a.id, a);
    for (const m of state.messages) this.seenMessages.add(m.id);
    for (const t of state.tasks) {
      if (t.projectId !== this.projectId) continue;
      this.tasks.set(t.id, t);
      if (t.status === "review" && t.prNumber && t.ownerId && this.agents.has(t.ownerId)) acts.push({ kind: "parcel", agentId: t.ownerId, taskId: t.id, pr: t.prNumber, instant: true });
    }
    for (const p of state.prs ?? []) {
      if (p.projectId !== this.projectId) continue;
      this.prs.set(p.number, p);
      if (p.ready && p.state === "open" && p.taskId && this.tasks.get(p.taskId)?.status === "review") acts.push({ kind: "approve", taskId: p.taskId, instant: true });
    }
    for (const n of state.needs) {
      if (n.projectId !== this.projectId || n.status !== "open") continue;
      this.needs.set(n.id, n);
      if (walksToCeo(n) && this.agents.has(n.agentId!)) acts.push({ kind: "askCeo", agentId: n.agentId!, needId: n.id, text: askText(n), instant: true });
    }
    return acts;
  }

  isOpen(needId: number) {
    return this.needs.get(needId)?.status === "open";
  }

  agent(id: string) {
    return this.agents.get(id);
  }

  apply(e: LiveEvent): Act[] {
    switch (e.type) {
      case "agent": {
        const a = e.agent;
        if (a.projectId !== this.projectId) return [];
        const before = this.agents.get(a.id);
        this.agents.set(a.id, a);
        return !before || before.state !== a.state || before.note !== a.note || before.taskId !== a.taskId ? [{ kind: "pose", agentId: a.id }] : [];
      }
      case "message": {
        const m = e.message;
        if (m.projectId !== this.projectId || this.seenMessages.has(m.id)) return [];
        this.seenMessages.add(m.id);
        if (!this.agents.has(m.toId)) return [];
        if (m.fromId === "owner") return [{ kind: "envelope", toId: m.toId, from: "owner" }];
        if (m.fromId === "workforce") return [{ kind: "envelope", toId: m.toId, from: "workforce" }];
        if (this.agents.has(m.fromId) && m.fromId !== m.toId) return [{ kind: "visit", agentId: m.fromId, toId: m.toId, text: bubbleText(m.text) }];
        return [];
      }
      case "need": {
        const n = e.need;
        if (n.projectId !== this.projectId) return [];
        const before = this.needs.get(n.id);
        this.needs.set(n.id, n);
        if (n.status === "open" && !before && walksToCeo(n) && this.agents.has(n.agentId!)) return [{ kind: "askCeo", agentId: n.agentId!, needId: n.id, text: askText(n) }];
        if (n.status === "done" && before?.status === "open") return [{ kind: "needDone", needId: n.id }];
        return [];
      }
      case "task": {
        const t = e.task;
        if (t.projectId !== this.projectId) return [];
        const before = this.tasks.get(t.id);
        this.tasks.set(t.id, t);
        const acts: Act[] = [];
        const newPr = t.status === "review" && !!t.prNumber && (before?.status !== "review" || before.prNumber !== t.prNumber);
        if (newPr && t.ownerId && this.agents.has(t.ownerId)) acts.push({ kind: "parcel", agentId: t.ownerId, taskId: t.id, pr: t.prNumber! });
        if (t.status === "done" && before && before.status !== "done") acts.push({ kind: "done", taskId: t.id, pr: t.prNumber });
        if (before?.status === "review" && t.status === "working" && t.prNumber && t.ownerId && this.agents.has(t.ownerId)) acts.push({ kind: "rework", agentId: t.ownerId, taskId: t.id });
        return acts;
      }
      case "pr": {
        const p = e.pr;
        if (p.projectId !== this.projectId) return [];
        const before = this.prs.get(p.number);
        this.prs.set(p.number, p);
        return p.ready && p.state === "open" && !before?.ready && p.taskId ? [{ kind: "approve", taskId: p.taskId }] : [];
      }
      default:
        return [];
    }
  }
}

/** One agent's waiting acts. Bursts are trimmed: chit-chat goes first, asks and parcels are kept. */
export class ActQueue {
  private items: Act[] = [];
  constructor(private max = 4) {}

  get length() {
    return this.items.length;
  }

  push(a: Act) {
    // The same visit twice in a row says nothing new.
    const last = this.items[this.items.length - 1];
    if (a.kind === "visit" && last?.kind === "visit" && last.toId === a.toId) {
      this.items[this.items.length - 1] = a;
      return;
    }
    this.items.push(a);
    while (this.items.length > this.max) {
      const i = this.items.findIndex((x) => x.kind === "visit");
      if (i < 0) break;
      this.items.splice(i, 1);
    }
  }

  next(): Act | undefined {
    return this.items.shift();
  }

  /** Drop asks for needs that were closed before the agent got going. */
  dropNeed(needId: number) {
    this.items = this.items.filter((x) => !(x.kind === "askCeo" && x.needId === needId));
  }

  clear() {
    this.items = [];
  }
}
