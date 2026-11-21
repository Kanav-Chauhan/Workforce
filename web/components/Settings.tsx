"use client";

// Team settings for a project: who is in it, add a worker by sign, start or stop everyone, usage limit.

import { useState } from "react";
import { SIGNS } from "../../shared/signs";
import type { Agent, Project, Usage } from "../../shared/types";
import { api } from "../lib/api";
import { store } from "../lib/live";
import { agentTitle, Avatar, StatePill } from "./ui";

export function Settings({ project, agents, usage, onClose }: { project: Project; agents: Agent[]; usage: Usage; onClose: () => void }) {
  const free = SIGNS.filter((s) => !agents.some((a) => a.sign === s.sign));
  const [sign, setSign] = useState("");
  const [limit, setLimit] = useState(String(usage.limit));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const id = encodeURIComponent(project.id);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[rgba(43,47,58,.25)] p-4" onClick={onClose}>
      <div role="dialog" aria-label="Team settings" className="card rise max-h-[90dvh] w-full max-w-[480px] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center">
          <h2 className="m-0 text-[17px] font-semibold">Team · {project.name}</h2>
          <button className="ml-auto text-xl leading-none text-muted hover:text-ink" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="mt-0 mb-4 text-[12.5px] text-muted">
          {project.repo} · permission style: {project.permissionStyle === "careful" ? "Careful (shell commands ask you)" : "Trusted (only risky commands ask)"}
        </p>
        <ul className="m-0 mb-4 list-none space-y-2 p-0">
          {agents.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
              <Avatar agent={a} size={30} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">
                  {agentTitle(a)} <span className="font-normal text-muted">· {a.isLead ? "Lead" : "Worker"}</span>
                </div>
                <div className="text-[12px]">
                  <StatePill state={a.state} />
                </div>
              </div>
              <button className="btn btn-sm" disabled={!!busy} onClick={() => run(a.id, () => api(`/api/agents/${encodeURIComponent(a.id)}/${a.state === "off" ? "start" : "stop"}`, {}))}>
                {a.state === "off" ? "Start" : "Stop"}
              </button>
            </li>
          ))}
        </ul>
        <div className="mb-5 flex gap-2">
          <button className="btn btn-primary" disabled={!!busy} onClick={() => run("start", () => api(`/api/projects/${id}/team/start`, {}))}>
            {busy === "start" ? "Starting…" : "Start team"}
          </button>
          <button className="btn" disabled={!!busy} onClick={() => run("stop", () => api(`/api/projects/${id}/team/stop`, {}))}>
            {busy === "stop" ? "Stopping…" : "Stop team"}
          </button>
        </div>
        <div className="lbl">Add a worker</div>
        <div className="mb-5 flex gap-2">
          <select className="field" value={sign} onChange={(e) => setSign(e.target.value)}>
            <option value="">Pick a sign…</option>
            {free.map((s) => (
              <option key={s.sign} value={s.sign}>
                {s.name} {s.symbol} · {s.personality.split(".")[0]}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!sign || !!busy} onClick={() => run("add", async () => (await api(`/api/projects/${id}/agents`, { sign }), setSign("")))}>
            Add
          </button>
        </div>
        <div className="lbl">Weekly usage limit</div>
        <div className="flex items-center gap-2">
          <input className="field w-24" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
          <span className="text-[13px] text-muted">% · the team pauses here</span>
          <button className="btn btn-sm ml-auto" disabled={!!busy} onClick={() => run("limit", async () => store.setUsage(await api<Usage>("/api/usage", { limit: Number(limit) })))}>
            Save
          </button>
        </div>
        {err && <p className="mt-3 mb-0 text-[12.5px] text-bad">{err}</p>}
      </div>
    </div>
  );
}
