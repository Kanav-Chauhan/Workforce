"use client";

// Settings for a project (and the machine): team, stack, MCP servers, environment, setup, general, debug.

import { useEffect, useState } from "react";
import { SIGNS } from "../../shared/signs";
import { STACK, stackPlan } from "../../shared/stacks";
import type { Agent, McpServer, MergeMethod, Office, PermissionStyle, Project, Reviewer, SyncStatus, Usage, Workflow } from "../../shared/types";
import { api } from "../lib/api";
import { store } from "../lib/live";
import { SetupChecklist } from "./Setup";
import { agentTitle, Avatar, roleLabel, StatePill } from "./ui";

type Tab = "team" | "workflow" | "stack" | "mcp" | "env" | "setup" | "general" | "debug";
const TABS: [Tab, string][] = [
  ["team", "Team"],
  ["workflow", "Workflow"],
  ["stack", "Stack"],
  ["mcp", "MCP servers"],
  ["env", "Environment"],
  ["general", "General"],
  ["setup", "Setup"],
  ["debug", "Debug"],
];

const enc = encodeURIComponent;

/** Runs an action with a busy flag and a readable error. */
function useAction() {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr("");
    try {
      await fn();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };
  return { busy, err, run, setErr };
}

const Err = ({ text }: { text: string }) => (text ? <p className="mt-2 mb-0 text-[12.5px] text-bad">{text}</p> : null);
const Intro = ({ children }: { children: React.ReactNode }) => <p className="mt-0 mb-3 text-[12.5px] text-muted">{children}</p>;

export type SettingsTab = Tab;

