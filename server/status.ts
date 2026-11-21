// Turns Claude Code hook events into an agent's status. Pure: no I/O, easy to test.

import type { AgentState } from "../shared/types.ts";

export interface HookBody {
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  message?: string;
  notification_type?: string;
}

export interface Status {
  state: AgentState;
  note: string;
}

const short = (text: string, max = 90) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};

/** "Editing page.tsx", "Running npm test", "Using Read". */
export function describeTool(tool?: string, input?: Record<string, unknown>): string {
  if (!tool) return "Working";
  const file = typeof input?.file_path === "string" ? input.file_path.split("/").pop() : null;
  if ((tool === "Edit" || tool === "Write" || tool === "MultiEdit") && file) return `Editing ${file}`;
  if (tool === "Read" && file) return `Reading ${file}`;
  if (tool === "Bash" && typeof input?.command === "string") return `Running ${short(input.command, 60)}`;
  if (tool.startsWith("mcp__workforce__")) return `Team: ${tool.slice("mcp__workforce__".length)}`;
  return `Using ${tool}`;
}

/**
 * The next status after a hook event, or null to leave it as it is.
 * `inTurn` says whether the agent is inside a turn (prompt sent, no Stop yet): a late tool event
 * that arrives after Stop must not flip a finished agent back to "working".
 */
export function nextStatus(current: Status, event: string, body: HookBody, inTurn: boolean | undefined): Status | null {
  switch (event) {
    case "SessionStart":
      return { state: "ready", note: "Ready" };
    case "UserPromptSubmit":
      return { state: "working", note: body.prompt ? short(body.prompt) : "Working" };
    case "PreToolUse":
      if (inTurn === false) return null;
      return { state: "working", note: describeTool(body.tool_name, body.tool_input) };
    case "PostToolUse":
      // A tool that was waiting on the owner finished: they answered.
      if (inTurn === false) return null;
      return current.state === "needs-you" ? { state: "working", note: "Continuing after your answer" } : null;
    case "Notification": {
      const msg = body.message ?? "";
      if (body.notification_type === "idle_prompt" || /waiting for your input/i.test(msg)) return { state: "ready", note: "Waiting for instructions" };
      if (body.notification_type === "permission_prompt" || /permission/i.test(msg)) return { state: "needs-you", note: short(msg || "Asking for permission") };
      return { state: "needs-you", note: short(msg || "Needs your attention") };
    }
    case "PermissionRequest":
      return { state: "needs-you", note: `Asking: ${describeTool(body.tool_name, body.tool_input)}` };
    case "Stop":
      return { state: current.state === "blocked" ? "blocked" : "ready", note: current.state === "blocked" ? current.note : "Finished, ready for more" };
    case "SessionEnd":
      return { state: "off", note: "Session ended" };
    default:
      return null;
  }
}

/** Whether the agent is inside a turn after this event (undefined = no change). */
export function turnAfter(event: string): boolean | undefined {
  if (event === "UserPromptSubmit") return true;
  if (event === "Stop" || event === "SessionStart" || event === "SessionEnd") return false;
  return undefined;
}
