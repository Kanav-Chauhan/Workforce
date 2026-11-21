// The setup checklist: is everything Workforce needs on this machine? Each line says OK, or the
// fix to run (from the fixed list in shared/setup.ts) or what to do by hand.

import { statfsSync } from "node:fs";
import { fixCommand, setupFix } from "../shared/setup.ts";
import type { SetupCheck } from "../shared/types.ts";
import { ensureDir, home } from "./paths.ts";
import { cleanEnv, run } from "./tmux.ts";

const MIN_FREE_GB = 2;
const MIN_NODE = 24;

const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";

/** The version number in a tool's --version output ("git version 2.43.0" → "2.43.0"). */
export function versionIn(text: string): string {
  return text.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? "";
}

/** Free space as a friendly figure, and whether it is enough. */
export function diskLine(freeBytes: number): { ok: boolean; detail: string } {
  const gb = freeBytes / 1024 ** 3;
  return { ok: gb >= MIN_FREE_GB, detail: `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB free${gb < MIN_FREE_GB ? ` (needs ${MIN_FREE_GB} GB for clones)` : ""}` };
}

const fixFor = (id: string) => {
  const f = setupFix(id);
  return f ? { id: f.id, command: fixCommand(f, process.platform) } : undefined;
};

export async function runChecks(): Promise<SetupCheck[]> {
  const env = cleanEnv();
  const tool = async (id: string, label: string, file: string, args = ["--version"]): Promise<SetupCheck> => {
    const r = await run(file, args, { timeoutMs: 15_000, env });
    const v = versionIn(r.stdout + r.stderr);
    return r.ok ? { id, label, ok: true, detail: v ? `version ${v}` : firstLine(r.stdout) } : { id, label, ok: false, detail: "Not found", fix: fixFor(id) };
  };
  const [git, gh, tmux, claude] = await Promise.all([
    tool("git", "git", "git"),
    tool("gh", "GitHub CLI (gh)", "gh"),
    tool("tmux", "tmux", "tmux", ["-V"]),
    tool("claude", "Claude Code", "claude"),
  ]);
  let ghAuth: SetupCheck;
  if (!gh.ok) ghAuth = { id: "gh-auth", label: "GitHub login", ok: false, detail: "Install gh first" };
  else {
    const r = await run("gh", ["auth", "status"], { timeoutMs: 20_000, env });
    const who = (r.stdout + r.stderr).match(/account (\S+)/)?.[1] ?? (r.stdout + r.stderr).match(/as (\S+)/)?.[1];
    ghAuth = r.ok ? { id: "gh-auth", label: "GitHub login", ok: true, detail: who ? `logged in as ${who}` : "logged in" } : { id: "gh-auth", label: "GitHub login", ok: false, detail: "Not logged in", fix: fixFor("gh-auth") };
  }
  const major = Number(process.versions.node.split(".")[0]);
  const node: SetupCheck = {
    id: "node", label: "Node.js", ok: major >= MIN_NODE, detail: `version ${process.versions.node}`,
    ...(major >= MIN_NODE ? {} : { hint: `Workforce needs Node ${MIN_NODE} or newer. With nvm: nvm install ${MIN_NODE}` }),
  };
  let disk: SetupCheck;
  try {
    const s = statfsSync(ensureDir(home()));
    const d = diskLine(Number(s.bavail) * Number(s.bsize));
    disk = { id: "disk", label: "Disk space", ...d, ...(d.ok ? {} : { hint: "Free some space on this disk, then check again." }) };
  } catch (err) {
    disk = { id: "disk", label: "Disk space", ok: false, detail: (err as Error).message };
  }
  return [git, gh, ghAuth, tmux, claude, node, disk];
}
