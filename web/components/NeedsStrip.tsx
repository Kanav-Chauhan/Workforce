"use client";

// "Needs you": the first open item for this project, with its buttons. Several items page through.

import { useEffect, useState } from "react";
import type { Agent, Need, PullRequest } from "../../shared/types";
import { CHECKS, MergeButton, REVIEW } from "./Prs";
import { api } from "../lib/api";

function Title({ need, agents }: { need: Need; agents: Agent[] }) {
  const a = agents.find((x) => x.id === need.agentId);
  const rest = need.title.replace(/^[A-Z][a-z]+:\s*/, "");
  if (need.kind === "permission" && a) {
    const m = /^Running\s+(.*)$/.exec(rest);
    return (
      <>
        <b>{a.name}</b> wants to {m ? <>run <code className="rounded-[5px] bg-[#f4f1ec] px-1.5 py-px text-[12.5px]">{m[1]}</code></> : rest.charAt(0).toLowerCase() + rest.slice(1)}
      </>
    );
  }
  if (need.kind === "question" && a)
    return (
      <>
        <b>{a.name}</b> asks: {need.title}
      </>
    );
  return <>{need.title}</>;
}

const SUB: Record<Need["kind"], string> = {
  permission: "Permission prompt · the agent waits for you",
  trust: "First start in this folder · allow to trust it",
  question: "Question · your answer goes straight to the agent",
  blocked: "Blocked · reply to unblock",
  merge: "Ready to merge · you merge, agents never do",
};

export function NeedsStrip({ needs, agents, prs = [] }: { needs: Need[]; agents: Agent[]; prs?: PullRequest[] }) {
  const [i, setI] = useState(0);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const need = needs[Math.min(i, needs.length - 1)];

  useEffect(() => {
    setNote("");
    setNoteOpen(false);
    setErr("");
  }, [need?.id]);

  if (!need) return null;
  const decide = need.kind === "permission" || need.kind === "trust";
  const go = async (path: string, body: unknown) => {
    setBusy(true);
    setErr("");
    try {
      await api(path, body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-hud role="alert" className="rise absolute top-2 right-2 left-2 z-10 mx-auto max-w-[680px] md:right-[250px] rounded-[14px] border border-[#f2dfbf] bg-white px-3.5 py-2.5 shadow-pop md:top-3">
      <div className="flex items-start gap-3">
        <span className="pulse-dot mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-warn shadow-[0_0_0_4px_#fff1d9]" />
        <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
          <div className="break-words">
            <Title need={need} agents={agents} />
          </div>
          <small className="block text-[11.5px] text-muted">
            {SUB[need.kind]}
            {needs.length > 1 && ` · ${Math.min(i, needs.length - 1) + 1} of ${needs.length}`}
          </small>
          {need.details && need.kind !== "permission" && need.kind !== "merge" && <p className="mt-1 line-clamp-3 text-[12.5px] text-[#4a4f5c]">{need.details}</p>}
        </div>
        {needs.length > 1 && (
          <button className="btn btn-sm shrink-0" aria-label="Next item" onClick={() => setI((i + 1) % needs.length)}>
            Next ›
          </button>
        )}
      </div>
      {need.kind === "merge" ? (
        <MergeRow need={need} pr={prOf(need, prs)} busy={busy} onLater={() => go(`/api/needs/${need.id}/answer`, { answer: "Later" })} onError={setErr} />
      ) : decide ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[22px]">
          {noteOpen ? (
            <input className="field min-w-[160px] flex-1 py-1.5" placeholder="Note for the agent (optional)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          ) : (
            <button className="mr-auto text-[12.5px] text-muted underline-offset-2 hover:underline" onClick={() => setNoteOpen(true)}>
              + add a note
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => go(`/api/needs/${need.id}/decide`, { allow: false, note })}>
            Deny
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => go(`/api/needs/${need.id}/decide`, { allow: true, note })}>
            Allow
          </button>
        </div>
      ) : (
        <form
          className="mt-2 flex gap-1.5 pl-[22px]"
          onSubmit={(e) => {
            e.preventDefault();
            void go(`/api/needs/${need.id}/answer`, { answer: note });
          }}
        >
          <input className="field min-w-0 flex-1 py-1.5" placeholder="Your answer…" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || (need.kind === "question" && !note.trim())}>
            Send
          </button>
        </form>
      )}
      {err && <p className="mt-1 pl-[22px] text-[12px] text-bad">{err}</p>}
    </div>
  );
}

/** The PR a "ready to merge" item is about (its title says "PR #n …"). */
const prOf = (need: Need, prs: PullRequest[]) => {
  const n = Number(/PR #(\d+)/.exec(need.title)?.[1] ?? 0);
  return prs.find((p) => p.number === n);
};

function MergeRow({ need, pr, busy, onLater, onError }: { need: Need; pr?: PullRequest; busy: boolean; onLater: () => void; onError: (m: string) => void }) {
  const url = pr?.url ?? (need.details.startsWith("https://") ? need.details : "");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[22px]">
      {pr && (
        <span className="basis-full text-[12px] text-muted sm:mr-auto sm:basis-auto">
          {CHECKS[pr.checks].label} · {REVIEW[pr.review].label}
        </span>
      )}
      <button className="btn max-sm:ml-auto" disabled={busy} onClick={onLater} title="Hide this; merge later from the PR list">
        Later
      </button>
      {url && (
        <a className="btn" href={url} target="_blank" rel="noreferrer">
          Open on GitHub ↗
        </a>
      )}
      {pr && <MergeButton projectId={need.projectId} pr={pr} onError={onError} />}
    </div>
  );
}
