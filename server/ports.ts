// Ports drawer: which TCP ports each agent's programs listen on. We take the agent's tmux pane and
// its Shell tab, walk their process trees, and match the pids against `ss -ltnp`.

import type { Agent, OpenPort } from "../shared/types.ts";
import { cleanEnv, run, SOCKET } from "./tmux.ts";

export interface Listener {
  address: string;
  port: number;
  pids: { pid: number; program: string }[];
}

/** Reads `ss -ltnpH` output: one listener per line, with the owning processes when visible. */
export function parseSs(text: string): Listener[] {
  const out: Listener[] = [];
  for (const line of text.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[0] !== "LISTEN") continue;
    const local = cols[3]!;
    const cut = local.lastIndexOf(":");
    const port = Number(local.slice(cut + 1));
    if (!Number.isInteger(port) || port <= 0) continue;
    const address = local.slice(0, cut).replace(/^\[|\]$/g, "").replace(/%.*$/, "");
    const pids = [...line.matchAll(/\("([^"]*)",pid=(\d+)/g)].map((m) => ({ program: m[1]!, pid: Number(m[2]) }));
    out.push({ address, port, pids });
  }
  return out;
}

/** Every pid under the given roots (roots included), from `ps -e -o pid=,ppid=` output. */
export function descendants(ps: string, roots: number[]): Set<number> {
  const kids = new Map<number, number[]>();
  for (const line of ps.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined || Number.isNaN(ppid)) continue;
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  }
  const seen = new Set<number>();
  const stack = roots.filter((r) => r > 0);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    stack.push(...(kids.get(p) ?? []));
  }
  return seen;
}

/** Matches listeners to agents. The same port on IPv4 and IPv6 shows once. */
export function portsOf(listeners: Listener[], trees: Map<string, Set<number>>): OpenPort[] {
  const out: OpenPort[] = [];
  for (const l of listeners)
    for (const [agentId, pids] of trees) {
      const hit = l.pids.find((p) => pids.has(p.pid));
      if (hit && !out.some((o) => o.agentId === agentId && o.port === l.port)) out.push({ agentId, port: l.port, address: l.address, program: hit.program, pid: hit.pid });
    }
  return out.sort((a, b) => a.port - b.port);
}

/** Looks up the ports for these agents. `extraRoots` are other pids per agent (its Shell tab). */
export async function openPorts(agents: Agent[], session: (a: Agent) => string, extraRoots: (agentId: string) => number[]): Promise<OpenPort[]> {
  const roots = new Map<string, number[]>();
  for (const a of agents) {
    const r = await run("tmux", ["-L", SOCKET, "display-message", "-p", "-t", `=${session(a)}:`, "#{pane_pid}"], { env: cleanEnv() });
    const pane = r.ok ? Number(r.stdout.trim()) : 0;
    const list = [...(pane ? [pane] : []), ...extraRoots(a.id)];
    if (list.length) roots.set(a.id, list);
  }
  if (!roots.size) return [];
  const [ss, ps] = await Promise.all([run("ss", ["-ltnpH"]), run("ps", ["-e", "-o", "pid=,ppid="])]);
  if (!ss.ok || !ps.ok) return [];
  const trees = new Map([...roots].map(([id, r]) => [id, descendants(ps.stdout, r)] as const));
  return portsOf(parseSs(ss.stdout), trees);
}
