import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../shared/types.ts";
import { permissions, roleText } from "./agentFiles.ts";
import { Db, now } from "./db.ts";
import { Courier } from "./courier.ts";
import { Hooks } from "./hooks.ts";
import { parseRepo, prefixFor, Projects } from "./projects.ts";
import { describeTool, nextStatus } from "./status.ts";
import { Store } from "./store.ts";
import { Work } from "./work.ts";

function setup() {
  const db = new Db(":memory:");
  const store = new Store(db);
  const typed: { agentId: string; text: string }[] = [];
  const courier = new Courier(store, { put: async (agentId, text) => (typed.push({ agentId, text }), true), submit: async () => true });
  const work = new Work(store, courier);
  const hooks = new Hooks(store, courier);
  const projects = new Projects(store);
  const project: Project = { id: "demo", repo: "me/demo", name: "demo", prefix: "DM", defaultBranch: "main", permissionStyle: "careful", createdAt: now() };
  db.addProject(project);
  for (const sign of ["leo", "aries", "virgo"]) projects.addAgent("demo", sign);
  return { db, store, courier, work, hooks, projects, project, typed };
}

describe("projects", () => {
  it("reads owner/name from input or URL", () => {
    expect(parseRepo("Kanav-Chauhan/workforce-sandbox")).toBe("Kanav-Chauhan/workforce-sandbox");
    expect(parseRepo("https://github.com/a/b.git")).toBe("a/b");
    expect(() => parseRepo("nope")).toThrow();
  });
  it("makes short task prefixes", () => {
    expect(prefixFor("workforce-sandbox")).toBe("WS");
    expect(prefixFor("atlas")).toBe("ATL");
  });
  it("names the team after zodiac signs, Leo leads", () => {
    const { db } = setup();
    const team = db.agents("demo");
    expect(team.map((a) => a.name)).toEqual(["Leo", "Aries", "Virgo"]);
    expect(team[0]!.isLead).toBe(true);
    expect(new Set(team.map((a) => db.agentToken(a.id))).size).toBe(3);
  });
});

describe("status from hooks", () => {
  const ready = { state: "ready" as const, note: "" };
  it("follows a turn", () => {
    expect(nextStatus(ready, "UserPromptSubmit", { prompt: "build it" }, undefined)?.state).toBe("working");
    expect(nextStatus({ state: "working", note: "" }, "Stop", {}, true)?.state).toBe("ready");
  });
  it("ignores a late tool event after Stop", () => {
    expect(nextStatus(ready, "PreToolUse", { tool_name: "Bash" }, false)).toBeNull();
  });
  it("marks permission prompts as needs-you", () => {
    expect(nextStatus(ready, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm i" } }, true)).toEqual({ state: "needs-you", note: "Asking: Running npm i" });
  });
  it("keeps blocked after Stop", () => {
    expect(nextStatus({ state: "blocked", note: "Blocked: no key" }, "Stop", {}, true)).toEqual({ state: "blocked", note: "Blocked: no key" });
  });
  it("describes tools in plain words", () => {
    expect(describeTool("Edit", { file_path: "/x/app/page.tsx" })).toBe("Editing page.tsx");
    expect(describeTool("mcp__workforce__assign")).toBe("Team: assign");
  });
});

describe("work rules", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));

  it("numbers tasks per project", () => {
    expect(t.work.createTask("demo", { title: "A" }, "demo.leo").id).toBe("DM-1");
    expect(t.work.createTask("demo", { title: "B" }, "demo.leo").id).toBe("DM-2");
  });

  it("assigns, queues a message, and blocks unfinished dependencies", () => {
    const a = t.work.createTask("demo", { title: "A" }, "demo.leo");
    const b = t.work.createTask("demo", { title: "B", dependsOn: [a.id] }, "demo.leo");
    expect(() => t.work.assign("demo", b.id, "virgo", "demo.leo")).toThrow(/depends on DM-1/);
    t.work.assign("demo", a.id, "aries", "demo.leo");
    expect(t.db.agent("demo.aries")!.taskId).toBe("DM-1");
    expect(t.db.pendingMessages("demo.aries")[0]!.text).toMatch(/assigned you DM-1/);
    expect(() => t.work.assign("demo", a.id, "lead", "owner")).toThrow(/lead plans/);
    t.work.assign("demo", a.id, "aries", "demo.leo", "dry run only");
    expect(t.db.pendingMessages("demo.aries").at(-1)!.text).toMatch(/assigned you DM-1.*Note from Leo: dry run only/);
  });

  it("report review tells the lead and links the PR", () => {
    const a = t.work.createTask("demo", { title: "A" }, "demo.leo");
    t.work.assign("demo", a.id, "Aries", "demo.leo");
    expect(t.work.myTask("demo.aries")!.status).toBe("working");
    t.work.report("demo.aries", "review", "ready", 7);
    expect(t.db.task("DM-1")).toMatchObject({ status: "review", prNumber: 7 });
    expect(t.db.pendingMessages("demo.leo").at(-1)!.text).toMatch(/Aries sent for review DM-1.*PR #7/);
  });

  it("blocked creates a Needs-you item; answering tells the agent", () => {
    const a = t.work.createTask("demo", { title: "A" }, "demo.leo");
    t.work.assign("demo", a.id, "virgo", "demo.leo");
    t.work.report("demo.virgo", "blocked", "need STRIPE_KEY");
    const need = t.db.openNeeds("demo").find((n) => n.kind === "blocked")!;
    expect(t.db.agent("demo.virgo")!.state).toBe("blocked");
    t.work.answer(need.id, "added to your env");
    expect(t.db.pendingMessages("demo.virgo").at(-1)!.text).toMatch(/owner answered.*added to your env/);
    expect(t.db.agent("demo.virgo")!.state).toBe("ready");
  });
});