export function Settings({ project, agents, usage, office, demo, initialTab = "team", onClose }: { project: Project; agents: Agent[]; usage: Usage; office: Office; demo: boolean; initialTab?: Tab; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && e.target === document.body && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[rgba(43,47,58,.25)] p-3 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label="Settings" className="card rise flex h-[min(88dvh,720px)] w-full max-w-[820px] flex-col overflow-hidden sm:flex-row" onClick={(e) => e.stopPropagation()}>
        <nav className="flex shrink-0 gap-0.5 overflow-x-auto border-line bg-[#fbfaf8] p-2 max-sm:border-b sm:w-[168px] sm:flex-col sm:border-r sm:p-3">
          <div className="hidden truncate px-2 pb-2 text-[12px] text-muted sm:block" title={project.name}>
            Settings · <b className="text-ink">{project.name}</b>
          </div>
          {TABS.map(([t, label]) => (
            <button
              key={t}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-left text-[13px] whitespace-nowrap ${tab === t ? "bg-accent-soft font-semibold text-accent" : "text-[#4a4f5c] hover:bg-soft"}`}
              onClick={() => setTab(t)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center px-5 pt-4">
            <h2 className="m-0 text-[17px] font-semibold">{TABS.find((t) => t[0] === tab)![1]}</h2>
            <button className="ml-auto text-xl leading-none text-muted hover:text-ink" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 pt-2 pb-5">
            {tab === "team" && <TeamTab project={project} agents={agents} />}
            {tab === "workflow" && <WorkflowTab project={project} agents={agents} />}
            {tab === "stack" && <StackTab project={project} />}
            {tab === "mcp" && <McpTab agents={agents} />}
            {tab === "env" && <EnvTab agents={agents} />}
            {tab === "general" && <GeneralTab project={project} usage={usage} office={office} />}
            {tab === "setup" && (
              <>
                <Intro>What Workforce needs on this machine. Run fixes only what's listed; anything else you do yourself.{demo && " (Demo: fake results.)"}</Intro>
                <SetupChecklist />
              </>
            )}
            {tab === "debug" && <DebugTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ team

const COLORS = ["#4f6bed", "#22a48e", "#e3a52f", "#f0705d", "#9b7bd8", "#d4608f", "#5fb3c9", "#6c9a4a"];

function TeamTab({ project, agents }: { project: Project; agents: Agent[] }) {
  const free = SIGNS.filter((s) => !agents.some((a) => a.sign === s.sign));
  const [sign, setSign] = useState("");
  const [removing, setRemoving] = useState<Agent | null>(null);
  const [custom, setCustom] = useState(false);
  const { busy, err, run } = useAction();
  const id = enc(project.id);
  return (
    <>
      <Intro>
        {project.repo} · each agent has its own folder and terminal. Leo leads; everyone else builds.
      </Intro>
      <ul className="m-0 mb-3 list-none space-y-2 p-0">
        {agents.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
            <Avatar agent={a} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">
                {agentTitle(a)} <span className="font-normal text-muted">· {roleLabel(a)}</span>
                {a.model && <span className="font-normal text-muted"> · {a.model}</span>}
              </div>
              <div className="truncate text-[12px]">
                <StatePill state={a.state} />
                {a.folder && <span className="text-muted"> · works in {a.folder}</span>}
              </div>
            </div>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run(a.id, () => api(`/api/agents/${enc(a.id)}/${a.state === "off" ? "start" : "stop"}`, {}))}>
              {a.state === "off" ? "Start" : "Stop"}
            </button>
            {!a.isLead && (
              <button className="btn btn-sm !text-bad" disabled={!!busy} onClick={() => setRemoving(a)} aria-label={`Remove ${a.name}`}>
                Remove
              </button>
            )}
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
      <div className="lbl">Add a zodiac worker</div>
      <div className="mb-4 flex gap-2">
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
      {custom ? <CustomAgentForm projectId={project.id} onDone={() => setCustom(false)} /> : (
        <button className="btn" onClick={() => setCustom(true)}>
          + Custom agent (your own name and role)
        </button>
      )}
      <Err text={err} />
      {removing && <RemoveDialog agent={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

function CustomAgentForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [f, setF] = useState({ name: "", role: "", color: COLORS[0]!, model: "", folder: "" });
  const { busy, err, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="rounded-xl border border-line p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("custom", () => api(`/api/projects/${enc(projectId)}/agents`, { custom: f }))) onDone();
      }}
    >
      <div className="lbl">Custom agent</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[12px] text-muted">
          Name
          <input className="field mt-0.5" placeholder="Quinn" value={f.name} onChange={set("name")} />
        </label>
        <label className="text-[12px] text-muted">
          Role
          <input className="field mt-0.5" placeholder="QA, Designer…" value={f.role} onChange={set("role")} />
        </label>
        <label className="text-[12px] text-muted">
          Model
          <select className="field mt-0.5" value={f.model} onChange={set("model")}>
            <option value="">Claude Code's default</option>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
          </select>
        </label>
        <div className="text-[12px] text-muted">
          Colour
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                aria-label={`Colour ${c}`}
                className={`h-6 w-6 rounded-full ${f.color === c ? "ring-2 ring-ink ring-offset-2" : ""}`}
                style={{ background: c }}
                onClick={() => setF({ ...f, color: c })}
              />
            ))}
          </div>
        </div>
      </div>
      <label className="mt-2 block text-[12px] text-muted">
        Existing folder (optional; empty = its own clone of the repo)
        <input className="field mt-0.5 font-mono text-[12.5px]" placeholder="/home/you/code/app" value={f.folder} onChange={set("folder")} />
      </label>
      <div className="mt-3 flex gap-2">
        <button className="btn btn-primary" disabled={!!busy || !f.name.trim() || !f.role.trim()}>
          {busy ? "Adding…" : "Add agent"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      <Err text={err} />
    </form>
  );
}

function RemoveDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [del, setDel] = useState(false);
  const { busy, err, run } = useAction();
  const own = !agent.folder;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(43,47,58,.3)] p-4" onClick={onClose}>
      <div role="alertdialog" aria-label={`Remove ${agent.name}`} className="card rise w-full max-w-[400px] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="m-0 mb-2 text-[16px] font-semibold">Remove {agent.name}?</h3>
        <p className="mt-0 mb-3 text-[13px] text-[#4a4f5c]">
          {agent.name} stops now and leaves the team. Its open tasks go back to To do, and its environment variables are deleted.
        </p>
        {own ? (
          <fieldset className="m-0 mb-3 space-y-1.5 border-0 p-0 text-[13px]">
            <label className="flex items-start gap-2">
              <input type="radio" name="folder" checked={!del} onChange={() => setDel(false)} className="mt-1" />
              <span>
                <b>Keep its folder</b> <span className="text-muted">(unpushed work stays on disk)</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="folder" checked={del} onChange={() => setDel(true)} className="mt-1" />
              <span>
                <b>Delete its folder</b> <span className="text-muted">(anything not pushed is lost)</span>
              </span>
            </label>
          </fieldset>
        ) : (
          <p className="mt-0 mb-3 text-[12.5px] text-muted">It worked in your folder {agent.folder}; that folder is kept.</p>
        )}
        <div className="flex gap-2">
          <button className="btn btn-primary !bg-bad !border-bad" disabled={!!busy} onClick={async () => (await run("rm", () => api(`/api/agents/${enc(agent.id)}${del ? "?deleteFolder=1" : ""}`, undefined, "DELETE"))) && onClose()}>
            {busy ? "Removing…" : `Remove ${agent.name}`}
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
        <Err text={err} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stack

interface StackReport {
  at: string;
  skills: { name: string; repo: string; tools: string[] }[];
  domains: string[];
  agents: { agentId: string; name: string; skills: number; note: string }[];
  problems: string[];
}

function StackTab({ project }: { project: Project }) {
  const [picked, setPicked] = useState<string[]>(project.stack);
  const [report, setReport] = useState<StackReport | null>(null);
  const { busy, err, run } = useAction();
  useEffect(() => {
    void api<{ stack: string[]; report: StackReport | null }>(`/api/projects/${enc(project.id)}/stack`).then((r) => (setPicked(r.stack), setReport(r.report)), () => {});
  }, [project.id]);
  const plan = stackPlan(picked);
  const changed = picked.slice().sort().join() !== project.stack.slice().sort().join();
  return (
    <>
      <Intro>
        Tick what this project uses. Each agent gets the tool makers' official Claude Code skills (in its own folder, hidden from git) and may read their docs sites without asking.
      </Intro>
      <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {STACK.map((t) => (
          <label key={t.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] ${picked.includes(t.id) ? "border-accent bg-accent-soft" : "border-line"}`}>
            <input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} />
            <span className="min-w-0 flex-1 truncate">{t.label}</span>
            {t.skills ? <span className="text-[10.5px] text-accent" title={`Official skills from ${t.skills.repo}`}>skills</span> : <span className="text-[10.5px] text-muted">docs</span>}
          </label>
        ))}
      </div>
      <p className="mt-0 mb-3 text-[12px] text-muted">
        {plan.skills.length} skill{plan.skills.length === 1 ? "" : "s"} · {plan.domains.length} docs site{plan.domains.length === 1 ? "" : "s"}
      </p>
      <button className="btn btn-primary" disabled={!!busy || (!changed && !!report)} onClick={() => run("save", async () => setReport((await api<{ report: StackReport }>(`/api/projects/${enc(project.id)}/stack`, { tools: picked })).report))}>
        {busy ? "Installing…" : "Save and install"}
      </button>
      <Err text={err} />
      {report && (
        <div className="mt-4 rounded-xl border border-line p-3 text-[12.5px]">
          <div className="lbl">Installed {new Date(report.at).toLocaleString()}</div>
          {report.skills.length ? (
            <ul className="m-0 mb-2 list-none space-y-0.5 p-0">
              {report.skills.map((s) => (
                <li key={s.name}>
                  <b>{s.name}</b> <span className="text-muted">from {s.repo} ({s.tools.join(", ")})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-0 mb-2 text-muted">No skills (the ticked tools only add docs sites).</p>
          )}
          {report.domains.length > 0 && <p className="mt-0 mb-2">Docs sites allowed: {report.domains.join(", ")}</p>}
          <ul className="m-0 list-none space-y-0.5 p-0">
            {report.agents.map((a) => (
              <li key={a.agentId}>
                {a.name}: {a.skills} skill{a.skills === 1 ? "" : "s"} · <span className="text-muted">{a.note}</span>
              </li>
            ))}
          </ul>
          {report.problems.map((p) => (
            <p key={p} className="mt-1 mb-0 text-bad">
              {p}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ MCP

const blank = (): McpServer => ({ id: 0, name: "", kind: "stdio", command: "", args: [], url: "", headerName: "", envName: "", agentIds: [] });

function McpTab({ agents }: { agents: Agent[] }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [edit, setEdit] = useState<McpServer | null>(null);
  const [argText, setArgText] = useState("");
  const { busy, err, run } = useAction();
  const load = async () => setServers((await api<{ servers: McpServer[] }>("/api/mcp")).servers);
  useEffect(() => {
    void load().catch(() => {});
  }, []);
  const mine = (m: McpServer) => agents.filter((a) => m.agentIds.includes(a.id));
  const open = (m: McpServer) => {
    setEdit(m);
    setArgText(m.args.join(" "));
  };
  return (
    <>
      <Intro>
        Extra tools for chosen agents, next to the team tools. Secrets never go here: for a header, give its name and the environment variable that holds the value (set it in Environment).
        Agents load changes when they restart.
      </Intro>
      <ul className="m-0 mb-3 list-none space-y-2 p-0">
        {servers.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">
                {m.name} <span className="font-normal text-muted">· {m.kind === "http" ? m.url : [m.command, ...m.args].join(" ")}</span>
              </div>
              <div className="truncate text-[12px] text-muted">
                {mine(m).length ? `For ${mine(m).map((a) => a.name).join(", ")}` : "No agent in this project has it"}
                {m.envName && ` · ${m.headerName} from $${m.envName}`}
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => open(m)}>
              Edit
            </button>
            <button className="btn btn-sm !text-bad" disabled={!!busy} onClick={() => run("rm", async () => (await api(`/api/mcp/${m.id}`, undefined, "DELETE"), await load()))}>
              Remove
            </button>
          </li>
        ))}
        {!servers.length && <li className="text-[13px] text-muted">No extra servers yet.</li>}
      </ul>
      {edit ? (
        <form
          className="rounded-xl border border-line p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { ...edit, args: argText.split(/\s+/).filter(Boolean) };
            if (await run("save", async () => (await api("/api/mcp", body), await load()))) setEdit(null);
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[12px] text-muted">
              Name
              <input className="field mt-0.5" placeholder="sentry" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label className="text-[12px] text-muted">
              Kind
              <select className="field mt-0.5" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as McpServer["kind"] })}>
                <option value="stdio">Command (stdio)</option>
                <option value="http">URL (http)</option>
              </select>
            </label>
          </div>
          {edit.kind === "stdio" ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr]">
              <label className="text-[12px] text-muted">
                Command
                <input className="field mt-0.5 font-mono text-[12.5px]" placeholder="npx" value={edit.command} onChange={(e) => setEdit({ ...edit, command: e.target.value })} />
              </label>
              <label className="text-[12px] text-muted">
                Arguments (space separated)
                <input className="field mt-0.5 font-mono text-[12.5px]" placeholder="-y @playwright/mcp@latest" value={argText} onChange={(e) => setArgText(e.target.value)} />
              </label>
            </div>
          ) : (
            <>
              <label className="mt-2 block text-[12px] text-muted">
                URL
                <input className="field mt-0.5 font-mono text-[12.5px]" placeholder="https://mcp.example.com/mcp" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} />
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="text-[12px] text-muted">
                  Header name (optional)
                  <input className="field mt-0.5 font-mono text-[12.5px]" placeholder="Authorization" value={edit.headerName} onChange={(e) => setEdit({ ...edit, headerName: e.target.value })} />
                </label>
                <label className="text-[12px] text-muted">
                  Value comes from variable
                  <input className="field mt-0.5 font-mono text-[12.5px]" placeholder="SENTRY_TOKEN" value={edit.envName} onChange={(e) => setEdit({ ...edit, envName: e.target.value })} />
                </label>
              </div>
            </>
          )}
          <div className="mt-2 text-[12px] text-muted">Agents that get it</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12.5px]">
                <input type="checkbox" checked={edit.agentIds.includes(a.id)} onChange={(e) => setEdit({ ...edit, agentIds: e.target.checked ? [...edit.agentIds, a.id] : edit.agentIds.filter((x) => x !== a.id) })} />
                {a.name}
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" disabled={!!busy}>
              {edit.id ? "Save" : "Add server"}
            </button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn" onClick={() => open(blank())}>
          + Add a server
        </button>
      )}
      <Err text={err} />
    </>
  );
}

