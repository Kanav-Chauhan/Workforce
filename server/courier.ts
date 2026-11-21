// The courier carries queued messages to agents. Claude Code has no inbox, so there are two doors:
//  1. Front door: the agent sits at its input prompt doing nothing → we put the text in the prompt
//     and submit it, then wait for the UserPromptSubmit hook to prove it landed.
//  2. Back door: the agent is mid-turn → the message waits; when the turn ends, the Stop hook asks
//     drainForStopHook() and Claude Code keeps going with the text instead of stopping.
// The database is the queue (delivered = 0 until handed over), so a server restart loses nothing.
//
// Each agent has a "seat" that moves through a few phases:
//
//   offline ──session seen──▶ idle ──we start typing──▶ typing ──Enter sent──▶ confirming
//      ▲                       ▲ ▲                                               │      │
//      │                       │ └──────── window ran out, no submit seen ───────┘      │
//    session ended            Stop hook                                     UserPromptSubmit
//      │                       │                                                        ▼
//      └─────────────────────── busy ◀───────────────────────────────────────────────────┘
//
// "confirming" gets one retry: Enter can be swallowed while Claude Code redraws its prompt.

import type { Message } from "../shared/types.ts";
import { composeHandover } from "./handover.ts";
import type { Store } from "./store.ts";

/** How the courier reaches a terminal. */
export interface PromptPort {
  /** Puts text into the input line without submitting it. */
  put(agentId: string, text: string): Promise<boolean>;
  /** Submits whatever is in the input line. */
  submit(agentId: string): Promise<boolean>;
}

export type SeatPhase = "offline" | "idle" | "typing" | "confirming" | "busy";

interface Seat {
  phase: SeatPhase;
  /** When any hook last arrived for this agent. */
  lastSignalAt: number;
  /** When we last had evidence the input prompt is on screen. */
  promptSeenAt: number;
  /** While confirming: give up waiting at this time. */
  confirmBy: number;
  /** Submit presses left for the current handover. */
  retriesLeft: number;
}

