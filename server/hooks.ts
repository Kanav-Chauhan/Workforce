// Claude Code hooks arrive here: POST /hook/<event> with the agent's token.
// They drive the agent's status, hand queued messages over at Stop, and route
// permission prompts to the owner's "Needs you" list.

import type { Agent, Need } from "../shared/types.ts";
import { PERMISSION_WAIT_S } from "./agentFiles.ts";
import type { Courier } from "./courier.ts";
import { describeTool, nextStatus, turnAfter, type HookBody } from "./status.ts";
import type { Store } from "./store.ts";

type Decision = { allow: boolean; note: string };

export interface HookReply {
  status: number;
  body?: Record<string, unknown>;
}

export class Hooks {
  private inTurn = new Map<string, boolean>();
  /** Permission prompts waiting for the owner: need id → resolver. */
  private waiting = new Map<number, (d: Decision | null) => void>();
  /** Called when the owner answers a prompt that only exists on screen (no hook waiting). */
  pressKeys: (agentId: string, allow: boolean, kind: "permission" | "trust") => Promise<void> = async () => {};

  constructor(private store: Store, private courier: Courier) {}

  private get db() {
    return this.store.db;
  }

  async handle(token: string, event: string, body: HookBody): Promise<HookReply> {
    const agent = this.db.agentByToken(token);
    if (!agent) return { status: 401 };
    this.courier.onHook(agent.id, event);

    // Anything the agent does after a prompt means that prompt was answered (in the terminal or here).
    if (event === "PostToolUse" || event === "UserPromptSubmit" || event === "Stop" || event === "SessionEnd") this.closeScreenPrompts(agent);

    const turn = turnAfter(event);
    const next = nextStatus({ state: agent.state, note: agent.note }, event, body, this.inTurn.get(agent.id));
    if (turn !== undefined) this.inTurn.set(agent.id, turn);

    if (event === "Stop") {
      const queued = this.courier.drainForStopHook(agent.id);
      if (queued) {
        // Keep going: Claude Code reads the reason and continues with it.
        this.inTurn.set(agent.id, true);
        this.store.updateAgent(agent.id, { state: "working", note: "Reading new messages" });
        return { status: 200, body: { decision: "block", reason: queued } };
      }
    }
    if (next) this.store.updateAgent(agent.id, next);
    if (event === "Stop") this.store.activity(agent.projectId, agent.id, `${agent.name} finished a step`);
    if (event === "Notification" && next?.state === "needs-you") this.store.activity(agent.projectId, agent.id, `${agent.name} needs you: ${next.note}`);

    if (event === "PermissionRequest") return this.permission(agent, body);
    return { status: 200, body: {} };
  }

  /** Shows the prompt in Needs you and waits for the owner (up to the hook's timeout). */
  private async permission(agent: Agent, body: HookBody): Promise<HookReply> {
    const what = describeTool(body.tool_name, body.tool_input);
    const details = JSON.stringify({ tool: body.tool_name, input: body.tool_input }, null, 2);
    const need = this.store.addNeed(agent.projectId, agent.id, "permission", `${agent.name}: ${what}`, details);
    this.store.activity(agent.projectId, agent.id, `${agent.name} asks to: ${what}`);
    const decision = await new Promise<Decision | null>((resolve) => {
      this.waiting.set(need.id, resolve);
      setTimeout(() => resolve(null), (PERMISSION_WAIT_S - 20) * 1000);
    });
    this.waiting.delete(need.id);
    if (!decision) {
      // No answer in time: let Claude Code show its normal prompt in the terminal. The screen check picks it up.
      this.store.closeNeed(need.id, "No answer in time; the prompt is waiting in the terminal.");
      return { status: 200, body: {} };
    }
    this.store.updateAgent(agent.id, { state: "working", note: decision.allow ? "Allowed by you" : "Denied by you" });
    return {
      status: 200,
      body: {
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: decision.allow ? { behavior: "allow" } : { behavior: "deny", message: decision.note || "The owner said no. Find another way or ask the owner." },
        },
      },
    };
  }

  /** The owner pressed Allow or Deny on a permission or trust item. */
  async decide(needId: number, allow: boolean, note = ""): Promise<Need> {
    const need = this.db.need(needId);
    if (!need || need.status !== "open" || (need.kind !== "permission" && need.kind !== "trust")) throw new Error("Nothing to decide with that id");
    this.store.closeNeed(needId, allow ? `Allowed${note ? `: ${note}` : ""}` : `Denied${note ? `: ${note}` : ""}`);
    const waiter = this.waiting.get(needId);
    if (waiter) waiter({ allow, note });
    else if (need.agentId) await this.pressKeys(need.agentId, allow, need.kind);
    if (need.agentId) this.store.activity(need.projectId, need.agentId, `You ${allow ? "allowed" : "denied"}: ${need.title}`);
    return this.db.need(needId)!;
  }

  /** Prompts found on screen (not waiting on a hook) are over once the agent moves on. */
  private closeScreenPrompts(agent: Agent) {
    for (const n of this.db.openNeeds(agent.projectId))
      if (n.agentId === agent.id && (n.kind === "permission" || n.kind === "trust") && !this.waiting.has(n.id)) this.store.closeNeed(n.id, "Answered in the terminal");
  }

  /** The screen check found a prompt the hooks didn't report. Adds it once. */
  screenPrompt(agent: Agent, kind: "permission" | "trust", title: string, details: string) {
    const open = this.db.openNeeds(agent.projectId).some((n) => n.agentId === agent.id && n.kind === kind);
    if (open) return;
    this.store.addNeed(agent.projectId, agent.id, kind, title, details);
    this.store.updateAgent(agent.id, { state: "needs-you", note: title });
    this.store.activity(agent.projectId, agent.id, `${agent.name} needs you: ${title}`);
  }

  hasWaiting(agentId: string) {
    for (const id of this.waiting.keys()) if (this.db.need(id)?.agentId === agentId) return true;
    return false;
  }

  forgetTurn(agentId: string) {
    this.inTurn.delete(agentId);
  }
}
