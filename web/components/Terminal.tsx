"use client";

// The agent panel's terminal: a real, interactive terminal (xterm.js) on the agent's Claude Code
// session, plus a Shell tab with bash in the agent's own folder. Falls back to the old 1-second
// snapshot view when the server can't run live terminals.

import type { ITheme, Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { Agent } from "../../shared/types";
import { api } from "../lib/api";
import { KEY_BAR, planKey } from "../lib/term/keys";
import { openTerm, terminalSupport, type TermKind, type TermLink } from "../lib/term/link";
import { agentTitle } from "./ui";

const LIGHT: ITheme = {
  background: "#fbfaf7",
  foreground: "#2b2f3a",
  cursor: "#4f6bed",
  cursorAccent: "#ffffff",
  selectionBackground: "#c9d3fb",
  selectionInactiveBackground: "#e3e7f7",
  black: "#2b2f3a",
  red: "#c9372c",
  green: "#1f8a5b",
  yellow: "#9a6400",
  blue: "#3b5bdb",
  magenta: "#9c36b5",
  cyan: "#0b7285",
  white: "#8a8f9c",
  brightBlack: "#6b7080",
  brightRed: "#e5534b",
  brightGreen: "#2fae7a",
  brightYellow: "#b7800f",
  brightBlue: "#4f6bed",
  brightMagenta: "#b45cc8",
  brightCyan: "#1098ad",
  brightWhite: "#b4b8c2",
};
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

let support: Promise<{ available: boolean; reason: string }> | null = null;

type Phase = { kind: "connecting" | "live" } | { kind: "stopped" | "ended" | "error"; text: string };

/** One xterm bound to one live terminal. Remounts (key) when the target changes. */
function XtermView({ id, name, kind, onLink, onPhase }: { id: string; name: string; kind: TermKind; onLink: (l: TermLink | null) => void; onPhase: (p: Phase) => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let term: XTerm | null = null;
    let link: TermLink | null = null;
    let observer: ResizeObserver | null = null;
    onPhase({ kind: "connecting" });
    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit"), import("@xterm/addon-web-links")]);
      if (disposed || !host.current) return;
      const narrow = window.matchMedia("(max-width: 640px)").matches;
      term = new Terminal({
        theme: LIGHT,
        fontFamily: FONT,
        fontSize: narrow ? 11.5 : 12.5,
        lineHeight: 1.15,
        scrollback: 5000,
        cursorBlink: true,
        allowProposedApi: false,
        // Claude Code may paint colours meant for a dark screen; keep them readable here.
        minimumContrastRatio: 4.5,
        macOptionIsMeta: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, "_blank", "noopener,noreferrer")));
      term.open(host.current);
      fit.fit();
      const t = term;
      link = openTerm(kind, id, {
        output: (d) => t.write(d),
        notice: (k, text) => {
          if (k === "ready") onPhase({ kind: "live" });
          else if (k === "ended") onPhase({ kind: "ended", text: kind === "agent" ? `${name}'s session ended.` : kind === "fix" ? "Finished." : "The shell ended." });
          else onPhase({ kind: "error", text: text || "Disconnected" });
        },
      }, { cols: t.cols, rows: t.rows });
      onLink(link);
      const l = link;
      t.onData((d) => l.keys(d));
      t.onResize(({ cols, rows }) => l.size(cols, rows));
      t.attachCustomKeyEventHandler((e) => {
        const plan = planKey(e, t.hasSelection());
        if (plan === "terminal") return true;
        if (plan === "browser") return false; // the browser's copy/paste event reaches xterm
        e.preventDefault();
        if (typeof plan === "object") l.keys(plan.send);
        return false;
      });
      let pending = 0;
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => {
          try {
            fit.fit();
          } catch {
            /* hidden */
          }
        });
      });
      observer.observe(host.current);
      if (!narrow) t.focus();
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      link?.close();
      onLink(null);
      term?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  return <div ref={host} className="xterm-host h-full w-full" />;
}

/** The old view: the screen as plain text, polled every second. */
function SnapshotScreen({ agent, full, note }: { agent: Agent; full: boolean; note: string }) {
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
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-1.5 text-[11.5px] text-muted">{note}</p>
      <pre ref={box} className={`term m-0 overflow-auto ${full ? "flex-1" : "h-[190px]"}`}>
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
        <input className="field min-w-0 flex-1 py-1.5 font-mono text-[12.5px]" placeholder="Type to the agent, Enter sends" value={text} onChange={(e) => setText(e.target.value)} disabled={agent.state === "off"} />
        <button className="btn btn-sm" disabled={agent.state === "off"}>
          Send
        </button>
      </form>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {keys.map(([k, label]) => (
          <button key={k} className="rounded-md border border-line px-2 py-0.5 font-mono text-[11.5px] text-[#4a4f5c] hover:bg-soft" disabled={agent.state === "off"} onClick={() => void send({ key: k })}>
            {label}
          </button>
        ))}
      </div>
      {err && <p className="mt-1 text-[12px] text-bad">{err}</p>}
    </div>
  );
}

