"use client";

// First run: name the office, add the first project, pick the team, then check the machine.

import { useState } from "react";
import { DEFAULT_WORKERS, SIGNS } from "../../shared/signs";
import type { PermissionStyle, Project } from "../../shared/types";
import { api } from "../lib/api";
import { SetupChecklist } from "./Setup";
import { Avatar, Brand } from "./ui";

const workerSigns = [...DEFAULT_WORKERS, ...SIGNS.map((s) => s.sign).filter((s) => s !== "leo" && !DEFAULT_WORKERS.includes(s))];

export function Welcome({ open, onSkip }: { open: (id: string) => void; onSkip: () => void }) {
  const [step, setStep] = useState(0);
  const [office, setOffice] = useState("");
  const [repo, setRepo] = useState("");
  const [workers, setWorkers] = useState(2);
  const [style, setStyle] = useState<PermissionStyle>("careful");
  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const team = ["leo", ...workerSigns.slice(0, workers)].map((sign) => SIGNS.find((s) => s.sign === sign)!);

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      if (office.trim()) await api("/api/office", { name: office });
      setProject(await api<Project>("/api/projects", { repo, workers, permissionStyle: style }));
      setStep(2);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = ["Your office", "First project", "Check the machine"];
  return (
    <div className="stage flex min-h-dvh items-start justify-center overflow-auto px-4 py-8 sm:items-center">
      <div className="card rise w-full max-w-[560px] p-6 sm:p-8">
        <div className="mb-5 flex items-center">
          <Brand />
          <ol className="m-0 ml-auto flex list-none gap-1.5 p-0" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s} title={s} className={`h-1.5 w-8 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
            ))}
          </ol>
        </div>

        {step === 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStep(1);
            }}
          >
            <h1 className="mt-0 mb-1 text-[22px] font-semibold tracking-[-0.01em]">Welcome to your office</h1>
            <p className="mt-0 mb-5 text-[13.5px] text-muted">A small team of Claude Code agents works here on your GitHub projects. You answer their questions and merge their work.</p>
            <label className="lbl block" htmlFor="office">
              Name the office
            </label>
            <input id="office" autoFocus className="field" placeholder="e.g. Kanav's studio" maxLength={40} value={office} onChange={(e) => setOffice(e.target.value)} />
            <p className="mt-1.5 mb-6 text-[12px] text-muted">It goes on a sign on the office wall. You can change it later.</p>
            <div className="flex items-center gap-2">
              <button className="btn btn-primary">Next</button>
              <button type="button" className="ml-auto text-[12.5px] text-muted hover:text-ink" onClick={onSkip}>
                Skip setup
              </button>
            </div>
          </form>
        )}

        {step === 1 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <h1 className="mt-0 mb-1 text-[22px] font-semibold tracking-[-0.01em]">Your first project</h1>
            <p className="mt-0 mb-4 text-[13.5px] text-muted">One GitHub repo. Workforce clones it for each agent, using this machine's GitHub login.</p>
            <label className="lbl block" htmlFor="repo">
              GitHub repo
            </label>
            <input id="repo" autoFocus className="field font-mono text-[13px]" placeholder="owner/name" value={repo} onChange={(e) => setRepo(e.target.value)} />

            <div className="lbl mt-5">Team</div>
            <div className="mb-2 flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <button type="button" key={n} className={`rounded-lg border px-3 py-1.5 text-[13px] ${workers === n ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line"}`} onClick={() => setWorkers(n)}>
                  Lead + {n} worker{n > 1 ? "s" : ""}
                </button>
              ))}
            </div>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {team.map((s, i) => (
                <span key={s.sign} className="flex items-center gap-1.5 text-[12.5px]">
                  <Avatar agent={{ sign: s.sign, name: s.name }} size={26} />
                  {s.name} <span className="text-muted">{i === 0 ? "lead" : "worker"}</span>
                </span>
              ))}
            </div>

            <div className="lbl">How much should agents ask you?</div>
            <div className="mb-5 grid gap-2 sm:grid-cols-2">
              {(["careful", "trusted"] as const).map((s) => (
                <label key={s} className={`cursor-pointer rounded-xl border px-3 py-2 text-[12.5px] ${style === s ? "border-accent bg-accent-soft" : "border-line"}`}>
                  <input type="radio" className="mr-1.5" checked={style === s} onChange={() => setStyle(s)} />
                  <b>{s === "careful" ? "Careful" : "Trusted"}</b>
                  <span className="block text-muted">{s === "careful" ? "Every shell command and web fetch asks you first. Best on a server." : "Most commands just run; risky ones ask. For a laptop or a test repo."}</span>
                </label>
              ))}
            </div>
            {err && <p className="mt-0 mb-3 text-[12.5px] text-bad">{err}</p>}
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" disabled={busy || !repo.trim()}>
                {busy ? "Looking it up…" : "Add project"}
              </button>
              <button type="button" className="btn" onClick={() => setStep(0)}>
                Back
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <>
            <h1 className="mt-0 mb-1 text-[22px] font-semibold tracking-[-0.01em]">Check the machine</h1>
            <p className="mt-0 mb-4 text-[13.5px] text-muted">The agents need these tools. Anything missing has a Run button for its fix.</p>
            <SetupChecklist />
            <div className="mt-5 flex items-center gap-2">
              <button className="btn btn-primary" onClick={() => project && open(project.id)}>
                Open the office
              </button>
              <span className="text-[12px] text-muted">You can see this list again in Settings → Setup.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
