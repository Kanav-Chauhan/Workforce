// Usage guard: reads the weekly Claude usage that Claude Code's status line saves on this machine,
// and pauses the team (no new messages delivered) at the owner's limit. Default limit: 90%.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Usage } from "../shared/types.ts";
import type { Db } from "./db.ts";

export type { Usage };

const FILE = () => process.env.WORKFORCE_USAGE_FILE || join(homedir(), ".claude", "state", "statusline-last.json");

export function readUsage(db: Db): Usage {
  const limit = Number(db.setting("usage_limit") ?? 90);
  const pausedByOwner = db.setting("paused") === "1";
  let percent: number | null = null;
  let resetsAt: string | null = null;
  try {
    const d = JSON.parse(readFileSync(FILE(), "utf8")) as { rate_limits?: { seven_day?: { used_percentage?: number; resets_at?: number } } };
    const w = d.rate_limits?.seven_day;
    if (typeof w?.used_percentage === "number") percent = Math.round(w.used_percentage);
    if (typeof w?.resets_at === "number") resetsAt = new Date(w.resets_at * 1000).toISOString();
  } catch {
    /* no data: unknown */
  }
  return { percent, resetsAt, limit, pausedByOwner, paused: pausedByOwner || (percent !== null && percent >= limit) };
}
