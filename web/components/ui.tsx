"use client";

import type { Agent, AgentState, TaskStatus } from "../../shared/types";
import { lookOf } from "../lib/office/looks";
import { signOf } from "../../shared/signs";

export const signSymbol = (sign: string) => signOf(sign)?.symbol ?? "";

export const STATE: Record<AgentState, { color: string; label: string }> = {
  off: { color: "#cfd2d8", label: "Off" },
  ready: { color: "#8fb0ff", label: "Ready" },
  working: { color: "#2fae7a", label: "Working" },
  "needs-you": { color: "#e8a23a", label: "Waiting for you" },
  blocked: { color: "#e5534b", label: "Blocked" },
};

export const TASK_STATUS: Record<TaskStatus, string> = { todo: "To do", working: "Working", review: "Review", blocked: "Blocked", done: "Done" };

export function Dot({ color, className = "" }: { color: string; className?: string }) {
  return <b className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${className}`} style={{ background: color }} />;
}

export function StatePill({ state }: { state: AgentState }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Dot color={STATE[state].color} />
      {STATE[state].label}
    </span>
  );
}

export function Avatar({ agent, size = 36 }: { agent: Pick<Agent, "sign" | "name">; size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center rounded-xl font-bold text-white" style={{ width: size, height: size, background: lookOf(agent.sign).shirt, fontSize: size * 0.42 }}>
      {agent.name[0]}
    </div>
  );
}

export const agentTitle = (a: Pick<Agent, "name" | "sign">) => `${a.name} ${signSymbol(a.sign)}`;

export function clock(at: string) {
  const d = new Date(at);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ago(at: string) {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function Brand() {
  return (
    <a href="./" className="flex items-center gap-2 whitespace-nowrap font-[650] tracking-[-0.01em] text-ink no-underline">
      <i className="block h-[22px] w-[22px] rounded-[7px] bg-[linear-gradient(135deg,#6d84ff,#4f6bed)] shadow-[0_2px_6px_rgba(79,107,237,.35)]" />
      <span className="max-[420px]:hidden">Workforce</span>
    </a>
  );
}
