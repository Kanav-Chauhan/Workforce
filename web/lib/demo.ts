// Demo mode (/?demo=1): the preview's story, played as fake live events through the same store,
// director and office as the real thing. Buttons work too: Allow/Deny, answers, messages, start/stop.

import type { Activity, Agent, LiveFrame, LiveState, Message, Need, Project, Task } from "../../shared/types";

type Emit = (f: LiveFrame) => void;

const P = "demo-repo";
const iso = () => new Date().toISOString();

export class DemoStory {
  private agents = new Map<string, Agent>();
  private tasks = new Map<string, Task>();
  private needs = new Map<number, Need>();
  private seq = 1;
  private run = 0;
  private waits = new Map<number, (v: { allow: boolean; answer: string }) => void>();
  private screens = new Map<string, string[]>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private project: Project = { id: P, repo: "you/demo-repo", name: "demo-repo", prefix: "WF", defaultBranch: "main", permissionStyle: "careful", createdAt: iso() };

  constructor(private emit: Emit) {}

  start() {
    void this.loop("Add a /health page and a footer");
  }

  stop() {
    this.run++;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ------------------------------------------------------------ state helpers

  private initial(): LiveState {
    this.agents.clear();
    this.tasks.clear();
    this.needs.clear();
    this.screens.clear();
    const mk = (sign: string, name: string, isLead: boolean): Agent => ({
      id: `${P}.${sign}`, projectId: P, sign, name, isLead, extraRole: "", model: "", sessionId: "", state: "ready", note: "Waiting for instructions", taskId: null, stateSince: iso(),
    });
    for (const a of [mk("simha", "Simha", true), mk("mesha", "Mesha", false), mk("kanya", "Kanya", false)]) this.agents.set(a.id, a);
    return {
      projects: [this.project],
      agents: [...this.agents.values()],
      tasks: [],
      needs: [],
      usage: { percent: 42, resetsAt: null, limit: 90, pausedByOwner: false, paused: false },
      activity: [{ id: this.seq++, projectId: P, agentId: null, text: "Demo: a scripted story with fake agents. Nothing real runs.", at: iso() }],
      messages: [],
    };
  }

  private id = (sign: string) => `${P}.${sign}`;

  private agent(sign: string, patch: Partial<Agent>) {
    const a = this.agents.get(this.id(sign));
    if (!a) return;
    const next = { ...a, ...patch, stateSince: patch.state && patch.state !== a.state ? iso() : a.stateSince };
    this.agents.set(a.id, next);
    this.emit({ type: "agent", agent: next });
    if (patch.note) this.term(sign, patch.note);
  }

  private term(sign: string, line: string) {
    const l = this.screens.get(sign) ?? [];
    l.push(line);
    if (l.length > 30) l.shift();
    this.screens.set(sign, l);
  }

  private act(sign: string | null, text: string) {
    const a: Activity = { id: this.seq++, projectId: P, agentId: sign ? this.id(sign) : null, text, at: iso() };
    this.emit({ type: "activity", activity: a });
  }

  private msg(from: string, to: string, text: string) {
    const m: Message = { id: this.seq++, projectId: P, fromId: from === "owner" || from === "workforce" ? from : this.id(from), toId: this.id(to), text, delivered: true, at: iso() };
    this.emit({ type: "message", message: m });
    if (from !== "workforce") this.act(from === "owner" ? null : from, `${from === "owner" ? "You" : cap(from)} → ${cap(to)}: ${text}`);
  }

  private task(id: string, patch: Partial<Task>) {
    const before = this.tasks.get(id);
    const t: Task = {
      id, projectId: P, title: "", details: "", files: [], doneWhen: "", dependsOn: [], phase: "", status: "todo", ownerId: null, prNumber: null, note: "", createdAt: iso(), updatedAt: iso(),
      ...before, ...patch,
    };
    t.updatedAt = iso();
    this.tasks.set(id, t);
    this.emit({ type: "task", task: t });
  }

  private need(sign: string, kind: Need["kind"], title: string, details = ""): Promise<{ allow: boolean; answer: string }> {
    const n: Need = { id: this.seq++, projectId: P, agentId: this.id(sign), kind, title, details, status: "open", answer: "", at: iso() };
    this.needs.set(n.id, n);
    this.emit({ type: "need", need: n });
    return new Promise((res) => this.waits.set(n.id, res));
  }

  private closeNeed(id: number, answer: string, allow: boolean) {
    const n = this.needs.get(id);
    if (!n || n.status !== "open") throw new Error("Nothing open with that id");
    const done = { ...n, status: "done" as const, answer };
    this.needs.set(id, done);
    this.emit({ type: "need", need: done });
    this.waits.get(id)?.({ allow, answer });
    this.waits.delete(id);
    return done;
  }

  private sleep(ms: number) {
    const run = this.run;
    return new Promise<void>((res, rej) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        if (run === this.run) res();
        else rej(new Error("stopped"));
      }, ms);
      this.timers.add(t);
    });
  }

  /** Waits for the owner, but answers by itself after `ms` so the story keeps going. */
  private async orAuto<T>(p: Promise<T>, ms: number, auto: () => void): Promise<T> {
    const t = setTimeout(auto, ms);
    this.timers.add(t);
    try {
      return await p;
    } finally {
      clearTimeout(t);
    }
  }

  // ------------------------------------------------------------ the story

  private async loop(first: string) {
    this.stop();
    const run = this.run;
    let text = first;
    try {
      for (;;) {
        this.emit({ type: "init", state: this.initial() });
        await this.story(text);
        if (run !== this.run) return;
        text = "Add a /health page and a footer";
      }
    } catch {
      /* stopped */
    }
  }

  private async story(request: string) {
    await this.sleep(1500);
    this.msg("owner", "simha", request);
    await this.sleep(1200);
    this.agent("simha", { state: "working", note: "Planning the owner's request" });
    await this.sleep(2500);
    this.task("WF-1", { title: "/health page", details: "Add a page at /health that returns ok and the app version.", files: ["app/health/page.tsx"], doneWhen: "GET /health shows ok", phase: "Phase 1" });
    this.act("simha", "Simha created WF-1 /health page");
    await this.sleep(700);
    this.task("WF-2", { title: "Site footer", details: "A footer with the year and a link to the repo.", files: ["components/Footer.tsx", "app/layout.tsx"], doneWhen: "Footer shows on every page", phase: "Phase 1" });
    this.act("simha", "Simha created WF-2 Site footer");
    await this.sleep(1200);

    this.task("WF-1", { ownerId: this.id("mesha") });
    this.msg("workforce", "mesha", "You have a new task: WF-1. Call my_task to start.");
    this.msg("simha", "mesha", "WF-1 is yours: the /health page");
    this.act("simha", "Simha assigned WF-1 to Mesha");
    await this.sleep(5500);
    this.agent("mesha", { state: "working", note: "git checkout -b wf-1-health", taskId: "WF-1" });
    this.task("WF-1", { status: "working" });
    this.act("mesha", "Mesha started WF-1");
    this.task("WF-2", { ownerId: this.id("kanya") });
    this.msg("workforce", "kanya", "You have a new task: WF-2. Call my_task to start.");
    this.msg("simha", "kanya", "WF-2 is yours: the site footer");
    this.act("simha", "Simha assigned WF-2 to Kanya");
    await this.sleep(2500);
    this.agent("mesha", { note: "Editing app/health/page.tsx" });
    await this.sleep(3500);
    this.agent("kanya", { state: "working", note: "Editing components/Footer.tsx", taskId: "WF-2" });
    this.task("WF-2", { status: "working" });
    this.act("kanya", "Kanya started WF-2");
    this.agent("simha", { state: "ready", note: "Watching the board" });
    await this.sleep(3000);

    // Mesha needs permission.
    this.agent("mesha", { state: "needs-you", note: "Asking: Running npm install zod" });
    this.act("mesha", "Mesha asks to: Running npm install zod");
    const perm = this.need("mesha", "permission", "Mesha: Running npm install zod", '{\n  "tool": "Bash",\n  "input": { "command": "npm install zod" }\n}');
    const permId = this.seq - 1;
    const d = await this.orAuto(perm, 14000, () => this.decide(permId, true, "(demo: allowed by itself)"));
    this.agent("mesha", { state: "working", note: d.allow ? "Running npm install zod" : "Carrying on without zod" });
    await this.sleep(1500);

    // Kanya ships PR #4 and asks a question on the way.
    this.agent("kanya", { note: "Running npm test" });
    await this.sleep(2000);
    this.agent("kanya", { state: "needs-you", note: "Asking the owner" });
    this.act("kanya", "Kanya asks you: Show the year in the footer as 2026 or a live year?");
    const q = this.need("kanya", "question", "Show the year in the footer as 2026 or a live year?");
    const qId = this.seq - 1;
    const ans = await this.orAuto(q, 16000, () => this.answer(qId, "A live year, please (demo answer)"));
    this.msg("workforce", "kanya", `The owner answered: ${ans.answer}`);
    this.agent("kanya", { state: "working", note: "gh pr create" });
    this.agent("mesha", { note: "Editing app/health/page.tsx" });
    await this.sleep(2500);
    this.task("WF-2", { status: "review", prNumber: 4 });
    this.act("kanya", "Kanya: WF-2 in review (PR #4)");
    this.agent("kanya", { state: "ready", note: "PR #4 in review", taskId: "WF-2" });
    await this.sleep(4500);
    this.msg("kanya", "simha", "PR #4 is ready for review");
    await this.sleep(6000);
    this.msg("simha", "kanya", "Nice. The owner will merge it.");
    await this.sleep(3500);

    // Mesha finishes too.
    this.agent("mesha", { note: "Running npm test" });
    await this.sleep(2200);
    this.task("WF-1", { status: "review", prNumber: 5 });
    this.act("mesha", "Mesha: WF-1 in review (PR #5)");
    this.agent("mesha", { state: "ready", note: "PR #5 in review" });
    await this.sleep(4000);

    // You merge on GitHub.
    this.task("WF-2", { status: "done" });
    this.act(null, "You merged PR #4 · WF-2 done");
    this.msg("workforce", "simha", "PR #4 was merged. WF-2 is done.");
    this.agent("kanya", { state: "ready", note: "Finished, ready for more", taskId: null });
    await this.sleep(4000);
    this.msg("mesha", "simha", "PR #5 is ready too");
    await this.sleep(6000);
    this.task("WF-1", { status: "done" });
    this.act(null, "You merged PR #5 · WF-1 done");
    this.msg("workforce", "simha", "PR #5 was merged. WF-1 is done.");
    this.agent("mesha", { state: "ready", note: "Finished, ready for more", taskId: null });
    this.agent("simha", { state: "working", note: "Telling the owner: all done" });
    await this.sleep(2500);
    this.agent("simha", { state: "ready", note: "All tasks done" });
    this.act("simha", "Simha: all tasks done. The story starts again in a minute.");
    await this.sleep(60000);
  }

  // ------------------------------------------------------------ the fake API

  private decide(id: number, allow: boolean, note = "") {
    const n = this.closeNeed(id, allow ? `Allowed${note ? `: ${note}` : ""}` : `Denied${note ? `: ${note}` : ""}`, allow);
    this.act(n.agentId ? n.agentId.split(".")[1]! : null, `You ${allow ? "allowed" : "denied"}: ${n.title}`);
    return n;
  }

  private answer(id: number, answer: string) {
    return this.closeNeed(id, answer, true);
  }

  async handle(method: string, path: string, body?: unknown): Promise<unknown> {
    const b = (body ?? {}) as Record<string, unknown>;
    let m: RegExpExecArray | null;
    if ((m = /^\/api\/needs\/(\d+)\/decide$/.exec(path))) return this.decide(Number(m[1]), !!b.allow, String(b.note ?? ""));
    if ((m = /^\/api\/needs\/(\d+)\/answer$/.exec(path))) return this.answer(Number(m[1]), String(b.answer ?? ""));
    if ((m = /^\/api\/agents\/([^/]+)\/screen/.exec(path))) {
      const a = this.agents.get(decodeURIComponent(m[1]!));
      const lines = this.screens.get(a?.sign ?? "") ?? [];
      return { screen: ["╭─ Claude Code (demo) ─────────────╮", ...lines.map((l) => `● ${l}`), "", a?.state === "working" ? "✻ Working… (esc to interrupt)" : "> "].join("\n") };
    }
    if ((m = /^\/api\/agents\/([^/]+)\/type$/.exec(path))) {
      const a = this.agents.get(decodeURIComponent(m[1]!));
      if (a && b.text) this.term(a.sign, `> ${String(b.text)}`);
      return { ok: true };
    }
    if ((m = /^\/api\/agents\/([^/]+)\/(start|stop|restart|fresh)$/.exec(path))) {
      const a = this.agents.get(decodeURIComponent(m[1]!));
      if (!a) throw new Error("No such agent");
      this.agent(a.sign, m[2] === "stop" ? { state: "off", note: "Stopped" } : { state: "ready", note: "Started" });
      return this.agents.get(a.id);
    }
    if ((m = /^\/api\/projects\/[^/]+\/team\/(start|stop)$/.exec(path))) {
      for (const a of this.agents.values()) this.agent(a.sign, m[1] === "stop" ? { state: "off", note: "Stopped" } : { state: "ready", note: "Started" });
      return { ok: true };
    }
    if (/^\/api\/projects\/[^/]+\/message$/.test(path)) {
      const text = String(b.text ?? "").trim() || "Add a /health page and a footer";
      void this.loop(text);
      return { ok: true };
    }
    if (/^\/api\/projects\/[^/]+\/agents$/.test(path)) throw new Error("The demo team is fixed. Add agents in a real project.");
    if (path === "/api/projects" && method === "POST") throw new Error("Demo mode: leave the demo to add real projects.");
    if ((m = /^\/api\/tasks\/([^/]+)\/assign$/.exec(path))) {
      const to = [...this.agents.values()].find((a) => a.id === b.to || a.sign === b.to);
      if (!to) throw new Error("No such agent");
      this.task(m[1]!, { ownerId: to.id });
      return this.tasks.get(m[1]!);
    }
    if (path === "/api/usage") return { percent: 42, resetsAt: null, limit: 90, pausedByOwner: !!b.paused, paused: !!b.paused };
    if (/^\/api\/projects\/[^/]+\/feed$/.test(path)) return { activity: [], messages: [] };
    throw new Error("Not in the demo");
  }
}

const cap = (sign: string) => sign.charAt(0).toUpperCase() + sign.slice(1);
