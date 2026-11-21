// Live terminals in the browser. Two kinds per agent:
//   "agent": a pty running `tmux attach` to the agent's own session, so you see and drive Claude Code;
//   "shell": a plain `bash -l` started in the agent's folder (never anywhere else).
// One pty per (kind, agent) is shared by every browser watching it, and closed a little while
// after the last one leaves. Output goes out as binary WebSocket frames; the browser sends small
// JSON frames for keystrokes and size changes.

import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { App } from "./app.ts";
import { sameOrigin } from "./live.ts";
import { fixCommand, setupFix } from "../shared/setup.ts";
import { agentFolder, home } from "./paths.ts";
import { sessionName } from "./runner.ts";
import { cleanEnv, run, SOCKET, tmux } from "./tmux.ts";

// ------------------------------------------------------------------ pure parts (tested)

export type TermKind = "agent" | "shell" | "fix";

/** One room per running terminal; this is its name. */
export const roomName = (kind: TermKind, agentId: string) => `${kind}:${agentId}`;

export type ViewerFrame = { op: "keys"; data: string } | { op: "size"; cols: number; rows: number } | { op: "renew" };

const MAX_KEYS = 64 * 1024;

/** Reads one frame from the browser; anything malformed or out of range is ignored (null). */
export function readViewerFrame(raw: string): ViewerFrame | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  if (f.op === "keys" && typeof f.data === "string" && f.data.length <= MAX_KEYS) return { op: "keys", data: f.data };
  if (f.op === "size") {
    const cols = Number(f.cols), rows = Number(f.rows);
    if (Number.isInteger(cols) && Number.isInteger(rows) && cols >= 10 && cols <= 500 && rows >= 4 && rows <= 200) return { op: "size", cols, rows };
    return null;
  }
  if (f.op === "renew") return { op: "renew" };
  return null;
}

/** Keeps only the newest `limit` characters of output, so a late viewer can catch up. */
export class Backlog {
  private parts: string[] = [];
  private size = 0;
  constructor(private limit = 200_000) {}
  add(s: string) {
    this.parts.push(s);
    this.size += s.length;
    while (this.size > this.limit) {
      const extra = this.size - this.limit, first = this.parts[0]!;
      if (first.length <= extra) {
        this.parts.shift();
        this.size -= first.length;
      } else {
        this.parts[0] = first.slice(extra);
        this.size = this.limit;
      }
    }
  }
  text() {
    return this.parts.join("");
  }
  clear() {
    this.parts = [];
    this.size = 0;
  }
}

// ------------------------------------------------------------------ ptys

/** The bits of node-pty we use, so tests can pass a fake. */
export interface Pty {
  onData(fn: (s: string) => void): unknown;
  onExit(fn: (e: { exitCode: number }) => void): unknown;
  write(s: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  readonly ptsName?: string;
  readonly pid?: number;
}
export type SpawnPty = (file: string, args: string[], opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv }) => Pty;

/** Loads node-pty if it can; the dashboard falls back to the snapshot view when it can't. */
export async function loadNodePty(): Promise<{ spawn: SpawnPty | null; reason: string }> {
  try {
    const mod = (await import("node-pty")) as unknown as { spawn: (f: string, a: string[], o: Record<string, unknown>) => Pty; default?: { spawn: SpawnPty } };
    const spawn = mod.spawn ?? mod.default?.spawn;
    if (!spawn) return { spawn: null, reason: "node-pty has no spawn()" };
    return { spawn: (file, args, o) => spawn(file, args, { name: "xterm-256color", ...o }), reason: "" };
  } catch (err) {
    return { spawn: null, reason: err instanceof Error ? err.message.split("\n")[0]! : String(err) };
  }
}

// ------------------------------------------------------------------ rooms

/** What a room needs to know about its program. */
export interface Program {
  file: string;
  args: string[];
  cwd: string;
  /** Called after the pty starts (tmux tweaks). */
  started?: (pty: Pty) => void | Promise<void>;
  /** A new viewer joined a running room: catch them up. Default: replay the backlog. */
  catchUp?: (pty: Pty, viewer: Viewer) => void | Promise<void>;
  /** The pty is closing (nobody watches): tidy up. */
  closing?: () => void | Promise<void>;
}

export interface Viewer {
  output(s: string): void;
  notice(msg: { kind: "ended" | "error"; text: string }): void;
}

interface Room {
  pty: Pty;
  viewers: Set<Viewer>;
  backlog: Backlog;
  idleTimer?: ReturnType<typeof setTimeout>;
  program: Program;
  ended: boolean;
  size: { cols: number; rows: number };
}