// ------------------------------------------------------------------ environment

interface EnvVar {
  name: string;
  set: boolean;
  neededBy: string[];
}

function EnvTab({ agents }: { agents: Agent[] }) {
  const [who, setWho] = useState(agents[0]?.id ?? "");
  const [vars, setVars] = useState<EnvVar[] | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const { busy, err, run, setErr } = useAction();
  useEffect(() => {
    if (!who) return;
    setVars(null);
    setErr("");
    void api<{ vars: EnvVar[] }>(`/api/agents/${enc(who)}/env`).then((r) => setVars(r.vars), (e: Error) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who]);
  const save = (n: string, v: string) =>
    run("save", async () => {
      setVars((await api<{ vars: EnvVar[] }>(`/api/agents/${enc(who)}/env`, { name: n, value: v })).vars);
      setName("");
      setValue("");
    });
  return (
    <>
      <Intro>
        Keys and settings for one agent, loaded into its session when it starts. Stored only on this machine (owner-only file in ~/.workforce). Values are never shown again; the agent is told the names only.
      </Intro>
      <div className="mb-3 flex flex-wrap gap-1">
        {agents.map((a) => (
          <button key={a.id} className={`rounded-lg px-2.5 py-1 text-[13px] ${who === a.id ? "bg-accent-soft font-semibold text-accent" : "text-[#4a4f5c] hover:bg-soft"}`} onClick={() => setWho(a.id)}>
            {a.name}
          </button>
        ))}
      </div>
      <ul className="m-0 mb-3 list-none space-y-1.5 p-0">
        {vars?.map((v) => (
          <li key={v.name} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{v.name}</code>
            {v.neededBy.length > 0 && <span className="text-[11px] text-muted">for {v.neededBy.join(", ")}</span>}
            <span className={`chip !text-[11px] ${v.set ? "!bg-[#e7f6ee] !text-[#1f7a52]" : "!bg-[#fff3df] !text-[#8a5a10]"}`}>{v.set ? "set" : "not set"}</span>
            {v.set ? (
              <button className="text-[12px] text-bad" disabled={!!busy} onClick={() => run("rm", async () => setVars((await api<{ vars: EnvVar[] }>(`/api/agents/${enc(who)}/env/${enc(v.name)}`, undefined, "DELETE")).vars))}>
                Remove
              </button>
            ) : (
              <button className="text-[12px] text-accent" onClick={() => setName(v.name)}>
                Set
              </button>
            )}
          </li>
        ))}
        {vars && !vars.length && <li className="text-[13px] text-muted">Nothing set for this agent.</li>}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(name, value);
        }}
      >
        <input className="field w-[180px] font-mono text-[12.5px]" placeholder="NAME" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} autoComplete="off" />
        <input className="field min-w-0 flex-1 font-mono text-[12.5px]" type="password" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="new-password" />
        <button className="btn btn-primary" disabled={!!busy || !name.trim()}>
          Save
        </button>
      </form>
      <p className="mt-2 mb-0 text-[12px] text-muted">Restart the agent to load changes.</p>
      <Err text={err} />
    </>
  );
}

