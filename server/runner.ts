// Starting, stopping and watching agents. Each agent is `claude` in its own tmux session,
// working in its own clone, with its private files passed on the command line.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Agent } from "../shared/types.ts";
import { transcriptFile, writeAgentFiles } from "./agentFiles.ts";
import type { Delivery } from "./delivery.ts";
import type { Hooks } from "./hooks.ts";
import { agentDir, ensureDir, projectDir } from "./paths.ts";
import type { Store } from "./store.ts";
import { run, shellQuote, tmux } from "./tmux.ts";

// What Claude Code's screen shows (used only when hooks have gone quiet).
const BUSY = /esc to interrupt/i;
const TRUST = /trust the files in this folder|Do you trust|Yes, I trust/i;
const DIALOG = /Do you want to (proceed|make this edit|create|run)|Would you like to proceed|❯\s*1\.\s*Yes/i;
const PROMPT = /\? for shortcuts|⏵⏵|accept edits on|bypass permissions/i;

const SCREEN_AFTER_MS = 4000; // only read the screen after this much hook silence
const STALE_WORKING_MS = 20_000; // "working" with an idle screen this long = a missed Stop

export const sessionName = (agent: Agent) => `wf-${agent.projectId}-${agent.sign}`;

export class Runner {
  private timer: NodeJS.Timeout | null = null;
  private idleSeen = new Map<string, number>();
  private starting = new Set<string>();

  constructor(private store: Store, private delivery: Delivery, private hooks: Hooks) {
    hooks.pressKeys = async (agentId, allow, kind) => {
      const a = this.store.db.agent(agentId);
      if (!a) return;
      const name = sessionName(a);
      if (!allow) return void (await tmux.key(name, "Escape"));
      // The trust prompt highlights "No, exit" first: move down to "Yes, I trust this folder".
      // Permission prompts highlight "Yes" first.
      if (kind === "trust") await tmux.key(name, "Down");
      await tmux.key(name, "Enter");
    };
  }

  private get db() {
    return this.store.db;
  }

  /** Clones the repo into the agent's folder if it isn't there yet. */
  async ensureClone(agent: Agent): Promise<string> {
    const project = this.db.project(agent.projectId)!;
    const dir = agentDir(project.id, agent.sign);
    if (existsSync(dir)) return dir;
    ensureDir(projectDir(project.id));
    this.store.updateAgent(agent.id, { note: "Cloning the repo…" });
    const r = await run("gh", ["repo", "clone", project.repo, dir, "--", "--quiet"], { timeoutMs: 600_000 });
    if (!r.ok) throw new Error(`Could not clone ${project.repo}: ${r.stderr.trim().split("\n").pop()}`);
    return dir;
  }

