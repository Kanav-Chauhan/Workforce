"use client";

// The cards in the right column: an agent (with its live screen), a task, or you (the CEO).

import { useEffect, useRef, useState } from "react";
import type { Activity, Agent, Message, Need, Project, Task } from "../../shared/types";
import { api } from "../lib/api";
import { agentTitle, ago, Avatar, clock, Dot, StatePill, TASK_STATUS } from "./ui";

function Close({ onClose }: { onClose: () => void }) {
  return (
    <button className="ml-auto self-start text-lg leading-none text-muted hover:text-ink" aria-label="Close" onClick={onClose}>
      ×
    </button>
  );
}

/** The agent's terminal: polled every second, typed into through /type. */
function Screen({ agent, full, onFull }: { agent: Agent; full: boolean; onFull: (v: boolean) => void }) {
  const [screen, setScreen] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api<{ screen: string }>(`/api/agents/${encodeURIComponent(agent.id)}/screen?lines=${full ? 200 : 60}`);
        if (live) setScreen(r.screen);
      } catch {
        /* the next tick tries again */
      }
      if (live) timer = setTimeout(tick, document.hidden ? 4000 : 1000);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [agent.id, full]);

  useEffect(() => {
    const b = box.current;
    if (b) b.scrollTop = b.scrollHeight;
  }, [screen]);

  const send = async (body: { text?: string; key?: string; enter?: boolean }) => {
    setErr("");
    try {
      await api(`/api/agents/${encodeURIComponent(agent.id)}/type`, body);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const keys: [string, string][] = [["Enter", "⏎"], ["Escape", "Esc"], ["Up", "↑"], ["Down", "↓"], ["Tab", "Tab"]];
  return (
    <div className={full ? "fixed inset-0 z-50 flex flex-col gap-2 bg-[#141925] p-3" : ""}>
      <div className="mb-1.5 flex items-center">
        <div className={`lbl !mb-0 ${full ? "!text-[#9fb3d9]" : ""}`}>{full ? `${agentTitle(agent)} · terminal` : "Terminal"}</div>
        <button className={`ml-auto text-[12px] ${full ? "text-[#cfd6e6]" : "text-accent"}`} onClick={() => onFull(!full)}>
          {full ? "Close full screen" : "Full screen"}
        </button>
      </div>
      <pre ref={box} className={`term m-0 overflow-auto ${full ? "flex-1 text-[12.5px]" : "h-[190px]"}`}>
        {agent.state === "off" && !screen ? "Not running. Press Start." : screen || "…"}
      </pre>
      <form
        className="mt-1.5 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send({ text, enter: true });
          setText("");
        }}
      >
        <input className={`field min-w-0 flex-1 py-1.5 font-mono text-[12.5px] ${full ? "border-[#2c3448] bg-[#1e2433] text-[#eef3ff]" : ""}`} placeholder="Type to the agent, Enter sends" value={text} onChange={(e) => setText(e.target.value)} disabled={agent.state === "off"} />
        <button className="btn btn-sm" disabled={agent.state === "off"}>
          Send
        </button>
      </form>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {keys.map(([k, label]) => (
          <button key={k} className={`rounded-md border px-2 py-0.5 font-mono text-[11.5px] ${full ? "border-[#2c3448] text-[#cfd6e6]" : "border-line text-[#4a4f5c] hover:bg-soft"}`} disabled={agent.state === "off"} onClick={() => void send({ key: k })}>
            {label}
          </button>
        ))}
      </div>
      {err && <p className="mt-1 text-[12px] text-bad">{err}</p>}
    </div>
  );
}

export function AgentPanel({ agent, tasks, activity, messages, onClose, onTask }: { agent: Agent; tasks: Task[]; activity: Activity[]; messages: Message[]; onClose: () => void; onTask: (id: string) => void }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [full, setFull] = useState(false);
  const task = tasks.find((t) => t.id === agent.taskId) ?? tasks.find((t) => t.ownerId === agent.id && t.status !== "done");
  const recent = activity.filter((a) => a.agentId === agent.id).slice(-4).reverse();
  const talk = messages.filter((m) => m.fromId === agent.id || m.toId === agent.id).slice(-3).reverse();
  const act = async (action: string) => {
    setBusy(action);
    setErr("");
    try {
      await api(`/api/agents/${encodeURIComponent(agent.id)}/${action}`, {});
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="rise">
      <div className="flex items-center gap-2.5">
        <Avatar agent={agent} />
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-semibold">{agentTitle(agent)}</h3>
          <div className="text-xs text-muted">{agent.isLead ? "Lead" : "Worker"}</div>
        </div>
        <Close onClose={onClose} />
      </div>
      <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Status</dt>
        <dd className="m-0">
          <StatePill state={agent.state} /> <span className="text-muted">· {ago(agent.stateSince)}</span>
        </dd>
        <dt className="text-muted">Doing</dt>
        <dd className="m-0 break-words">{agent.note || "—"}</dd>
        <dt className="text-muted">Task</dt>
        <dd className="m-0">
          {task ? (
            <button className="text-left text-accent hover:underline" onClick={() => onTask(task.id)}>
              {task.id} · {task.title}
            </button>
          ) : (
            "—"
          )}
        </dd>
      </dl>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {agent.state === "off" ? (
          <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => act("start")}>
            {busy === "start" ? "Starting…" : "Start"}
          </button>
        ) : (
          <button className="btn btn-sm" disabled={!!busy} onClick={() => act("stop")}>
            {busy === "stop" ? "Stopping…" : "Stop"}
          </button>
        )}
        <button className="btn btn-sm" disabled={!!busy} onClick={() => act("restart")}>
          {busy === "restart" ? "Restarting…" : "Restart"}
        </button>
      </div>
      {err && <p className="-mt-2 mb-2 text-[12px] text-bad">{err}</p>}
      <div className="lbl">Last actions</div>
      <ul className="mt-1 mb-3 list-disc pl-4 text-[12.5px] text-[#4a4f5c]">
        {recent.length ? recent.map((a) => <li key={a.id}>{a.text}</li>) : <li>Nothing yet</li>}
      </ul>
      {talk.length > 0 && (
        <>
          <div className="lbl">Messages</div>
          <ul className="mt-1 mb-3 space-y-1 text-[12.5px] text-[#4a4f5c]">
            {talk.map((m) => (
              <li key={m.id} className="line-clamp-2">
                <span className="text-muted">{clock(m.at)}</span> {m.fromId === agent.id ? "→" : "←"} {m.text}
              </li>
            ))}
          </ul>
        </>
      )}
      <Screen agent={agent} full={full} onFull={setFull} />
    </div>
  );
}