// ------------------------------------------------------------------ general

function GeneralTab({ project, usage, office }: { project: Project; usage: Usage; office: Office }) {
  const [name, setName] = useState(office.name);
  const [limit, setLimit] = useState(String(usage.limit));
  const [planPath, setPlanPath] = useState<string | null>(null);
  const { busy, err, run } = useAction();
  const id = enc(project.id);
  useEffect(() => {
    void api<{ path: string | null }>(`/api/projects/${id}/plan-export`).then((r) => setPlanPath(r.path), () => {});
  }, [id, project.planExport]);
  const patch = (body: { permissionStyle?: PermissionStyle; planExport?: boolean }) => run("patch", () => api(`/api/projects/${id}`, body, "PATCH"));
  return (
    <>
      <div className="lbl">Office name</div>
      <form
        className="mb-1 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("office", () => api("/api/office", { name }));
        }}
      >
        <input className="field" placeholder="e.g. Kanav's studio" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!!busy || name === office.name}>
          Save
        </button>
      </form>
      <p className="mt-0 mb-5 text-[12px] text-muted">Shown on a sign in every office.</p>

      <div className="lbl">Permission style · {project.name}</div>
      <div className="mb-1 grid gap-2 sm:grid-cols-2">
        {(["careful", "trusted"] as const).map((s) => (
          <label key={s} className={`cursor-pointer rounded-xl border px-3 py-2 text-[12.5px] ${project.permissionStyle === s ? "border-accent bg-accent-soft" : "border-line"}`}>
            <input type="radio" className="mr-1.5" checked={project.permissionStyle === s} onChange={() => void patch({ permissionStyle: s })} />
            <b>{s === "careful" ? "Careful" : "Trusted"}</b>
            <span className="block text-muted">{s === "careful" ? "Shell commands and web fetches ask you." : "Most commands run; only risky ones ask."}</span>
          </label>
        ))}
      </div>
      <p className="mt-0 mb-5 text-[12px] text-muted">Takes effect when agents restart.</p>

      <div className="lbl">Plan export</div>
      <label className="mb-1 flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={project.planExport} onChange={(e) => void patch({ planExport: e.target.checked })} />
        Write the plan to <code className="font-mono text-[12px]">docs/plan.md</code> in the lead's folder
      </label>
      <p className="mt-0 mb-5 text-[12px] text-muted">
        Updated after every task change. Nobody commits it automatically; you decide.
        {project.planExport && planPath && (
          <>
            {" "}
            File: <code className="font-mono break-all">{planPath}</code>
          </>
        )}
      </p>

      <div className="lbl">Weekly usage limit</div>
      <div className="flex items-center gap-2">
        <input className="field w-24" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
        <span className="text-[13px] text-muted">% · the team pauses here</span>
        <button className="btn btn-sm ml-auto" disabled={!!busy} onClick={() => run("limit", async () => store.setUsage(await api<Usage>("/api/usage", { limit: Number(limit) })))}>
          Save
        </button>
      </div>
      <Err text={err} />
    </>
  );
}

