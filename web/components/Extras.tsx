"use client";

// Small pieces around the office: the reconnect banner, the Ports drawer and the board switcher.

import { useEffect, useState } from "react";
import type { Agent, OpenPort } from "../../shared/types";
import { api } from "../lib/api";
import { reconnectNow, useLive } from "../lib/live";
import { agentTitle, Avatar } from "./ui";

/** Shown while /live is down. The page keeps the last state; a reconnect brings everything up to date. */
export function ConnectionBanner({ demo }: { demo: boolean }) {
  const v = useLive();
  const [now, setNow] = useState(() => Date.now());
  const [late, setLate] = useState(false);
  const down = !demo && !v.connected;
  useEffect(() => {
    if (!down) return setLate(false);
    // The very first connect gets a moment before we call it a problem.
    const t = setTimeout(() => setLate(true), v.everConnected ? 0 : 1500);
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => (clearTimeout(t), clearInterval(i));
  }, [down, v.everConnected]);
  if (!down || !late) return null;
  const secs = v.retryAt ? Math.max(0, Math.ceil((v.retryAt - now) / 1000)) : 0;
  return (
    <div role="status" className="fixed top-2 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[#f3c9c4] bg-[#fff6f5] px-4 py-2 text-[13px] text-[#8c2f28] shadow-pop">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#e5534b]" />
      <span>
        {v.everConnected ? "Lost the connection. Reconnecting…" : "Connecting to Workforce…"}
        {secs > 0 && <span className="text-[#b0645d]"> next try in {secs} s</span>}
      </span>
      <button className="btn btn-sm" onClick={reconnectNow}>
        Retry now
      </button>
    </div>
  );
}

/** Ports the agents' programs are listening on (dev servers and the like). */
export function PortsDrawer({ projectId, agents, onClose }: { projectId: string; agents: Agent[]; onClose: () => void }) {
  const [data, setData] = useState<{ ports: OpenPort[]; local: boolean } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await api<{ ports: OpenPort[]; local: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/ports`);
        if (live) (setData(r), setErr(""));
      } catch (e) {
        if (live) setErr((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [projectId]);
  return (
    <Drawer title="Ports" onClose={onClose}>
      <p className="mt-0 mb-3 text-[12.5px] text-muted">Programs the agents started that listen on a port, like a dev server. Updates every few seconds.</p>
      {data && !data.local && (
        <p className="mt-0 mb-3 rounded-lg bg-[#fff8e8] px-3 py-2 text-[12.5px] text-[#7a5410]">
          Workforce is running on a server, so these ports aren't reachable from your browser. Ask the agent to describe what it sees, or reach them through an SSH tunnel.
        </p>
      )}
      <ul className="m-0 list-none space-y-2 p-0">
        {data?.ports.map((p) => {
          const a = agents.find((x) => x.id === p.agentId);
          return (
            <li key={`${p.agentId}-${p.port}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
              {a && <Avatar agent={a} size={28} />}
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">
                  :{p.port} <span className="font-normal text-muted">· {p.program}</span>
                </div>
                <div className="text-[12px] text-muted">
                  {a ? agentTitle(a) : p.agentId} · {p.address === "0.0.0.0" || p.address === "::" || p.address === "*" ? "all addresses" : p.address}
                </div>
              </div>
              {data.local && (
                <a className="btn btn-sm" href={`http://localhost:${p.port}`} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {data && !data.ports.length && <p className="text-[13px] text-muted">Nothing is listening yet. When an agent starts a dev server it shows up here.</p>}
      {!data && !err && <p className="text-[13px] text-muted">Looking…</p>}
      {err && <p className="text-[12.5px] text-bad">{err}</p>}
    </Drawer>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-[rgba(43,47,58,.2)]" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={title}
        className="rise absolute top-0 right-0 flex h-full w-full max-w-[420px] flex-col bg-white p-5 shadow-[-8px_0_30px_rgba(40,35,25,.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center">
          <h2 className="m-0 text-[17px] font-semibold">{title}</h2>
          <button className="ml-auto text-xl leading-none text-muted hover:text-ink" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  );
}

/** Board chips with "+ New board": used on the office (over the plan wall) and in the Board tab. */
export function BoardSwitcher({ projectId, boards, board, counts, onPick, compact }: { projectId: string; boards: string[]; board: string; counts: Record<string, number>; onPick: (b: string) => void; compact?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const add = async () => {
    setErr("");
    try {
      const r = await api<{ name: string }>(`/api/projects/${encodeURIComponent(projectId)}/boards`, { name });
      onPick(r.name);
      setName("");
      setAdding(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className={compact ? "" : "mb-2"}>
      <div className="flex flex-wrap items-center gap-1">
        {boards.map((b) => (
          <button
            key={b}
            className={`rounded-lg px-2 py-0.5 text-[12px] ${b === board ? "bg-accent-soft font-semibold text-accent" : "text-[#4a4f5c] hover:bg-soft"}`}
            onClick={() => onPick(b)}
          >
            {b} <span className="text-muted">{counts[b] ?? 0}</span>
          </button>
        ))}
        {adding ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void add();
            }}
          >
            <input autoFocus className="field w-[110px] !py-0.5 text-[12px]" placeholder="Board name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
            <button className="btn btn-sm !py-0.5" disabled={!name.trim()}>
              Add
            </button>
          </form>
        ) : (
          <button className="rounded-lg px-2 py-0.5 text-[12px] text-accent hover:bg-soft" onClick={() => setAdding(true)}>
            + New board
          </button>
        )}
      </div>
      {err && <p className="mt-1 mb-0 text-[12px] text-bad">{err}</p>}
    </div>
  );
}
