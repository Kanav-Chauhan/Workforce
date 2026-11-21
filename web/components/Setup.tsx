"use client";

// The setup checklist: OK, or the fix. Run opens that one fix (from the fixed list) in a terminal.

import { useEffect, useState } from "react";
import type { SetupCheck } from "../../shared/types";
import { api } from "../lib/api";
import { FixTerminal } from "./Terminal";

export function SetupChecklist({ onAllOk }: { onAllOk?: (ok: boolean) => void }) {
  const [checks, setChecks] = useState<SetupCheck[] | null>(null);
  const [terminals, setTerminals] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ checks: SetupCheck[]; terminals: boolean }>("/api/setup");
      setChecks(r.checks);
      setTerminals(r.terminals);
      onAllOk?.(r.checks.every((c) => c.ok));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bad = checks?.filter((c) => !c.ok).length ?? 0;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="m-0 text-[13px] text-muted">{!checks ? "Checking this machine…" : bad ? `${bad} thing${bad > 1 ? "s" : ""} to fix.` : "Everything Workforce needs is here."}</p>
        <button className="btn btn-sm ml-auto" disabled={busy} onClick={() => void load()}>
          {busy ? "Checking…" : "Check again"}
        </button>
      </div>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {checks?.map((c) => (
          <li key={c.id} className="rounded-xl border border-line px-3 py-2">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${c.ok ? "bg-[#2fae7a]" : "bg-[#e8a23a]"}`}>
                {c.ok ? "✓" : "!"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{c.label}</div>
                <div className="text-[12px] text-muted">{c.detail}</div>
              </div>
              {!c.ok && c.fix && terminals && (
                <button className="btn btn-sm btn-primary" onClick={() => setRunning(running === c.fix!.id ? null : c.fix!.id)}>
                  {running === c.fix.id ? "Hide" : "Run"}
                </button>
              )}
            </div>
            {!c.ok && c.fix && <code className="mt-1.5 block rounded-md bg-soft px-2 py-1 font-mono text-[11.5px] break-all text-[#4a4f5c]">{c.fix.command}</code>}
            {!c.ok && c.hint && <p className="mt-1.5 mb-0 text-[12px] text-[#4a4f5c]">{c.hint}</p>}
          </li>
        ))}
      </ul>
      {running && (
        <div className="mt-3">
          <div className="mb-1 flex items-center text-[12px] text-muted">
            Running the fix for {checks?.find((c) => c.id === running)?.label ?? running}
            <button className="ml-auto text-accent" onClick={() => setRunning(null)}>
              Close
            </button>
          </div>
          <FixTerminal fixId={running} onDone={() => void load()} />
        </div>
      )}
      {!terminals && <p className="mt-2 text-[12px] text-muted">Live terminals are off on this server: run the commands above in your own terminal.</p>}
      {err && <p className="mt-2 text-[12.5px] text-bad">{err}</p>}
    </div>
  );
}
