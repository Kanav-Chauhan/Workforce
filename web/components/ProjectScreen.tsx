"use client";

// The project screen: the office in the middle, Needs you on top, the right column (a bottom sheet on phones).

import { useEffect, useMemo, useState } from "react";
import { boardOf, boardsOf } from "../../shared/boards";
import type { Activity, Agent, Task } from "../../shared/types";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import type { Pick } from "../lib/office/engine";
import { BoardSwitcher, PortsDrawer } from "./Extras";
import { NeedsStrip } from "./NeedsStrip";
import { PrDrawer } from "./Prs";
import { Office } from "./Office";
import { AgentPanel, CeoPanel, TaskPanel } from "./Panels";
import { Settings } from "./Settings";
import { TopBar } from "./TopBar";
import { clock, TASK_STATUS } from "./ui";

type Tab = "activity" | "board" | "details";

function Feed({ activity, agents }: { activity: Activity[]; agents: Agent[] }) {
  const items = activity.slice(-80).reverse();
  return (
    <ol className="m-0 min-h-0 flex-1 list-none overflow-auto p-0">
      {items.map((a) => {
        const who = agents.find((x) => x.id === a.agentId);
        const text = who && a.text.startsWith(who.name) ? a.text.slice(who.name.length) : a.text;
        return (
          <li key={a.id} className="rise flex gap-2.5 border-b border-[#f2efea] py-1.5 text-[12.5px]">
            <time className="w-[42px] shrink-0 pt-px text-[11.5px] text-muted tabular-nums">{clock(a.at)}</time>
            <span className="min-w-0 break-words">
              {who && text !== a.text && <b>{who.name}</b>}
              {text}
            </span>
          </li>
        );
      })}
      {!items.length && <li className="py-2 text-[12.5px] text-muted">Nothing yet. Message the lead to get going.</li>}
    </ol>
  );
}

const COLS: { key: Task["status"][]; label: string }[] = [
  { key: ["working", "blocked"], label: "Working" },
  { key: ["review"], label: "Review" },
  { key: ["todo"], label: "To do" },
  { key: ["done"], label: "Done" },
];

