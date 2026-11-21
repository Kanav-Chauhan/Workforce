"use client";

// Pull requests: the PR drawer (every PR Workforce sees for the project) and the owner's Merge button.

import { useEffect, useState } from "react";
import type { Agent, Project, PullRequest, SyncStatus, Task } from "../../shared/types";
import { api } from "../lib/api";
import { Drawer } from "./Extras";
import { ago, Avatar, Dot, TASK_STATUS } from "./ui";

const enc = encodeURIComponent;

export const CHECKS: Record<PullRequest["checks"], { label: string; color: string }> = {
  passing: { label: "Checks pass", color: "#2fae7a" },
  failing: { label: "Checks fail", color: "#e5534b" },
  pending: { label: "Checks running", color: "#e8a23a" },
  none: { label: "No checks", color: "#c4c8d0" },
};
export const REVIEW: Record<PullRequest["review"], { label: string; color: string }> = {
  approved: { label: "Approved", color: "#2fae7a" },
  changes: { label: "Changes requested", color: "#e5534b" },
  waiting: { label: "Review required", color: "#e8a23a" },
  none: { label: "No approval needed", color: "#c4c8d0" },
};

/** Merges a PR on the owner's click. Asks once more before merging a PR that isn't ready. */
export function MergeButton({ projectId, pr, small, onError }: { projectId: string; pr: Pick<PullRequest, "number" | "ready" | "state">; small?: boolean; onError?: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  if (pr.state !== "open") return null;
  const go = async () => {
    if (!pr.ready && !sure) return setSure(true);
    setBusy(true);
    onError?.("");
    try {
      await api(`/api/projects/${enc(projectId)}/prs/${pr.number}/merge`, {});
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setBusy(false);
      setSure(false);
    }
  };
  return (
    <button className={`btn ${small ? "btn-sm" : ""} ${pr.ready || sure ? "btn-primary" : ""}`} disabled={busy} onClick={go} title={pr.ready ? "Merge on GitHub now" : "Not ready yet: GitHub may refuse"}>
      {busy ? "Merging…" : sure ? "Merge anyway?" : "Merge"}
    </button>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f2ee] px-2 py-0.5 text-[11.5px] whitespace-nowrap text-[#4a4f5c]">
      <Dot color={color} />
      {children}
    </span>
  );
}

const STATE_LOOK: Record<PullRequest["state"], { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-[#e9f7f0] text-[#1d7a52]" },
  merged: { label: "Merged", cls: "bg-[#efeafd] text-[#6a4fc2]" },
  closed: { label: "Closed", cls: "bg-[#fdecea] text-[#a2352e]" },
};

export function PrCard({ pr, projectId, task, author, focus }: { pr: PullRequest; projectId: string; task?: Task; author?: Agent; focus?: boolean }) {
  const [err, setErr] = useState("");
  const look = STATE_LOOK[pr.state];
  return (
    <li className={`rounded-xl border px-3 py-2.5 ${focus ? "border-accent shadow-[0_0_0_3px_#e8ecfd]" : pr.ready ? "border-[#bfe5d2]" : "border-line"}`}>
      <div className="flex items-start gap-2">
        <b className="shrink-0 text-[13.5px]">#{pr.number}</b>
        <div className="min-w-0 flex-1 text-[13.5px] leading-snug break-words">{pr.title}</div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${look.cls}`}>{pr.draft && pr.state === "open" ? "Draft" : look.label}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        {author ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar agent={author} size={18} />
            {author.name}
          </span>
        ) : (
          <span>not from the team</span>
        )}
        {task && (
          <span>
            · <b className="font-semibold text-ink">{task.id}</b> {TASK_STATUS[task.status]}
          </span>
        )}
        <span>· {ago(pr.updatedAt)}</span>
      </div>
      {pr.state === "open" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Pill color={CHECKS[pr.checks].color}>{CHECKS[pr.checks].label}</Pill>
          <Pill color={REVIEW[pr.review].color}>{REVIEW[pr.review].label}</Pill>
          {pr.mergeable === "conflict" && <Pill color="#e5534b">Merge conflict</Pill>}
          <Pill color="#9aa1ae">
            {pr.comments} comment{pr.comments === 1 ? "" : "s"}
          </Pill>
          {task?.deployResult && <Pill color={/^fail/i.test(task.deployResult) ? "#e5534b" : "#2fae7a"}>Deploy step: {task.deployResult}</Pill>}
        </div>
      )}
      {pr.state === "open" && task?.status === "working" && <p className="mt-1.5 mb-0 text-[12px] text-[#8a5a10]">{author?.name ?? "The author"} is fixing review feedback.</p>}
      <div className="mt-2 flex items-center gap-1.5">
        {pr.ready && <span className="mr-auto text-[12px] font-semibold text-[#1d7a52]">Ready to merge</span>}
        <a className={`btn btn-sm ${pr.ready ? "" : "mr-auto"}`} href={pr.url} target="_blank" rel="noreferrer">
          Open on GitHub ↗
        </a>
        <MergeButton projectId={projectId} pr={pr} small onError={setErr} />
      </div>
      {err && <p className="mt-1 mb-0 text-[12px] text-bad">{err}</p>}
    </li>
  );
}

export function PrDrawer({ project, prs, tasks, agents, focusTask, onClose }: { project: Project; prs: PullRequest[]; tasks: Task[]; agents: Agent[]; focusTask?: string | null; onClose: () => void }) {
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const id = enc(project.id);
  useEffect(() => {
    let live = true;
    const load = () => void api<SyncStatus>(`/api/projects/${id}/sync`).then((s) => live && setSync(s), () => {});
    load();
    const t = setInterval(load, 10_000);
    return () => ((live = false), clearInterval(t));
  }, [id]);
  const syncNow = async () => {
    setBusy(true);
    try {
      setSync(await api<SyncStatus>(`/api/projects/${id}/sync`, {}));
    } catch {
      /* shown on the next load */
    } finally {
      setBusy(false);
    }
  };
  const open = prs.filter((p) => p.state === "open");
  const past = prs.filter((p) => p.state !== "open").slice(0, 12);
  const card = (pr: PullRequest) => (
    <PrCard key={pr.number} pr={pr} projectId={project.id} task={tasks.find((t) => t.id === pr.taskId)} author={agents.find((a) => a.id === pr.authorId)} focus={!!focusTask && pr.taskId === focusTask} />
  );
  return (
    <Drawer title="Pull requests" onClose={onClose}>
      <div className="mb-3 flex items-center gap-2 text-[12px] text-muted">
        <span className="min-w-0 flex-1">
          {sync?.lastAt ? (
            <>
              Checked GitHub {ago(sync.lastAt)}
              {!sync.ok && <span className="text-bad"> · last try failed: {sync.error}</span>}
            </>
          ) : (
            "Checks GitHub every 30 s."
          )}
        </span>
        <button className="btn btn-sm" disabled={busy} onClick={syncNow}>
          {busy ? "Checking…" : "Check now"}
        </button>
      </div>
      <p className="mt-0 mb-3 text-[12.5px] text-muted">
        A PR titled <code className="font-mono">[{project.prefix}-1] …</code> belongs to that task. Review comments go to its author; when it's ready, you merge.
      </p>
      <div className="lbl">Open · {open.length}</div>
      <ul className="m-0 mb-4 list-none space-y-2 p-0">{open.map(card)}</ul>
      {!open.length && <p className="mt-0 mb-4 text-[13px] text-muted">No open PRs. Workers open one when a task is built.</p>}
      {past.length > 0 && (
        <>
          <div className="lbl">Merged and closed</div>
          <ul className="m-0 list-none space-y-2 p-0">{past.map(card)}</ul>
        </>
      )}
    </Drawer>
  );
}