export class TermRooms {
  private rooms = new Map<string, Room>();

  constructor(private spawn: SpawnPty, private graceMs = 8000) {}

  has(name: string) {
    return this.rooms.has(name);
  }

  private open(name: string, program: Program, size: { cols: number; rows: number }, viewers = new Set<Viewer>()): Room {
    const pty = this.spawn(program.file, program.args, { cwd: program.cwd, cols: size.cols, rows: size.rows, env: { ...cleanEnv(), TERM: "xterm-256color", COLORTERM: "truecolor" } });
    const room: Room = { pty, viewers, backlog: new Backlog(), program, ended: false, size: { ...size } };
    this.rooms.set(name, room);
    pty.onData((s) => {
      room.backlog.add(s);
      for (const v of room.viewers) v.output(s);
    });
    pty.onExit(({ exitCode }) => {
      room.ended = true;
      for (const v of room.viewers) v.notice({ kind: "ended", text: exitCode ? `Ended (exit code ${exitCode})` : "Ended" });
    });
    return room;
  }

  /** Puts a viewer in the room, starting the program first if the room is empty. */
  async join(name: string, viewer: Viewer, make: () => Program, size = { cols: 120, rows: 32 }) {
    const existing = this.rooms.get(name);
    if (existing && !existing.ended) {
      clearTimeout(existing.idleTimer);
      existing.viewers.add(viewer);
      if (existing.program.catchUp) await existing.program.catchUp(existing.pty, viewer);
      else viewer.output(existing.backlog.text());
      return;
    }
    // A program that ended keeps its viewers: they all move to the new one.
    const viewers = existing ? this.detach(name) : new Set<Viewer>();
    viewers.add(viewer);
    const room = this.open(name, make(), size, viewers);
    await room.program.started?.(room.pty);
  }

  /** Ends the program and starts a fresh one for the same viewers ("New shell"). */
  async renew(name: string, make: () => Program, size = { cols: 120, rows: 32 }) {
    const viewers = this.detach(name);
    for (const v of viewers) v.output("\x1b[H\x1b[2J\x1b[3J");
    const room = this.open(name, make(), size, viewers);
    await room.program.started?.(room.pty);
  }

  leave(name: string, viewer: Viewer) {
    const room = this.rooms.get(name);
    if (!room) return;
    room.viewers.delete(viewer);
    if (!room.viewers.size) room.idleTimer = setTimeout(() => this.dispose(name), room.ended ? 0 : this.graceMs);
  }

  keys(name: string, data: string) {
    const room = this.rooms.get(name);
    if (room && !room.ended) room.pty.write(data);
  }

  /** The newest size wins: whoever resized last sees the terminal fitted to their screen. */
  resize(name: string, cols: number, rows: number) {
    const room = this.rooms.get(name);
    if (!room || room.ended) return;
    room.size = { cols, rows };
    room.pty.resize(cols, rows);
  }

  /** Kills the program and forgets the room; returns who was watching. */
  private detach(name: string): Set<Viewer> {
    const room = this.rooms.get(name);
    if (!room) return new Set();
    clearTimeout(room.idleTimer);
    this.rooms.delete(name);
    const viewers = room.viewers;
    room.viewers = new Set(); // late output or exit notices from the old pty reach nobody
    void room.program.closing?.();
    if (!room.ended)
      try {
        room.pty.kill();
      } catch {
        /* already gone */
      }
    return viewers;
  }

  dispose(name: string) {
    this.detach(name);
  }

  /** The size the room's pty was last given. */
  sizeOf(name: string) {
    return this.rooms.get(name)?.size;
  }

  disposeAll() {
    for (const name of [...this.rooms.keys()]) this.dispose(name);
  }

  /** The program's pid, while it runs. */
  pidOf(name: string): number {
    const room = this.rooms.get(name);
    return room && !room.ended ? room.pty.pid ?? 0 : 0;
  }

  viewerCount(name: string) {
    return this.rooms.get(name)?.viewers.size ?? 0;
  }
}

// ------------------------------------------------------------------ programs

const tm = (args: string[]) => run("tmux", ["-L", SOCKET, ...args], { env: cleanEnv() });