describe("courier", () => {
  it("hands queued messages over at Stop, on one line", () => {
    const t = setup();
    t.work.message("demo", "owner", "lead", "Plan a footer\nand a health page");
    t.work.message("demo", "demo.aries", "lead", "done?");
    const text = t.courier.drainForStopHook("demo.leo")!;
    expect(text).not.toContain("\n");
    expect(text).toContain("Message from You: Plan a footer and a health page");
    expect(text).toContain("Message from Aries: done?");
    expect(t.db.pendingMessages("demo.leo")).toHaveLength(0);
    expect(t.courier.drainForStopHook("demo.leo")).toBeNull();
  });

  it("holds teammates' messages while paused, but not the owner's", () => {
    const t = setup();
    t.courier.holdTeammates = () => true;
    t.work.message("demo", "demo.aries", "lead", "hi");
    expect(t.courier.drainForStopHook("demo.leo")).toBeNull();
    t.work.message("demo", "owner", "lead", "stop now");
    expect(t.courier.drainForStopHook("demo.leo")).toContain("stop now");
  });

  it("the Stop hook blocks with queued messages", async () => {
    const t = setup();
    const token = t.db.agentToken("demo.leo");
    t.work.message("demo", "owner", "lead", "go");
    const r = await t.hooks.handle(token, "Stop", {});
    expect(r.body).toMatchObject({ decision: "block" });
    expect(t.db.agent("demo.leo")!.state).toBe("working");
    expect((await t.hooks.handle("bad-token", "Stop", {})).status).toBe(401);
  });

  it("types into an idle prompt and waits for the submit hook to confirm", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.store.updateAgent("demo.leo", { state: "ready" });
      t.courier.onHook("demo.leo", "SessionStart");
      t.work.message("demo", "owner", "lead", "hello");
      expect(t.typed).toHaveLength(0); // hooks have not settled yet
      expect(t.courier.readyForTyping("demo.leo")).toBe(false);
      await vi.advanceTimersByTimeAsync(1700);
      expect(t.typed.map((x) => x.text)).toEqual(["[Workforce] Message from You: hello"]);
      expect(t.courier.phaseOf("demo.leo")).toBe("confirming");
      expect(t.db.pendingMessages("demo.leo")).toHaveLength(0);
      t.courier.onHook("demo.leo", "UserPromptSubmit");
      expect(t.courier.phaseOf("demo.leo")).toBe("busy");
      t.courier.onHook("demo.leo", "SessionEnd");
      expect(t.courier.phaseOf("demo.leo")).toBe("offline");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never types while the agent is busy or offline", async () => {
    const t = setup();
    t.store.updateAgent("demo.leo", { state: "working" });
    t.work.message("demo", "owner", "lead", "later");
    await t.courier.attempt("demo.leo");
    expect(t.typed).toHaveLength(0);
    expect(t.courier.phaseOf("demo.leo")).toBe("offline");
  });
});

describe("permission prompts", () => {
  it("wait for the owner's decision and reply in Claude Code's format", async () => {
    const t = setup();
    const token = t.db.agentToken("demo.aries");
    const pending = t.hooks.handle(token, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm install zod" } });
    await new Promise((r) => setTimeout(r, 10));
    const need = t.db.openNeeds("demo").find((n) => n.kind === "permission")!;
    expect(need.title).toBe("Aries: Running npm install zod");
    await t.hooks.decide(need.id, true);
    expect((await pending).body).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
  });

  it("careful mode blocks secrets, docker, merging and pushing main", () => {
    const t = setup();
    const p = permissions("careful", t.project, t.db.agent("demo.aries")!, t.db.agents("demo"));
    expect(p.deny).toEqual(expect.arrayContaining(["Read(~/deploy/**)", "Bash(docker:*)", "Bash(gh pr merge:*)", "Bash(git push origin main:*)"]));
    expect(p.deny.some((d) => d.includes("/virgo/"))).toBe(true); // a teammate's folder
    expect(p.deny.some((d) => d.includes("/aries/"))).toBe(false); // not its own
    expect(p.allow).not.toContain("Bash");
  });

  it("role text names the sign and the rules", () => {
    const t = setup();
    const role = roleText(t.db.agent("demo.leo")!, t.project, t.db.agents("demo"));
    expect(role).toContain("You are Leo ♌");
    expect(role).toContain("You never write app code");
    expect(role).toContain("Aries ♈: developer");
  });
});
