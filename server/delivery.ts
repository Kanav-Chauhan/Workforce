// Getting messages to an agent. Claude Code has no inbox, so:
//  - agent idle at its prompt → type the message into its terminal and press Enter;
//  - agent busy → keep it queued; when the agent's turn ends, its Stop hook collects the queue
//    and Claude Code carries on with it instead of stopping.
// Messages live in the database (delivered = 0 until handed over), so nothing is lost on restart.

import type { Message } from "../shared/types.ts";
import type { Store } from "./store.ts";

export interface Keyboard {
  type(agentId: string, text: string): Promise<boolean>;
  enter(agentId: string): Promise<boolean>;
}

const QUIET_MS = 1200; // no hook for this long = the prompt has settled
const SUBMIT_CHECK_MS = 3000; // a typed message should cause UserPromptSubmit by then

export class Delivery {
  private promptUp = new Set<string>(); // Claude Code's input prompt exists
  private lastHook = new Map<string, number>();
  private lastSubmit = new Map<string, number>();
  private typing = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  /** When true, only the owner's own messages go through (usage guard). */
  paused: () => boolean = () => false;

  constructor(private store: Store, private keys: Keyboard) {}

  start() {
    // Safety net: retry anything still queued every 2 seconds.
    this.timer = setInterval(() => {
      for (const a of this.store.db.agents()) void this.tryNow(a.id);
    }, 2000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** A message was queued for this agent. */
  nudge(agentId: string) {
    void this.tryNow(agentId);
  }

  /** Every hook passes through here first. */
  sawHook(agentId: string, event: string) {
    this.lastHook.set(agentId, Date.now());
    if (event === "SessionStart") this.promptUp.add(agentId);
    if (event === "SessionEnd") this.promptUp.delete(agentId);
    if (event === "UserPromptSubmit") this.lastSubmit.set(agentId, Date.now());
    if (event === "Stop" || event === "SessionStart") setTimeout(() => void this.tryNow(agentId), QUIET_MS + 100);
  }

  /** The session is up even though we missed SessionStart (e.g. the server restarted). */
  promptReady(agentId: string) {
    this.promptUp.add(agentId);
  }

  sessionGone(agentId: string) {
    this.promptUp.delete(agentId);
  }

  quietFor(agentId: string) {
    return Date.now() - (this.lastHook.get(agentId) ?? 0);
  }

  private deliverable(agentId: string): Message[] {
    const pending = this.store.db.pendingMessages(agentId);
    return this.paused() ? pending.filter((m) => m.fromId === "owner") : pending;
  }

  /** Called by the Stop hook: the queue as one text Claude continues with, or null. */
  takeForStop(agentId: string): string | null {
    const msgs = this.deliverable(agentId);
    if (!msgs.length) return null;
    this.store.db.markDelivered(msgs.map((m) => m.id));
    return this.format(msgs);
  }

  private canType(agentId: string) {
    const a = this.store.db.agent(agentId);
    // "blocked" agents sit idle at their prompt too, waiting for exactly these messages.
    return !!a && (a.state === "ready" || a.state === "blocked") && this.promptUp.has(agentId) && !this.typing.has(agentId) && this.quietFor(agentId) >= QUIET_MS;
  }

  async tryNow(agentId: string) {
    if (!this.deliverable(agentId).length || !this.canType(agentId)) return;
    const msgs = this.deliverable(agentId);
    this.typing.add(agentId);
    const typedAt = Date.now();
    try {
      if (!(await this.keys.type(agentId, this.format(msgs)))) return;
      this.store.db.markDelivered(msgs.map((m) => m.id));
      await new Promise((r) => setTimeout(r, 250));
      await this.keys.enter(agentId);
      // Enter sometimes gets swallowed while the prompt redraws: press it once more if nothing was submitted.
      await new Promise((r) => setTimeout(r, SUBMIT_CHECK_MS));
      if ((this.lastSubmit.get(agentId) ?? 0) < typedAt && ["ready", "blocked"].includes(this.store.db.agent(agentId)?.state ?? "")) await this.keys.enter(agentId);
    } finally {
      this.typing.delete(agentId);
    }
  }

  /** One line: a newline would submit the prompt early. */
  format(msgs: Message[]): string {
    const parts = msgs.map((m) => (m.fromId === "workforce" ? `[Workforce] ${m.text}` : `[Workforce] Message from ${this.store.nameOf(m.fromId)}: ${m.text}`));
    const fromTeammate = msgs.some((m) => m.fromId !== "workforce" && m.fromId !== "owner");
    const tail = fromTeammate ? "  (Reply with the message tool only if a reply is needed.)" : "";
    return (parts.join("  |  ") + tail).replace(/\s*\n\s*/g, " ");
  }
}