/** Attach to the agent's tmux session. The window follows the newest client's size while watched. */
export function agentProgram(session: string, cwd: string): Program {
  return {
    file: "tmux",
    args: ["-L", SOCKET, "attach-session", "-t", `=${session}`],
    cwd,
    started: async () => {
      await tmux.tune(session); // sessions started by older versions get the same settings
      await tm(["set-option", "-t", `=${session}:`, "status", "off"]);
      await tm(["set-option", "-w", "-t", `=${session}:`, "window-size", "latest"]);
    },
    // tmux paints the whole screen on request; a replay of old output would only flicker.
    catchUp: async (pty, viewer) => {
      viewer.output("\x1b[H\x1b[2J");
      if (pty.ptsName) await tm(["refresh-client", "-t", pty.ptsName]);
    },
    // Back to the size the screen checks expect when nobody is looking.
    closing: async () => {
      await tm(["resize-window", "-t", `=${session}:`, "-x", "200", "-y", "50"]);
    },
  };
}

export function shellProgram(cwd: string): Program {
  return { file: "bash", args: ["-l"], cwd };
}

/** One fix from the setup checklist's fixed list, run once in a login shell. */
export function fixProgram(command: string): Program {
  const line = `echo "\$ ${command.replace(/["\\$`]/g, "\\$&")}"; ${command}; code=$?; echo; if [ $code -eq 0 ]; then echo "Done. Press Check again in Workforce."; else echo "That didn't work (exit code $code)."; fi`;
  return { file: "bash", args: ["-lc", line], cwd: home() };
}

// ------------------------------------------------------------------ WebSocket routes

export interface TermSupport {
  available: boolean;
  reason: string;
}

export function registerTerminals(f: FastifyInstance, app: App, rooms: TermRooms | null, reason: string) {
  f.addHook("onClose", async () => rooms?.disposeAll());

  f.get("/api/terminals", async (): Promise<TermSupport> => ({ available: !!rooms, reason: rooms ? "" : reason || "node-pty is not available" }));

  f.get<{ Params: { kind: string; id: string } }>("/term/:kind/:id", { websocket: true }, async (socket, req) => {
    const say = (msg: Record<string, unknown>) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(msg));
    const refuse = (text: string) => {
      say({ kind: "error", text });
      socket.close(1008, text.slice(0, 100));
    };
    if (!sameOrigin(req)) return refuse("Wrong origin");
    if (!rooms) return refuse("Live terminals are off on this server");
    const { kind, id } = req.params;
    if (kind !== "agent" && kind !== "shell" && kind !== "fix") return refuse("Unknown terminal");
    let program: () => Program;
    if (kind === "fix") {
      // Only a fix from the fixed list, chosen by id.
      const fix = setupFix(id);
      if (!fix) return refuse("Unknown fix");
      program = () => fixProgram(fixCommand(fix, process.platform));
    } else {
      const agent = app.store.db.agent(id);
      if (!agent) return refuse("No such agent");
      const dir = agentFolder(agent);
      if (!existsSync(dir)) return refuse(`${agent.name}'s folder isn't there yet. Start ${agent.name} once first.`);
      const session = sessionName(agent);
      if (kind === "agent" && !(await tmux.exists(session))) return refuse(`${agent.name} is not running. Press Start.`);
      program = () => (kind === "agent" ? agentProgram(session, dir) : shellProgram(dir));
    }

    const name = roomName(kind, id);
    const viewer: Viewer = {
      output: (s) => socket.readyState === socket.OPEN && s && socket.send(Buffer.from(s, "utf8")),
      notice: (m) => say(m),
    };
    const q = req.query as { cols?: string; rows?: string };
    const first = readViewerFrame(JSON.stringify({ op: "size", cols: Number(q.cols), rows: Number(q.rows) }));
    const size = first?.op === "size" ? first : undefined;
    try {
      await rooms.join(name, viewer, program, size);
    } catch (err) {
      return refuse(`Couldn't open the terminal: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (size) rooms.resize(name, size.cols, size.rows);
    say({ kind: "ready" });

    socket.on("message", (data: Buffer, isBinary: boolean) => {
      const frame = isBinary ? null : readViewerFrame(String(data));
      if (!frame) return;
      if (frame.op === "keys") rooms.keys(name, frame.data);
      else if (frame.op === "size") rooms.resize(name, frame.cols, frame.rows);
      // "New shell": end this one; everyone watching moves to a fresh one.
      else if (frame.op === "renew" && kind !== "agent") void rooms.renew(name, program, rooms.sizeOf(name));
    });
    const ping = setInterval(() => socket.ping(), 25_000);
    socket.on("close", () => {
      clearInterval(ping);
      rooms.leave(name, viewer);
    });
    socket.on("error", () => socket.terminate());
  });
}
