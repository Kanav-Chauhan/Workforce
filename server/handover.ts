// What an agent actually reads when its queued messages reach it. Pure text work, no I/O.

import type { Message } from "../shared/types.ts";

/**
 * Folds a batch of queued messages into a single line. Claude Code submits its prompt on a newline,
 * so any line breaks inside a message are flattened to spaces.
 */
export function composeHandover(batch: Message[], whoIs: (id: string) => string): string {
  const lines: string[] = [];
  let teammateSpoke = false;
  for (const m of batch) {
    if (m.fromId === "workforce") {
      lines.push(`[Workforce] ${m.text}`);
      continue;
    }
    if (m.fromId !== "owner") teammateSpoke = true;
    lines.push(`[Workforce] Message from ${whoIs(m.fromId)}: ${m.text}`);
  }
  const hint = teammateSpoke ? "  (Reply with the message tool only if a reply is needed.)" : "";
  return `${lines.join("  |  ")}${hint}`.replace(/\s*\n\s*/g, " ");
}