function Board({ tasks, agents, onTask }: { tasks: Task[]; agents: Agent[]; onTask: (id: string) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {COLS.map((c) => {
        const list = tasks.filter((t) => c.key.includes(t.status));
        if (!list.length) return null;
        return (
          <section key={c.label} className="mb-3">
            <div className="lbl">
              {c.label} · {list.length}
            </div>
            <ul className="m-0 list-none space-y-1 p-0">
              {list.map((t) => {
                const owner = agents.find((a) => a.id === t.ownerId);
                return (
                  <li key={t.id}>
                    <button className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12.5px] hover:bg-soft" onClick={() => onTask(t.id)}>
                      <b className="shrink-0 font-semibold">{t.id}</b>
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {t.status === "blocked" && <span className="shrink-0 text-[11px] text-bad">{TASK_STATUS.blocked}</span>}
                      {t.prNumber && <span className="shrink-0 text-[11px] text-muted">PR #{t.prNumber}</span>}
                      {owner && <span className="shrink-0 text-[11px] text-muted">{owner.name}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!tasks.length && <p className="text-[12.5px] text-muted">No tasks yet. The lead writes them on the plan wall.</p>}
    </div>
  );
}

function MessageBox({ projectId, lead }: { projectId: string; lead?: Agent }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="m-3 mt-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setErr("");
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/message`, { text });
          setText("");
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-1.5 rounded-xl border border-line bg-white py-1.5 pr-1.5 pl-3 shadow-card">
        <input className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] outline-none" placeholder={lead ? `Message the lead (${lead.name})…` : "Message the lead…"} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          Send
        </button>
      </div>
      {err && <p className="mt-1 text-[12px] text-bad">{err}</p>}
    </form>
  );
}

export function ProjectScreen({ projectId, demo }: { projectId: string; demo: boolean }) {
  const v = useLive();
  const project = v.projects.find((p) => p.id === projectId);
  const agents = useMemo(() => v.agents.filter((a) => a.projectId === projectId), [v.agents, projectId]);
  const tasks = useMemo(() => v.tasks.filter((t) => t.projectId === projectId), [v.tasks, projectId]);
  const needs = useMemo(() => v.needs.filter((n) => n.projectId === projectId), [v.needs, projectId]);
  const activity = useMemo(() => v.activity.filter((a) => a.projectId === projectId), [v.activity, projectId]);
  const messages = useMemo(() => v.messages.filter((m) => m.projectId === projectId), [v.messages, projectId]);
  const [sel, setSel] = useState<Pick>(null);
  const [tab, setTab] = useState<Tab>("activity");
  const [listTab, setListTab] = useState<"activity" | "board">("activity");
  const [min, setMin] = useState(false);
  const [settings, setSettings] = useState(false);
  const [ports, setPorts] = useState(false);
  /** The PR drawer: false = closed, else the task to highlight ("" = none). */
  const [prPanel, setPrPanel] = useState<string | false>(false);
  const prs = useMemo(() => v.prs.filter((p) => p.projectId === projectId), [v.prs, projectId]);
  const boards = useMemo(() => (project ? boardsOf(project, tasks) : ["Main"]), [project, tasks]);
  const [boardPick, setBoardPick] = useState("");
  const board = boards.find((b) => b === boardPick) ?? boards[0]!;
  const boardTasks = useMemo(() => tasks.filter((t) => boardOf(t, boards) === board), [tasks, boards, board]);
  const counts = useMemo(() => Object.fromEntries(boards.map((b) => [b, tasks.filter((t) => boardOf(t, boards) === b && t.status !== "done").length])), [tasks, boards]);
  // The terminal needs room: widen the side panel on big screens while an agent is open.
  const [wide, setWide] = useState(true);
  const [bigScreen, setBigScreen] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1200px)");
    const on = () => setBigScreen(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const pick = (p: Pick) => {
    if (p?.kind === "parcel") return setPrPanel(p.id);
    setSel(p);
    if (p) {
      setTab("details");
      setMin(false);
    } else if (tab === "details") setTab("activity");
  };
  const selAgent = sel?.kind === "agent" ? agents.find((a) => a.id === sel.id) : undefined;
  const selTask = sel?.kind === "task" ? tasks.find((t) => t.id === sel.id) : undefined;
  const lead = agents.find((a) => a.isLead);
  const working = agents.filter((a) => a.state === "working").length;

  const details = selAgent ? (
    <AgentPanel agent={selAgent} wide={wide} onWide={bigScreen ? setWide : undefined} tasks={tasks} activity={activity} messages={messages} onClose={() => pick(null)} onTask={(id) => pick({ kind: "task", id })} />
  ) : selTask ? (
    <TaskPanel task={selTask} project={project} agents={agents} activity={activity} onClose={() => pick(null)} onAgent={(id) => pick({ kind: "agent", id })} />
  ) : sel?.kind === "ceo" ? (
    <CeoPanel needs={needs} agents={agents} onClose={() => pick(null)} />
  ) : null;

  if (!project && v.connected)
    return (
      <div className="grid h-dvh place-items-center text-sm text-muted">
        <p>
          No project called “{projectId}”. <a href="./">Back to your projects</a>
        </p>
      </div>
    );

  const boardTab = (
    <div className="flex min-h-0 flex-1 flex-col">
      <BoardSwitcher projectId={projectId} boards={boards} board={board} counts={counts} onPick={setBoardPick} />
      <Board tasks={boardTasks} agents={agents} onTask={(id) => pick({ kind: "task", id })} />
    </div>
  );

  // Tabs: on desktop the details card sits above the list; on phones everything shares one sheet.
  const mobileTab: Tab = tab === "details" && !details ? "activity" : tab;
  return (
    <div className="grid h-dvh w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
      <TopBar
        project={project}
        demo={demo}
        connected={v.connected}
        usage={v.usage}
        chips={[
          { label: `${working} working`, color: "#2fae7a" },
          { label: `${needs.length} needs you`, color: "#e8a23a", on: needs.length > 0 },
        ]}
        onSettings={() => setSettings(true)}
        onPorts={() => setPorts(true)}
        onPrs={() => setPrPanel("")}
        openPrs={prs.filter((p) => p.state === "open").length}
      />
      <main
        className={`grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] md:grid-rows-1 md:transition-[grid-template-columns] md:duration-300 ${selAgent && wide && bigScreen ? "md:grid-cols-[1fr_minmax(340px,600px)]" : "md:grid-cols-[1fr_340px]"}`}
      >
        <Office projectId={projectId} selected={selAgent?.id ?? null} onPick={pick} board={board} boards={boards} officeName={v.office.name}>
          {boards.length > 1 && (
            <div data-hud className="absolute top-3 right-3 max-w-[60%] rounded-xl bg-white/95 px-2 py-1.5 shadow-card max-md:top-auto max-md:bottom-3 max-md:left-3 max-md:right-auto max-md:max-w-[70%]">
              <BoardSwitcher compact projectId={projectId} boards={boards} board={board} counts={counts} onPick={setBoardPick} />
            </div>
          )}
          <NeedsStrip needs={needs} agents={agents} prs={prs} />
          {agents.length > 0 && agents.every((a) => a.state === "off") && (
            <div data-hud className="absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-white px-4 py-2.5 text-[13px] shadow-pop md:bottom-14">
              The team is off.
              <button className="btn btn-primary btn-sm" onClick={() => void api(`/api/projects/${encodeURIComponent(projectId)}/team/start`, {})}>
                Start team
              </button>
            </div>
          )}
        </Office>
        <aside
          className={`flex min-h-0 flex-col border-line bg-[#fbfaf8] max-md:rounded-t-2xl max-md:border-t max-md:shadow-[0_-6px_24px_rgba(40,35,25,.08)] max-md:transition-[height] max-md:duration-300 md:border-l ${min ? "max-md:h-[112px]" : details && mobileTab === "details" ? "max-md:h-[62dvh]" : "max-md:h-[38dvh]"}`}
          data-tab={mobileTab}
        >
          <div className="flex items-center gap-1 px-3 pt-2 md:hidden">
            {(["activity", "board", ...(details ? ["details"] : [])] as Tab[]).map((t) => (
              <button key={t} className={`rounded-lg px-2.5 py-1.5 text-[13px] ${mobileTab === t ? "bg-accent-soft font-semibold text-accent" : "text-muted"}`} onClick={() => (setTab(t), setMin(false))}>
                {t === "activity" ? "Activity" : t === "board" ? "Board" : selAgent ? selAgent.name : selTask ? selTask.id : "You"}
              </button>
            ))}
            <button className="ml-auto px-2 text-muted" aria-label={min ? "Open panel" : "Collapse panel"} onClick={() => setMin(!min)}>
              {min ? "▴" : "▾"}
            </button>
          </div>
          {details && (
            <section className={`card mx-3 mt-3 max-h-[66%] overflow-auto p-3.5 max-md:max-h-none max-md:min-h-0 max-md:flex-1 ${mobileTab === "details" ? "" : "max-md:hidden"}`}>{details}</section>
          )}
          <section className={`card mx-3 mt-3 flex min-h-0 flex-1 flex-col px-3.5 py-3 max-md:mt-2 ${mobileTab === "details" ? "max-md:hidden" : ""}`}>
            <div className="mb-1.5 hidden gap-3 md:flex">
              {(["activity", "board"] as const).map((t) => (
                <button key={t} className={`lbl !mb-0 ${listTab === t ? "!text-ink font-semibold" : "hover:!text-ink"}`} onClick={() => setListTab(t)}>
                  {t === "activity" ? "Activity" : `Board · ${tasks.length}`}
                </button>
              ))}
            </div>
            <div className="hidden min-h-0 flex-1 flex-col md:flex">{listTab === "activity" ? <Feed activity={activity} agents={agents} /> : boardTab}</div>
            <div className="flex min-h-0 flex-1 flex-col md:hidden">{mobileTab === "board" ? boardTab : <Feed activity={activity} agents={agents} />}</div>
          </section>
          <MessageBox projectId={projectId} lead={lead} />
        </aside>
      </main>
      {settings && project && <Settings project={project} agents={agents} usage={v.usage} office={v.office} demo={demo} onClose={() => setSettings(false)} />}
      {prPanel !== false && project && <PrDrawer project={project} prs={prs} tasks={tasks} agents={agents} focusTask={prPanel || null} onClose={() => setPrPanel(false)} />}
      {ports && <PortsDrawer projectId={projectId} agents={agents} onClose={() => setPorts(false)} />}
    </div>
  );
}
