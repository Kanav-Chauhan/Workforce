// Demo mode (/?demo=1): the preview's story, played as fake live events through the same store,
// director and office as the real thing. Buttons work too: Allow/Deny, answers, messages, start/stop.

import type { Activity, Agent, LiveFrame, LiveState, Message, Need, Project, Task } from "../../shared/types";
import type { TermEvents, TermKind, TermLink } from "./term/link";

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

  /** workers: 1–3 (the story uses Aries and Virgo; extras just live in the office). */
  constructor(private emit: Emit, private workers = 2) {}

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
    const team = [mk("leo", "Leo", true), mk("aries", "Aries", false), mk("virgo", "Virgo", false), mk("capricorn", "Capricorn", false), mk("libra", "Libra", false), mk("scorpio", "Scorpio", false)];
    for (const a of team.slice(0, 1 + Math.max(2, Math.min(5, this.workers)))) this.agents.set(a.id, a);
    if (this.workers === 1) this.agents.delete(this.id("virgo"));
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
    for (const fn of this.watchers.get(sign) ?? []) fn(line);
  }

  private watchers = new Map<string, Set<(line: string) => void>>();

  /** A fake live terminal: the story's lines in Claude Code colours, plus a toy shell. */
  openTerminal(kind: TermKind, agentId: string, ev: TermEvents): TermLink {
    const a = this.agents.get(agentId);
    const sign = a?.sign ?? "";
    const tick = (line: string) => `\x1b[38;2;47;174;122m●\x1b[0m ${line}\r\n`;
    let typed = "";
    let closed = false;
    const prompt = kind === "agent" ? "\x1b[1m>\x1b[0m " : `\x1b[1;32m${sign}@workforce\x1b[0m:\x1b[1;34m~/demo-repo\x1b[0m$ `;
    const redraw = () => ev.output(`\r\x1b[2K${prompt}${typed}`);
    const later = (fn: () => void, ms: number) => setTimeout(() => !closed && fn(), ms);
    later(() => {
      ev.notice("ready", "");
      if (kind === "agent") {
        ev.output(`\x1b[38;2;217;119;87m✻\x1b[0m \x1b[1mClaude Code\x1b[0m \x1b[2m(demo: nothing real runs)\x1b[0m\r\n\x1b[2m  cwd: ~/.workforce/projects/demo-repo/${sign}\x1b[0m\r\n\r\n`);
        for (const l of this.screens.get(sign) ?? []) ev.output(tick(l));
        ev.output("\r\n");
      } else ev.output(`\x1b[2mDemo shell in ${a?.name ?? "the agent"}'s folder. Try: git status, ls\x1b[0m\r\n`);
      redraw();
    }, 250);
    const onLine = (line: string) => {
      ev.output(`\r\x1b[2K${tick(line)}`);
      redraw();
    };
    if (kind === "agent") {
      if (!this.watchers.has(sign)) this.watchers.set(sign, new Set());
      this.watchers.get(sign)!.add(onLine);
    }
    const run = (cmd: string) => {
      const c = cmd.trim();
      if (kind === "agent") {
        if (c) ev.output(`\x1b[2m  (demo) ${a?.name ?? "The agent"} would read: ${c}\x1b[0m\r\n`);
        return;
      }
      if (c === "git status")
        ev.output(`On branch \x1b[36mwf-1-health-page\x1b[0m\r\nChanges not staged for commit:\r\n\t\x1b[31mmodified:   src/app.ts\x1b[0m\r\nUntracked files:\r\n\t\x1b[31msrc/health.ts\x1b[0m\r\n`);
      else if (c === "ls") ev.output(`README.md  \x1b[1;34msrc\x1b[0m  package.json  tsconfig.json\r\n`);
      else if (c) ev.output(`\x1b[2mdemo: "${c}" is not run in the demo\x1b[0m\r\n`);
    };
    return {
      keys: (data) => {
        for (const ch of data) {
          if (ch === "\r") {
            ev.output("\r\n");
            run(typed);
            typed = "";
            ev.output(prompt);
          } else if (ch === "\x7f") {
            if (typed) (typed = typed.slice(0, -1)), ev.output("\b \b");
          } else if (ch === "\x03") {
            typed = "";
            ev.output("^C\r\n" + prompt);
          } else if (ch === "\x1b") {
            if (kind === "agent" && data === "\x1b") ev.output(`\r\x1b[2K\x1b[2m  (demo) Esc pressed\x1b[0m\r\n${prompt}${typed}`);
            break; // arrow keys etc.: nothing to do in the demo
          } else if (ch >= " ") {
            typed += ch;
            ev.output(ch);
          }
        }
      },
      size: () => {},
      renew: () => {
        typed = "";
        ev.output("\x1b[H\x1b[2J\x1b[3J");
        redraw();
      },
      close: () => {
        closed = true;
        this.watchers.get(sign)?.delete(onLine);
      },
    };
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
    this.msg("owner", "leo", request);
    await this.sleep(1200);
    this.agent("leo", { state: "working", note: "Planning the owner's request" });
    await this.sleep(2500);
    this.task("WF-1", { title: "/health page", details: "Add a page at /health that returns ok and the app version.", files: ["app/health/page.tsx"], doneWhen: "GET /health shows ok", phase: "Phase 1" });
    this.act("leo", "Leo created WF-1 /health page");
    await this.sleep(700);
    this.task("WF-2", { title: "Site footer", details: "A footer with the year and a link to the repo.", files: ["components/Footer.tsx", "app/layout.tsx"], doneWhen: "Footer shows on every page", phase: "Phase 1" });
    this.act("leo", "Leo created WF-2 Site footer");
    await this.sleep(1200);

    this.task("WF-1", { ownerId: this.id("aries") });
    this.msg("workforce", "aries", "You have a new task: WF-1. Call my_task to start.");
    this.msg("leo", "aries", "WF-1 is yours: the /health page");
    this.act("leo", "Leo assigned WF-1 to Aries");
    await this.sleep(5500);
    this.agent("aries", { state: "working", note: "git checkout -b wf-1-health", taskId: "WF-1" });
    this.task("WF-1", { status: "working" });
    this.act("aries", "Aries started WF-1");
    this.task("WF-2", { ownerId: this.id("virgo") });
    this.msg("workforce", "virgo", "You have a new task: WF-2. Call my_task to start.");
    this.msg("leo", "virgo", "WF-2 is yours: the site footer");
    this.act("leo", "Leo assigned WF-2 to Virgo");
    await this.sleep(2500);
    this.agent("aries", { note: "Editing app/health/page.tsx" });
    await this.sleep(3500);
    this.agent("virgo", { state: "working", note: "Editing components/Footer.tsx", taskId: "WF-2" });
    this.task("WF-2", { status: "working" });
    this.act("virgo", "Virgo started WF-2");
    this.agent("leo", { state: "ready", note: "Watching the board" });
    await this.sleep(3000);

    // Aries needs permission.
    this.agent("aries", { state: "needs-you", note: "Asking: Running npm install zod" });
    this.act("aries", "Aries asks to: Running npm install zod");
    const perm = this.need("aries", "permission", "Aries: Running npm install zod", '{\n  "tool": "Bash",\n  "input": { "command": "npm install zod" }\n}');
    const permId = this.seq - 1;
    const d = await this.orAuto(perm, 14000, () => this.decide(permId, true, "(demo: allowed by itself)"));
    this.agent("aries", { state: "working", note: d.allow ? "Running npm install zod" : "Carrying on without zod" });
    await this.sleep(1500);

    // Virgo ships PR #4 and asks a question on the way.
    this.agent("virgo", { note: "Running npm test" });
    await this.sleep(2000);
    this.agent("virgo", { state: "needs-you", note: "Asking the owner" });
    this.act("virgo", "Virgo asks you: Show the year in the footer as 2026 or a live year?");
    const q = this.need("virgo", "question", "Show the year in the footer as 2026 or a live year?");
    const qId = this.seq - 1;
    const ans = await this.orAuto(q, 16000, () => this.answer(qId, "A live year, please (demo answer)"));
    this.msg("workforce", "virgo", `The owner answered: ${ans.answer}`);
    this.agent("virgo", { state: "working", note: "gh pr create" });
    this.agent("aries", { note: "Editing app/health/page.tsx" });
    await this.sleep(2500);
    this.task("WF-2", { status: "review", prNumber: 4 });
    this.act("virgo", "Virgo: WF-2 in review (PR #4)");
    this.agent("virgo", { state: "ready", note: "PR #4 in review", taskId: "WF-2" });
    await this.sleep(4500);
    this.msg("virgo", "leo", "PR #4 is ready for review");
    await this.sleep(6000);
    this.msg("leo", "virgo", "Nice. The owner will merge it.");
    await this.sleep(3500);

    // Aries finishes too.
    this.agent("aries", { note: "Running npm test" });
    await this.sleep(2200);
    this.task("WF-1", { status: "review", prNumber: 5 });
    this.act("aries", "Aries: WF-1 in review (PR #5)");
    this.agent("aries", { state: "ready", note: "PR #5 in review" });
    await this.sleep(4000);

    // You merge on GitHub.
    this.task("WF-2", { status: "done" });
    this.act(null, "You merged PR #4 · WF-2 done");
    this.msg("workforce", "leo", "PR #4 was merged. WF-2 is done.");
    this.agent("virgo", { state: "ready", note: "Finished, ready for more", taskId: null });
    await this.sleep(4000);
    this.msg("aries", "leo", "PR #5 is ready too");
    await this.sleep(6000);
    this.task("WF-1", { status: "done" });
    this.act(null, "You merged PR #5 · WF-1 done");
    this.msg("workforce", "leo", "PR #5 was merged. WF-1 is done.");
    this.agent("aries", { state: "ready", note: "Finished, ready for more", taskId: null });
    this.agent("leo", { state: "working", note: "Telling the owner: all done" });
    await this.sleep(2500);
    this.agent("leo", { state: "ready", note: "All tasks done" });
    this.act("leo", "Leo: all tasks done. The story starts again in a minute.");
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
