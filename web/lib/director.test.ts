import { describe, expect, it } from "vitest";
import type { Agent, Message, Need, Task } from "../../shared/types";
import { ActQueue, askText, bubbleText, Director } from "./director";

const at = "2026-11-21T10:00:00.000Z";
const agent = (sign: string, patch: Partial<Agent> = {}): Agent => ({
  id: `p.${sign}`, projectId: "p", sign, name: sign, isLead: sign === "leo", extraRole: "", model: "", sessionId: "", state: "ready", note: "", taskId: null, stateSince: at, ...patch,
});
const task = (patch: Partial<Task>): Task => ({
  id: "P-1", projectId: "p", title: "t", details: "", files: [], doneWhen: "", dependsOn: [], phase: "", status: "todo", ownerId: null, prNumber: null, note: "", createdAt: at, updatedAt: at, ...patch,
});
const need = (patch: Partial<Need>): Need => ({ id: 1, projectId: "p", agentId: "p.aries", kind: "permission", title: "Aries: Running npm install zod", details: "", status: "open", answer: "", at, ...patch });
const msg = (patch: Partial<Message>): Message => ({ id: 1, projectId: "p", fromId: "p.leo", toId: "p.aries", text: "hi", delivered: false, at, ...patch });

function director() {
  const d = new Director("p");
  d.init({ agents: [agent("leo"), agent("aries"), agent("virgo")], tasks: [], needs: [], messages: [] });
  return d;
}

describe("director: events become office acts", () => {
  it("a message between agents is a visit with a short bubble", () => {
    const d = director();
    const acts = d.apply({ type: "message", message: msg({ text: "WF-1 is yours: build the /health page. Use zod for parsing." }) });
    expect(acts).toEqual([{ kind: "visit", agentId: "p.leo", toId: "p.aries", text: "WF-1 is yours: build the /health…" }]);
  });

  it("the same message twice is acted once", () => {
    const d = director();
    expect(d.apply({ type: "message", message: msg({}) })).toHaveLength(1);
    expect(d.apply({ type: "message", message: msg({}) })).toHaveLength(0);
  });

  it("owner and Workforce messages are envelopes", () => {
    const d = director();
    expect(d.apply({ type: "message", message: msg({ id: 2, fromId: "owner" }) })).toEqual([{ kind: "envelope", toId: "p.aries", from: "owner" }]);
    expect(d.apply({ type: "message", message: msg({ id: 3, fromId: "workforce" }) })[0]).toMatchObject({ kind: "envelope", from: "workforce" });
  });

  it("ignores other projects", () => {
    const d = director();
    expect(d.apply({ type: "message", message: msg({ projectId: "q" }) })).toEqual([]);
    expect(d.apply({ type: "task", task: task({ projectId: "q", status: "done" }) })).toEqual([]);
  });

  it("a permission need walks the agent to the CEO until it is done", () => {
    const d = director();
    expect(d.apply({ type: "need", need: need({}) })).toEqual([{ kind: "askCeo", agentId: "p.aries", needId: 1, text: "May I run npm install zod?" }]);
    expect(d.isOpen(1)).toBe(true);
    expect(d.apply({ type: "need", need: need({ status: "done" }) })).toEqual([{ kind: "needDone", needId: 1 }]);
    expect(d.isOpen(1)).toBe(false);
  });

  it("blocked and merge needs do not walk anyone", () => {
    const d = director();
    expect(d.apply({ type: "need", need: need({ id: 5, kind: "blocked" }) })).toEqual([]);
    expect(d.apply({ type: "need", need: need({ id: 6, kind: "merge", agentId: null }) })).toEqual([]);
  });

  it("review with a PR → parcel; done → celebration", () => {
    const d = director();
    d.apply({ type: "task", task: task({ status: "working", ownerId: "p.virgo" }) });
    expect(d.apply({ type: "task", task: task({ status: "review", ownerId: "p.virgo", prNumber: 4 }) })).toEqual([{ kind: "parcel", agentId: "p.virgo", taskId: "P-1", pr: 4 }]);
    // Same PR again (e.g. note changed): no second parcel.
    expect(d.apply({ type: "task", task: task({ status: "review", ownerId: "p.virgo", prNumber: 4, note: "x" }) })).toEqual([]);
    expect(d.apply({ type: "task", task: task({ status: "done", ownerId: "p.virgo", prNumber: 4 }) })).toEqual([{ kind: "done", taskId: "P-1", pr: 4 }]);
  });

  it("agent changes become a pose update only when something visible changed", () => {
    const d = director();
    expect(d.apply({ type: "agent", agent: agent("aries", { state: "working", note: "Editing a.ts" }) })).toEqual([{ kind: "pose", agentId: "p.aries" }]);
    expect(d.apply({ type: "agent", agent: agent("aries", { state: "working", note: "Editing a.ts" }) })).toEqual([]);
  });

  it("init puts waiting agents at the CEO and PRs on the gate, without replaying old messages", () => {
    const d = new Director("p");
    const acts = d.init({
      agents: [agent("leo"), agent("aries")],
      tasks: [task({ status: "review", ownerId: "p.aries", prNumber: 7 })],
      needs: [need({ id: 9, kind: "question", title: "Which colour?" })],
      messages: [msg({ id: 4 })],
    });
    expect(acts).toEqual([
      { kind: "parcel", agentId: "p.aries", taskId: "P-1", pr: 7, instant: true },
      { kind: "askCeo", agentId: "p.aries", needId: 9, text: "Which colour?", instant: true },
    ]);
    expect(d.apply({ type: "message", message: msg({ id: 4 }) })).toEqual([]);
  });
});

describe("text helpers", () => {
  it("bubbles are one short line without the Workforce tag", () => {
    expect(bubbleText("[Workforce] Message from Leo: ok")).toBe("Message from Leo: ok");
    expect(bubbleText("Done. Next one?")).toBe("Done.");
  });
  it("asks read like a question", () => {
    expect(askText({ kind: "permission", title: "Virgo: Editing src/app/page.tsx" })).toBe("May I edit src/app/page.tsx?");
    expect(askText({ kind: "question", title: "Which database" })).toBe("Which database?");
  });
});

describe("act queue", () => {
  it("keeps order and trims chit-chat on bursts, never asks or parcels", () => {
    const q = new ActQueue(3);
    q.push({ kind: "askCeo", agentId: "a", needId: 1, text: "?" });
    for (let i = 0; i < 5; i++) q.push({ kind: "visit", agentId: "a", toId: i % 2 ? "b" : "c", text: String(i) });
    q.push({ kind: "parcel", agentId: "a", taskId: "T", pr: 1 });
    const out = [];
    for (let a = q.next(); a; a = q.next()) out.push(a);
    expect(out.map((a) => a.kind)).toEqual(["askCeo", "visit", "parcel"]);
    expect(out[1]).toMatchObject({ text: "4" });
  });
  it("merges repeated visits to the same person", () => {
    const q = new ActQueue();
    q.push({ kind: "visit", agentId: "a", toId: "b", text: "1" });
    q.push({ kind: "visit", agentId: "a", toId: "b", text: "2" });
    expect(q.length).toBe(1);
    expect(q.next()).toMatchObject({ text: "2" });
  });
  it("drops an ask whose need closed while waiting", () => {
    const q = new ActQueue();
    q.push({ kind: "askCeo", agentId: "a", needId: 3, text: "?" });
    q.dropNeed(3);
    expect(q.length).toBe(0);
  });
});