const SETTLE_MS = 1200; // hooks quiet this long → the prompt has finished redrawing
const CONFIRM_WINDOW_MS = 2500; // a submitted prompt fires UserPromptSubmit well within this
const SWEEP_EVERY_MS = 1500;
const PAUSE_BEFORE_SUBMIT_MS = 250;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Courier {
  private seats = new Map<string, Seat>();
  private sweepHandle: ReturnType<typeof setInterval> | undefined;
  /** True while the usage guard is on: only the owner's own words get through. */
  holdTeammates: () => boolean = () => false;

  constructor(private store: Store, private port: PromptPort) {}

  private seat(agentId: string): Seat {
    let s = this.seats.get(agentId);
    if (!s) {
      s = { phase: "offline", lastSignalAt: 0, promptSeenAt: 0, confirmBy: 0, retriesLeft: 0 };
      this.seats.set(agentId, s);
    }
    return s;
  }

  phaseOf(agentId: string): SeatPhase {
    return this.seat(agentId).phase;
  }

  // -------------------------------------------------------------- lifecycle

  /** Periodic sweep: retries anything still queued and settles overdue confirmations. */
  startSweep() {
    this.sweepHandle ??= setInterval(() => this.sweep(), SWEEP_EVERY_MS);
  }

  stopSweep() {
    clearInterval(this.sweepHandle);
    this.sweepHandle = undefined;
  }

  private sweep() {
    for (const a of this.store.db.agents()) {
      const s = this.seat(a.id);
      if (s.phase === "confirming" && Date.now() >= s.confirmBy) void this.confirmationLapsed(a.id);
      else void this.attempt(a.id);
    }
  }

  // -------------------------------------------------------------- signals in

  /** Something new is waiting for this agent. */
  queued(agentId: string) {
    void this.attempt(agentId);
  }

  /** Every Claude Code hook is reported here before anything else looks at it. */
  onHook(agentId: string, event: string) {
    const s = this.seat(agentId);
    s.lastSignalAt = Date.now();
    switch (event) {
      case "SessionStart":
        s.phase = "idle";
        s.promptSeenAt = Date.now();
        this.later(agentId);
        break;
      case "SessionEnd":
        s.phase = "offline";
        break;
      case "UserPromptSubmit":
        // Ours (confirming) or the owner typing in the terminal: either way a turn is running.
        s.phase = "busy";
        break;
      case "Stop":
        s.phase = "idle";
        s.promptSeenAt = Date.now();
        this.later(agentId);
        break;
    }
  }

  /** The screen shows the input prompt (used after a server restart, when SessionStart was missed). */
  markPromptVisible(agentId: string) {
    const s = this.seat(agentId);
    s.promptSeenAt = Date.now();
    // The watcher only calls this after several quiet seconds with no "busy" marker on screen,
    // so a seat still marked busy here simply missed its Stop hook.
    if (s.phase === "offline" || s.phase === "busy") s.phase = "idle";
  }

  markOffline(agentId: string) {
    this.seat(agentId).phase = "offline";
  }

  /** Milliseconds since this agent's last hook. */
  silenceMs(agentId: string) {
    return Date.now() - this.seat(agentId).lastSignalAt;
  }

  private later(agentId: string) {
    setTimeout(() => void this.attempt(agentId), SETTLE_MS + 100);
  }

  // -------------------------------------------------------------- the two doors

  private outbox(agentId: string): Message[] {
    const waiting = this.store.db.pendingMessages(agentId);
    return this.holdTeammates() ? waiting.filter((m) => m.fromId === "owner") : waiting;
  }

  private letter(batch: Message[]) {
    return composeHandover(batch, (id) => this.store.nameOf(id));
  }

  /** Back door. The Stop hook calls this: the queue as one text to continue with, or null if empty. */
  drainForStopHook(agentId: string): string | null {
    const batch = this.outbox(agentId);
    if (!batch.length) return null;
    this.store.db.markDelivered(batch.map((m) => m.id));
    this.seat(agentId).phase = "busy";
    return this.letter(batch);
  }

  /** Front door is open: idle seat, the agent's status allows it, and the hooks have settled. */
  readyForTyping(agentId: string): boolean {
    const s = this.seat(agentId);
    if (s.phase !== "idle" || this.silenceMs(agentId) < SETTLE_MS) return false;
    // A blocked agent is parked at its prompt waiting for exactly these messages.
    const state = this.store.db.agent(agentId)?.state;
    return state === "ready" || state === "blocked";
  }

  /** Front door: types the whole queue and submits it, if the agent can take it right now. */
  async attempt(agentId: string) {
    if (!this.readyForTyping(agentId)) return;
    const batch = this.outbox(agentId);
    if (!batch.length) return;
    const s = this.seat(agentId);
    s.phase = "typing";
    if (!(await this.port.put(agentId, this.letter(batch)))) {
      s.phase = "idle";
      return;
    }
    // The text is in the prompt now; from here on the agent will see it either way.
    this.store.db.markDelivered(batch.map((m) => m.id));
    await pause(PAUSE_BEFORE_SUBMIT_MS);
    s.retriesLeft = 1;
    await this.pressSubmit(agentId);
  }

  private async pressSubmit(agentId: string) {
    const s = this.seat(agentId);
    if (s.phase !== "typing" && s.phase !== "confirming") return;
    s.phase = "confirming";
    s.confirmBy = Date.now() + CONFIRM_WINDOW_MS;
    await this.port.submit(agentId);
  }

  /** No UserPromptSubmit inside the window: press once more, then give the seat back. */
  private async confirmationLapsed(agentId: string) {
    const s = this.seat(agentId);
    const state = this.store.db.agent(agentId)?.state;
    if (s.retriesLeft > 0 && (state === "ready" || state === "blocked")) {
      s.retriesLeft--;
      await this.pressSubmit(agentId);
      return;
    }
    s.phase = "idle";
  }
}