// ------------------------------------------------------------------ workflow

const REVIEWERS: [Reviewer, string, string][] = [
  ["owner", "You", "You review on GitHub. Your comments go to the PR's author."],
  ["coderabbit", "CodeRabbit", "Agents wait for CodeRabbit's review and fix what it finds."],
  ["greptile", "Greptile", "Agents wait for Greptile's review and fix what it finds."],
  ["copilot", "Copilot", "Agents wait for GitHub Copilot's review and fix what it finds."],
  ["custom", "A command", "Runs your command in the author's folder after each push and sends them the output."],
  ["none", "No reviewer", "A PR is ready as soon as its checks pass."],
];
const METHODS: [MergeMethod, string][] = [
  ["squash", "Squash"],
  ["merge", "Merge commit"],
  ["rebase", "Rebase"],
];

function WorkflowTab({ project, agents }: { project: Project; agents: Agent[] }) {
  const [w, setW] = useState<Workflow>(project.workflow);
  const [saved, setSaved] = useState(false);
  const { busy, err, run } = useAction();
  useEffect(() => setW(project.workflow), [project.workflow]);
  const set = (patch: Partial<Workflow>) => (setW({ ...w, ...patch }), setSaved(false));
  const dirty = JSON.stringify(w) !== JSON.stringify(project.workflow);
  const workers = agents.filter((a) => !a.isLead);
  const save = () => run("save", async () => (await api(`/api/projects/${enc(project.id)}`, { workflow: w }, "PATCH"), setSaved(true)));
  return (
    <>
      <Intro>How a finished task gets from a pull request to merged. Workforce watches GitHub every 30 seconds and moves tasks for you.</Intro>

      <div className="lbl">Who reviews</div>
      <div className="mb-1 grid gap-2 sm:grid-cols-2">
        {REVIEWERS.map(([id, label, help]) => (
          <label key={id} className={`cursor-pointer rounded-xl border px-3 py-2 text-[12.5px] ${w.reviewer === id ? "border-accent bg-accent-soft" : "border-line"}`}>
            <input type="radio" className="mr-1.5" name="reviewer" checked={w.reviewer === id} onChange={() => set({ reviewer: id })} />
            <b>{label}</b>
            <span className="block text-muted">{help}</span>
          </label>
        ))}
      </div>
      {w.reviewer === "custom" && (
        <input className="field mt-1 font-mono text-[12.5px]" placeholder="e.g. npx eslint . --max-warnings 0" value={w.reviewCommand} onChange={(e) => set({ reviewCommand: e.target.value })} />
      )}
      {["coderabbit", "greptile", "copilot"].includes(w.reviewer) && <p className="mt-1 mb-0 text-[12px] text-muted">Install the bot on the repo on GitHub first; Workforce only reads its comments.</p>}

      <div className="lbl mt-5">Who merges</div>
      <div className="mb-1 grid gap-2 sm:grid-cols-2">
        <label className={`cursor-pointer rounded-xl border px-3 py-2 text-[12.5px] ${w.mergeBy === "owner" ? "border-accent bg-accent-soft" : "border-line"}`}>
          <input type="radio" className="mr-1.5" name="mergeBy" checked={w.mergeBy === "owner"} onChange={() => set({ mergeBy: "owner" })} />
          <b>You</b> <span className="text-muted">(recommended)</span>
          <span className="block text-muted">A Merge button shows in Needs you when a PR is ready.</span>
        </label>
        <label className={`cursor-pointer rounded-xl border px-3 py-2 text-[12.5px] ${w.mergeBy === "lead" ? "border-[#e8a23a] bg-[#fff8e8]" : "border-line"}`}>
          <input type="radio" className="mr-1.5" name="mergeBy" checked={w.mergeBy === "lead"} onChange={() => set({ mergeBy: "lead" })} />
          <b>The lead may merge</b>
          <span className="block text-muted">Only PRs linked to a task, with passing checks and a finished review. You still can.</span>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="text-muted">Merge as</span>
        {METHODS.map(([id, label]) => (
          <button key={id} className={`rounded-lg px-2.5 py-1 ${w.mergeMethod === id ? "bg-accent-soft font-semibold text-accent" : "text-[#4a4f5c] hover:bg-soft"}`} onClick={() => set({ mergeMethod: id })}>
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 mb-0 text-[12px] text-muted">If the repo doesn't allow that way, the first allowed one is used.</p>

      <div className="lbl mt-5">Deploy step (optional)</div>
      <input className="field font-mono text-[12.5px]" placeholder="e.g. npm run build" value={w.deployCommand} onChange={(e) => set({ deployCommand: e.target.value })} />
      <p className="mt-1 mb-2 text-[12px] text-muted">The ticked agents run this in their folder before opening a PR and report the result. No servers are deployed.</p>
      <div className="flex flex-wrap gap-2">
        {workers.map((a) => (
          <label key={a.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12.5px] ${w.deployAgents.includes(a.id) ? "border-accent bg-accent-soft" : "border-line"} ${w.deployCommand.trim() ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              disabled={!w.deployCommand.trim()}
              checked={w.deployAgents.includes(a.id)}
              onChange={(e) => set({ deployAgents: e.target.checked ? [...w.deployAgents, a.id] : w.deployAgents.filter((x) => x !== a.id) })}
            />
            <Avatar agent={a} size={18} />
            {a.name}
          </label>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button className="btn btn-primary" disabled={!!busy || !dirty} onClick={save}>
          Save
        </button>
        <span className="text-[12px] text-muted">{saved && !dirty ? "Saved. Agents follow the new rules after a restart." : "Agents follow changes after a restart."}</span>
      </div>
      <Err text={err} />
    </>
  );
}

// ------------------------------------------------------------------ debug

interface Debug {
  version: string;
  node: string;
  uptimeS: number;
  pid: number;
  tmuxSessions: string[];
  liveTerminals: boolean;
  lastHooks: { agentId: string; name: string; projectId: string; event: string | null; at: string | null }[];
  sync?: SyncStatus[];
}

const dur = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`);

function DebugTab() {
  const [d, setD] = useState<Debug | null>(null);
  const [err, setErr] = useState("");
  const load = () => void api<Debug>("/api/debug").then(setD, (e: Error) => setErr(e.message));
  useEffect(load, []);
  return (
    <>
      <Intro>For when something looks stuck.</Intro>
      {d && (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted">Server</dt>
          <dd className="m-0">
            Workforce {d.version} · Node {d.node} · pid {d.pid}
          </dd>
          <dt className="text-muted">Up for</dt>
          <dd className="m-0">{dur(d.uptimeS)}</dd>
          <dt className="text-muted">Live terminals</dt>
          <dd className="m-0">{d.liveTerminals ? "on" : "off (snapshots)"}</dd>
          <dt className="text-muted">tmux sessions</dt>
          <dd className="m-0 font-mono text-[12px]">{d.tmuxSessions.length ? d.tmuxSessions.join(", ") : "none"}</dd>
          <dt className="text-muted">GitHub sync</dt>
          <dd className="m-0">
            <ul className="m-0 list-none space-y-0.5 p-0">
              {(d.sync ?? []).map((x) => (
                <li key={x.projectId}>
                  {x.projectId}: {x.lastAt ? `last ${new Date(x.lastAt).toLocaleTimeString()}` : "not yet"}
                  {x.ok ? <span className="text-[#1d7a52]"> · ok</span> : <span className="text-bad"> · failed {x.failures}× ({x.error})</span>}
                  {x.nextAt && <span className="text-muted"> · next {new Date(x.nextAt).toLocaleTimeString()}</span>}
                  {x.rateRemaining !== null && <span className="text-muted"> · {x.rateRemaining} GitHub points left this hour</span>}
                </li>
              ))}
              {!d.sync?.length && <li className="text-muted">no projects</li>}
            </ul>
          </dd>
          <dt className="text-muted">Last hooks</dt>
          <dd className="m-0">
            <ul className="m-0 list-none space-y-0.5 p-0">
              {d.lastHooks.map((h) => (
                <li key={h.agentId}>
                  {h.name} <span className="text-muted">({h.projectId})</span>: {h.event ? `${h.event} at ${new Date(h.at!).toLocaleTimeString()}` : <span className="text-muted">none since the server started</span>}
                </li>
              ))}
            </ul>
          </dd>
        </dl>
      )}
      <button className="btn btn-sm mt-3" onClick={load}>
        Refresh
      </button>
      <Err text={err} />
    </>
  );
}