export function TaskPanel({ task, project, agents, activity, onClose, onAgent }: { task: Task; project?: Project; agents: Agent[]; activity: Activity[]; onClose: () => void; onAgent: (id: string) => void }) {
  const owner = agents.find((a) => a.id === task.ownerId);
  const history = activity.filter((a) => a.text.includes(task.id)).slice(-6).reverse();
  const workers = agents.filter((a) => !a.isLead);
  const [to, setTo] = useState("");
  const [err, setErr] = useState("");
  const assign = async () => {
    setErr("");
    try {
      await api(`/api/tasks/${encodeURIComponent(task.id)}/assign`, { to });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="rise">
      <div className="flex items-start gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fff1c2] text-[11px] font-bold">{task.id.split("-")[1]}</div>
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-semibold break-words">
            {task.id} · {task.title}
          </h3>
          <div className="text-xs text-muted">
            {TASK_STATUS[task.status]}
            {task.phase && ` · ${task.phase}`}
          </div>
        </div>
        <Close onClose={onClose} />
      </div>
      <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Owner</dt>
        <dd className="m-0">
          {owner ? (
            <button className="text-accent hover:underline" onClick={() => onAgent(owner.id)}>
              {agentTitle(owner)}
            </button>
          ) : (
            "Not assigned"
          )}
        </dd>
        <dt className="text-muted">PR</dt>
        <dd className="m-0">
          {task.prNumber ? (
            <a className="text-accent hover:underline" href={project ? `https://github.com/${project.repo}/pull/${task.prNumber}` : "#"} target="_blank" rel="noreferrer">
              #{task.prNumber}
            </a>
          ) : (
            "—"
          )}
        </dd>
        {task.doneWhen && (
          <>
            <dt className="text-muted">Done when</dt>
            <dd className="m-0">{task.doneWhen}</dd>
          </>
        )}
        {task.dependsOn.length > 0 && (
          <>
            <dt className="text-muted">After</dt>
            <dd className="m-0">{task.dependsOn.join(", ")}</dd>
          </>
        )}
        {task.note && (
          <>
            <dt className="text-muted">Note</dt>
            <dd className="m-0">{task.note}</dd>
          </>
        )}
      </dl>
      {task.details && (
        <>
          <div className="lbl">Details</div>
          <p className="mt-0 mb-3 text-[12.5px] whitespace-pre-wrap text-[#4a4f5c]">{task.details}</p>
        </>
      )}
      {task.files.length > 0 && (
        <>
          <div className="lbl">Files it may touch</div>
          <ul className="mt-0 mb-3 space-y-0.5 font-mono text-[11.5px] text-[#4a4f5c]">
            {task.files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
      {task.status === "todo" && workers.length > 0 && (
        <div className="mb-3 flex gap-1.5">
          <select className="field py-1.5" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Give it to…</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" disabled={!to} onClick={assign}>
            Assign
          </button>
        </div>
      )}
      {err && <p className="mb-2 text-[12px] text-bad">{err}</p>}
      <div className="lbl">History</div>
      <ul className="mt-0 space-y-1 text-[12.5px] text-[#4a4f5c]">
        {history.length ? (
          history.map((a) => (
            <li key={a.id}>
              <span className="text-muted">{clock(a.at)}</span> {a.text}
            </li>
          ))
        ) : (
          <li>Nothing yet</li>
        )}
      </ul>
    </div>
  );
}

export function CeoPanel({ needs, agents, onClose }: { needs: Need[]; agents: Agent[]; onClose: () => void }) {
  const working = agents.filter((a) => a.state === "working").length;
  return (
    <div className="rise">
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent font-bold text-white">Y</div>
        <div>
          <h3 className="m-0 text-[15px] font-semibold">You (CEO)</h3>
          <div className="text-xs text-muted">Owner · you answer, approve and merge</div>
        </div>
        <Close onClose={onClose} />
      </div>
      <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Team</dt>
        <dd className="m-0">
          {working} working · {agents.length} in the office
        </dd>
        <dt className="text-muted">Waiting</dt>
        <dd className="m-0">{needs.length ? `${needs.length} item${needs.length > 1 ? "s" : ""} need you (see the top)` : "Nothing. All clear."}</dd>
      </dl>
      <ul className="m-0 space-y-1 p-0 text-[12.5px]">
        {needs.map((n) => (
          <li key={n.id} className="flex items-center gap-2">
            <Dot color="#e8a23a" /> {n.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
