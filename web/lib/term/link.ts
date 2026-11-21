// A connection to one live terminal: the agent's Claude Code screen or its shell.
// Real mode talks to /term/<kind>/<agent> over a WebSocket; demo mode plugs in a fake.

"use client";

export type TermKind = "agent" | "shell" | "fix";

export type ServerFrame = { output: Uint8Array | string } | { notice: { kind: "ready" | "ended" | "error"; text: string } } | null;

/** Binary frames are terminal output; text frames are small JSON notices. */
export function readServerFrame(data: ArrayBuffer | string): ServerFrame {
  if (typeof data !== "string") return { output: new Uint8Array(data) };
  try {
    const m = JSON.parse(data) as { kind?: string; text?: string };
    if (m.kind === "ready" || m.kind === "ended" || m.kind === "error") return { notice: { kind: m.kind, text: m.text ?? "" } };
  } catch {
    /* not ours */
  }
  return null;
}

export interface TermEvents {
  output(data: Uint8Array | string): void;
  notice(kind: "ready" | "ended" | "error" | "closed", text: string): void;
}

export interface TermLink {
  keys(data: string): void;
  size(cols: number, rows: number): void;
  /** Shell only: end it and start a fresh one. */
  renew(): void;
  close(): void;
}

type Opener = (kind: TermKind, agentId: string, ev: TermEvents) => TermLink;
let demoOpener: Opener | null = null;

export function setDemoTerminals(o: Opener | null) {
  demoOpener = o;
}

export const isDemoTerminals = () => !!demoOpener;

export function openTerm(kind: TermKind, agentId: string, ev: TermEvents, size: { cols: number; rows: number }): TermLink {
  if (demoOpener) return demoOpener(kind, agentId, ev);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/term/${kind}/${encodeURIComponent(agentId)}?cols=${size.cols}&rows=${size.rows}`);
  ws.binaryType = "arraybuffer";
  let closedByUs = false;
  ws.onmessage = (e) => {
    const f = readServerFrame(e.data as ArrayBuffer | string);
    if (!f) return;
    if ("output" in f) ev.output(f.output);
    else ev.notice(f.notice.kind, f.notice.text);
  };
  ws.onclose = (e) => {
    if (!closedByUs) ev.notice("closed", e.reason || "Disconnected");
  };
  const send = (m: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  return {
    keys: (data) => send({ op: "keys", data }),
    size: (cols, rows) => send({ op: "size", cols, rows }),
    renew: () => send({ op: "renew" }),
    close: () => {
      closedByUs = true;
      ws.close();
    },
  };
}

/** Whether the server can run live terminals (node-pty loaded). */
export async function terminalSupport(): Promise<{ available: boolean; reason: string }> {
  if (demoOpener) return { available: true, reason: "" };
  try {
    const r = await fetch("/api/terminals");
    if (!r.ok) return { available: false, reason: `server said ${r.status}` };
    return (await r.json()) as { available: boolean; reason: string };
  } catch {
    return { available: false, reason: "server unreachable" };
  }
}