  async start(agentId: string) {
    const agent = this.db.agent(agentId);
    if (!agent || this.starting.has(agentId)) return;
    const name = sessionName(agent);
    if (await tmux.exists(name)) return;
    this.starting.add(agentId);
    try {
      const project = this.db.project(agent.projectId)!;
      const dir = await this.ensureClone(agent);
      const files = writeAgentFiles(agent, project, this.db.agents(project.id), this.db.agentToken(agent.id));
      // Same conversation after a restart if Claude Code saved one; a fresh id otherwise.
      let sessionId = agent.sessionId;
      const resume = existsSync(transcriptFile(dir, sessionId));
      if (!resume && !sessionId) {
        sessionId = randomUUID();
        this.db.updateAgent(agent.id, { sessionId });
      }
      const args = [
        "claude",
        ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
        "--append-system-prompt-file", files.role,
        // Only Workforce's settings count: the machine owner's own settings (which may allow everything)
        // and settings a repo commits are ignored, so the permission rules here are the real ones.
        "--setting-sources", "local",
        "--settings", files.settings,
        "--mcp-config", files.mcp, "--strict-mcp-config",
        ...(agent.model ? ["--model", agent.model] : []),
      ];
      this.delivery.sessionGone(agent.id);
      this.hooks.forgetTurn(agent.id);
      await tmux.start(name, dir, args.map(shellQuote).join(" "));
      this.store.updateAgent(agent.id, { state: "ready", note: resume ? "Resuming…" : "Starting…" });
      this.store.activity(project.id, agent.id, `${agent.name} started${resume ? " (same conversation as before)" : ""}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.updateAgent(agent.id, { state: "off", note: `Couldn't start: ${msg}`.slice(0, 200) });
      this.store.activity(agent.projectId, agent.id, `${agent.name} couldn't start: ${msg}`);
    } finally {
      this.starting.delete(agentId);
    }
  }

  async stop(agentId: string) {
    const agent = this.db.agent(agentId);
    if (!agent) return;
    await tmux.kill(sessionName(agent));
    this.delivery.sessionGone(agent.id);
    this.hooks.forgetTurn(agent.id);
    this.store.updateAgent(agent.id, { state: "off", note: "Stopped" });
    this.store.activity(agent.projectId, agent.id, `${agent.name} stopped`);
  }

  async restart(agentId: string) {
    await this.stop(agentId);
    await this.start(agentId);
  }

  /** Starts a new conversation next time (the old one is kept by Claude Code). */
  async fresh(agentId: string) {
    await this.stop(agentId);
    this.db.updateAgent(agentId, { sessionId: randomUUID() });
    await this.start(agentId);
  }

  async screen(agentId: string, lines = 60) {
    const agent = this.db.agent(agentId);
    return agent ? tmux.screen(sessionName(agent), lines) : "";
  }

  // -------------------------------------------------------------- watching

  startWatching() {
    const tick = async () => {
      for (const agent of this.db.agents()) await this.check(agent).catch(() => {});
    };
    void tick();
    this.timer = setInterval(() => void tick(), 3000);
  }

  stopWatching() {
    if (this.timer) clearInterval(this.timer);
  }

  private async check(agent: Agent) {
    if (this.starting.has(agent.id)) return;
    const name = sessionName(agent);
    const alive = await tmux.exists(name);
    if (!alive) {
      if (agent.state !== "off") {
        this.delivery.sessionGone(agent.id);
        this.store.updateAgent(agent.id, { state: "off", note: "Not running" });
      }
      return;
    }
    const exit = await tmux.exited(name);
    if (exit.dead) {
      const why = (await tmux.screen(name, 4)).split("\n").pop() || `exit code ${exit.code}`;
      await tmux.kill(name);
      this.delivery.sessionGone(agent.id);
      this.store.updateAgent(agent.id, { state: "off", note: `Ended: ${why}`.slice(0, 200) });
      this.store.activity(agent.projectId, agent.id, `${agent.name}'s session ended (${why})`);
      return;
    }
    if (agent.state === "off") this.store.updateAgent(agent.id, { state: "ready", note: "Running (reattached)" });
    if (this.delivery.quietFor(agent.id) < SCREEN_AFTER_MS || this.hooks.hasWaiting(agent.id)) return;

    const screen = await tmux.screen(name, 15);
    if (!screen) return;
    const fresh = this.db.agent(agent.id)!;
    if (TRUST.test(screen)) return this.hooks.screenPrompt(fresh, "trust", `${fresh.name}: trust this folder?`, "Claude Code asks whether to trust the agent's repo folder before it starts. Allow = Yes.");
    if (DIALOG.test(screen)) return this.hooks.screenPrompt(fresh, "permission", `${fresh.name}: answer the prompt in its terminal`, screen.slice(-1500));
    const busy = BUSY.test(screen);
    const atPrompt = PROMPT.test(screen) && !busy;
    if (atPrompt) this.delivery.promptReady(agent.id);
    if (busy && fresh.state === "ready") return this.store.updateAgent(agent.id, { state: "working", note: "Working" });
    if (fresh.state === "needs-you" && busy) return this.store.updateAgent(agent.id, { state: "working", note: "Continuing" });
    if (fresh.state === "needs-you" && atPrompt) return this.store.updateAgent(agent.id, { state: "ready", note: "Waiting for instructions" });
    if (fresh.state === "working" && atPrompt) {
      const n = (this.idleSeen.get(agent.id) ?? 0) + 1;
      this.idleSeen.set(agent.id, n);
      if (n >= 2 && this.delivery.quietFor(agent.id) >= STALE_WORKING_MS) {
        this.idleSeen.delete(agent.id);
        this.store.updateAgent(agent.id, { state: "ready", note: "Finished, ready for more" });
      }
      return;
    }
    this.idleSeen.delete(agent.id);
  }
}
