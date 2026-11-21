"use client";

// Your projects, each with a one-line status, and Add project by owner/name.

import { useState } from "react";
import type { Project } from "../../shared/types";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import { lookFor } from "../lib/office/looks";
import { TopBar } from "./TopBar";

export function Projects({ demo, open }: { demo: boolean; open: (id: string) => void }) {
  const v = useLive();
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const status = (p: Project) => {
    const team = v.agents.filter((a) => a.projectId === p.id);
    const working = team.filter((a) => a.state === "working").length;
    const needs = v.needs.filter((n) => n.projectId === p.id).length;
    const off = team.every((a) => a.state === "off");
    const parts = [off ? "Team is off" : `${working} working`];
    if (needs) parts.push(`${needs} need${needs > 1 ? "" : "s"} you`);
    const open = v.tasks.filter((t) => t.projectId === p.id && t.status !== "done").length;
    parts.push(`${open} open task${open === 1 ? "" : "s"}`);
    return { text: parts.join(", "), needs, team };
  };
  return (
    <div className="flex h-dvh flex-col">
      <TopBar demo={demo} connected={v.connected} usage={v.usage} />
      <main className="mx-auto w-full max-w-[760px] flex-1 overflow-auto px-4 py-8">
        <h1 className="mt-0 mb-1 text-[22px] font-semibold tracking-[-0.01em]">Your projects</h1>
        <p className="mt-0 mb-6 text-[13.5px] text-muted">Each project is one GitHub repo with its own office and team.</p>
        <ul className="m-0 mb-8 list-none space-y-3 p-0">
          {v.projects.map((p) => {
            const s = status(p);
            return (
              <li key={p.id}>
                <button className="card flex w-full items-center gap-4 p-4 text-left transition-transform hover:-translate-y-px" onClick={() => open(p.id)}>
                  <div className="flex -space-x-2">
                    {s.team.slice(0, 4).map((a) => (
                      <span key={a.id} className="grid h-8 w-8 place-items-center rounded-full border-2 border-white text-[12px] font-bold text-white" style={{ background: lookFor(a).shirt, opacity: a.state === "off" ? 0.45 : 1 }}>
                        {a.name[0]}
                      </span>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">{p.name}</div>
                    <div className="truncate text-[12.5px] text-muted">
                      {p.repo} · {s.text}
                    </div>
                  </div>
                  {s.needs > 0 && <span className="chip !bg-[#fff3df] !text-[#8a5a10]">{s.needs} needs you</span>}
                  <span className="text-muted">›</span>
                </button>
              </li>
            );
          })}
          {!v.projects.length && <li className="card p-5 text-[13.5px] text-muted">{v.connected ? "No projects yet. Add one below." : "Connecting…"}</li>}
        </ul>
        <form
          className="card p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr("");
            try {
              const p = await api<Project>("/api/projects", { repo });
              setRepo("");
              open(p.id);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="lbl block" htmlFor="repo">
            Add project
          </label>
          <div className="flex gap-2">
            <input id="repo" className="field" placeholder="owner/name, e.g. Kanav-Chauhan/workforce-sandbox" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <button className="btn btn-primary shrink-0" disabled={busy || !repo.trim()}>
              {busy ? "Cloning…" : "Add"}
            </button>
          </div>
          <p className="mt-2 mb-0 text-[12px] text-muted">Workforce clones it once and sets up a lead and two workers.</p>
          {err && <p className="mt-2 mb-0 text-[12.5px] text-bad">{err}</p>}
        </form>
        {!demo && (
          <p className="mt-6 text-center text-[12.5px] text-muted">
            Want to see the office first? <a href="./?demo=1">Open the demo</a>
          </p>
        )}
      </main>
    </div>
  );
}