/** Terminal card with tabs (Claude Code / Shell), full screen and the phone key bar. */
/** A setup fix running in a terminal (Settings → Setup). It runs once; Run again starts it fresh. */
export function FixTerminal({ fixId, onDone }: { fixId: string; onDone?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [round, setRound] = useState(0);
  return (
    <div>
      <div className="relative h-[220px] overflow-hidden rounded-[10px] border border-line bg-[#fbfaf7]">
        <div className="absolute inset-0 py-1.5 pl-2">
          <XtermView key={`${fixId}-${round}`} id={fixId} name="fix" kind="fix" onLink={() => {}} onPhase={(p) => (setPhase(p), p.kind === "ended" && onDone?.())} />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
        <span>{phase.kind === "connecting" ? "Starting…" : phase.kind === "live" ? "Running. Type here if it asks you something." : ("text" in phase ? phase.text : "")}</span>
        {phase.kind !== "live" && phase.kind !== "connecting" && (
          <button className="ml-auto text-accent" onClick={() => setRound((r) => r + 1)}>
            Run again
          </button>
        )}
      </div>
    </div>
  );
}

export function TerminalCard({ agent, wide, onWide }: { agent: Agent; wide?: boolean; onWide?: (w: boolean) => void }) {
  const [kind, setKind] = useState<TermKind>("agent");
  const [full, setFull] = useState(false);
  const [live, setLive] = useState<{ available: boolean; reason: string } | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [round, setRound] = useState(0); // bump to reconnect
  const link = useRef<TermLink | null>(null);
  const off = agent.state === "off";

  useEffect(() => {
    support ??= terminalSupport();
    let ok = true;
    void support.then((s) => ok && setLive(s));
    return () => {
      ok = false;
    };
  }, []);

  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && e.target === document.body && setFull(false);
    addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [full]);

  const showAgentOff = kind === "agent" && off;
  const tab = (k: TermKind, label: string) => (
    <button
      role="tab"
      aria-selected={kind === k}
      className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${kind === k ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
      onClick={() => setKind(k)}
    >
      {label}
    </button>
  );
  const press = (bytes: string) => link.current?.keys(bytes);

  return (
    <div className={full ? "fixed inset-0 z-50 flex h-[100dvh] flex-col bg-bg p-2 sm:p-4" : ""}>
      <div className="mb-1.5 flex items-center gap-2">
        {full ? <div className="text-[13px] font-semibold">{agentTitle(agent)}</div> : <div className="lbl !mb-0">Terminal</div>}
        <div role="tablist" className="flex gap-0.5 rounded-lg bg-soft p-0.5">
          {tab("agent", "Claude Code")}
          {tab("shell", "Shell")}
        </div>
        {kind === "shell" && live?.available && (
          <button className="text-[12px] text-accent" title="End this shell and start a fresh one" onClick={() => (link.current ? link.current.renew() : setRound((r) => r + 1))}>
            New shell
          </button>
        )}
        {onWide && !full && (
          <button className="ml-auto hidden text-[12px] text-accent lg:inline" title="Make the side panel wider or narrower" onClick={() => onWide(!wide)}>
            {wide ? "Narrower" : "Wider"}
          </button>
        )}
        <button className={`${onWide && !full ? "lg:ml-0" : ""} ml-auto text-[12px] text-accent`} onClick={() => setFull(!full)}>
          {full ? "Close" : "Full screen"}
        </button>
      </div>

      {live && !live.available && kind === "agent" ? (
        <SnapshotScreen agent={agent} full={full} note={`Live terminal is off on this server (${live.reason}). Showing a snapshot every second.`} />
      ) : live && !live.available ? (
        <p className="rounded-[9px] border border-line bg-white p-3 text-[12.5px] text-muted">The shell needs live terminals, which are off on this server ({live.reason}).</p>
      ) : (
        <>
          <div className={`relative overflow-hidden rounded-[10px] border border-line bg-[#fbfaf7] ${full ? "min-h-0 flex-1" : "h-[300px]"}`}>
            {live && !showAgentOff && (
              <div className="absolute inset-0 py-1.5 pl-2">
                <XtermView key={`${kind}-${agent.id}-${round}`} id={agent.id} name={agent.name} kind={kind} onLink={(l) => (link.current = l)} onPhase={setPhase} />
              </div>
            )}
            {(showAgentOff || phase.kind !== "live") && (
              <div className={`absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2 text-[12px] ${showAgentOff || phase.kind === "connecting" ? "" : "border-t border-line bg-white/95"}`}>
                <span className="text-muted">
                  {showAgentOff ? `${agent.name} is not running. Press Start.` : "text" in phase ? phase.text : "Connecting…"}
                </span>
                {!showAgentOff && (phase.kind === "error" || phase.kind === "ended") && (
                  <button className="ml-auto text-accent" onClick={() => setRound((r) => r + 1)}>
                    {kind === "shell" ? "New shell" : "Reconnect"}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {KEY_BAR.map((b) => (
              <button
                key={b.label}
                title={b.title}
                className="rounded-md border border-line bg-white px-2.5 py-1 font-mono text-[11.5px] text-[#4a4f5c] hover:bg-soft active:bg-accent-soft disabled:opacity-40"
                disabled={showAgentOff || phase.kind !== "live"}
                // Keep focus (and the phone keyboard) on the terminal.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => press(b.bytes)}
              >
                {b.label}
              </button>
            ))}
            <span className="ml-auto hidden text-[11px] text-muted sm:inline">
              {kind === "agent" ? "Scroll up for history (Esc returns) · Shift+drag selects" : "Shift+Enter: new line · Ctrl+C copies a selection"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
