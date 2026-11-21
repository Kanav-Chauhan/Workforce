"use client";

import { useState } from "react";
import type { Project, Usage } from "../../shared/types";
import { api } from "../lib/api";
import { store } from "../lib/live";
import { Brand, Dot } from "./ui";

export interface Chip {
  label: string;
  color: string;
  on?: boolean;
}

export function TopBar({ project, demo, connected, usage, chips = [], onSettings }: { project?: Project; demo: boolean; connected: boolean; usage: Usage; chips?: Chip[]; onSettings?: () => void }) {
  const [busy, setBusy] = useState(false);
  const pause = async () => {
    setBusy(true);
    try {
      store.setUsage(await api<Usage>("/api/usage", { paused: !usage.pausedByOwner }));
    } finally {
      setBusy(false);
    }
  };
  const pct = usage.percent;
  const usageColor = usage.paused ? "#e5534b" : pct !== null && pct >= usage.limit - 10 ? "#e8a23a" : "#2fae7a";
  return (
    <header className="z-20 flex min-w-0 items-center gap-2 border-b border-line bg-white/85 px-3 py-2 backdrop-blur md:gap-3 md:px-4 md:py-2.5">
      <Brand />
      {project && (
        <a href={demo ? "./?demo=1&list=1" : "./"} className="hidden min-w-0 truncate text-[14px] text-muted no-underline hover:text-ink sm:block" title="All projects">
          · {project.name}
        </a>
      )}
      {demo && <span className="chip !bg-accent-soft !text-accent">Demo</span>}
      <div className="flex min-w-0 gap-1.5 overflow-hidden">
        {chips.map((c) => (
          <span key={c.label} className={`chip max-sm:!px-2 max-sm:!text-[11.5px] ${c.on ? "!bg-[#fff3df] !text-[#8a5a10]" : ""}`}>
            <Dot color={c.color} />
            {c.label}
          </span>
        ))}
      </div>
      <div className="flex-1" />
      {!connected && !demo && <span className="chip !bg-[#fdecea] !text-[#a2352e]">Reconnecting…</span>}
      <span className="chip hidden md:inline-flex" title={usage.resetsAt ? `Weekly Claude usage. Resets ${new Date(usage.resetsAt).toLocaleString()}` : "Weekly Claude usage"}>
        <Dot color={usageColor} />
        {pct === null ? "Usage —" : `Usage ${pct}%`}
        {usage.paused && " · paused"}
      </span>
      <button className="btn btn-sm hidden md:inline-flex" disabled={busy} onClick={pause} title="Paused: no new messages or tasks reach the agents">
        {usage.pausedByOwner ? "Resume team" : "Pause team"}
      </button>
      {onSettings && (
        <button className="btn btn-sm" onClick={onSettings} aria-label="Settings">
          <span aria-hidden>⚙</span>
          <span className="hidden md:inline">Team</span>
        </button>
      )}
    </header>
  );
}
