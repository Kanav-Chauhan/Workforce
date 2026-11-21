// tmux keeps each agent alive when the server or browser closes.
// Every call goes through execFile (no shell), and targets use "=name" so tmux never guesses a prefix.

import { execFile } from "node:child_process";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function run(file: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd: opts.cwd, timeout: opts.timeoutMs ?? 15_000, env: opts.env ?? process.env, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) || (err ? err.message : "") }),
    );
  });
}

/** Quote one argument for the shell line tmux runs. */
export const shellQuote = (s: string) => (/^[A-Za-z0-9_\-.,:/=@%+]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

const target = (name: string) => `=${name}:`;

/** Workforce's own tmux server, separate from the user's tmux. Attach with: tmux -L workforce attach -t <name> */
export const SOCKET = "workforce";

/** The environment without this machine's Claude Code session variables, so agents start as fresh sessions. */
export function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE/.test(k)));
}

const tm = (args: string[], opts: { timeoutMs?: number } = {}) => run("tmux", ["-L", SOCKET, ...args], { ...opts, env: cleanEnv() });

export const tmux = {
  async exists(name: string) {
    return (await tm(["has-session", "-t", `=${name}`])).ok;
  },

  /** Starts `command` (a shell line) in a new detached session. The pane stays after exit so we can read why. */
  async start(name: string, cwd: string, command: string, env: Record<string, string> = {}) {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const r = await tm(["new-session", "-d", "-s", name, "-x", "200", "-y", "50", "-c", cwd, ...envArgs, command]);
    if (!r.ok) throw new Error(`tmux could not start ${name}: ${r.stderr.trim()}`);
    await tm(["set-option", "-t", `=${name}`, "remain-on-exit", "on"]);
    await tm(["set-option", "-t", `=${name}`, "history-limit", "20000"]);
  },

  async kill(name: string) {
    await tm(["kill-session", "-t", `=${name}`]);
  },

  /** Types text literally, without pressing Enter. */
  async type(name: string, text: string) {
    return (await tm(["send-keys", "-t", target(name), "-l", text])).ok;
  },

  async key(name: string, key: string) {
    return (await tm(["send-keys", "-t", target(name), key])).ok;
  },

  /** The last `lines` non-empty lines of the visible screen, as plain text. */
  async screen(name: string, lines = 15) {
    const r = await tm(["capture-pane", "-p", "-J", "-t", target(name)]);
    if (!r.ok) return "";
    return r.stdout.split("\n").filter((l) => l.trim()).slice(-lines).join("\n");
  },

  /** Whether the program in the session has exited (the pane is kept, see remain-on-exit). */
  async exited(name: string): Promise<{ dead: boolean; code: number | null }> {
    const r = await tm(["display-message", "-p", "-t", target(name), "#{pane_dead} #{pane_dead_status}"]);
    if (!r.ok) return { dead: false, code: null };
    const [dead, code] = r.stdout.trim().split(" ");
    return { dead: dead === "1", code: code ? Number(code) : null };
  },
};
