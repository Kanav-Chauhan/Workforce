// Plan export: when a project turns it on, the plan is written to docs/plan.md in the LEAD's folder
// after every task change. Workforce never commits it; the owner decides what to do with the file.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { boardOf, boardsOf } from "../shared/boards.ts";
import type { Agent, Project, Task, TaskStatus } from "../shared/types.ts";
import { agentFolder } from "./paths.ts";
import type { Store } from "./store.ts";

const ORDER: TaskStatus[] = ["working", "blocked", "review", "todo", "done"];
const WORDS: Record<TaskStatus, string> = { working: "Working", blocked: "Blocked", review: "In review", todo: "To do", done: "Done" };

export function planMarkdown(project: Project, tasks: Task[], team: Agent[]): string {
  const boards = boardsOf(project, tasks);
  const who = (id: string | null) => team.find((a) => a.id === id)?.name;
  const out = [`# Plan: ${project.name}`, "", `Written by Workforce from the dashboard's plan (${project.repo}). Edits here are overwritten.`, ""];
  for (const board of boards) {
    const mine = tasks.filter((t) => boardOf(t, boards) === board);
    out.push(`## ${board}`, "");
    if (!mine.length) out.push("No tasks yet.", "");
    for (const status of ORDER) {
      const list = mine.filter((t) => t.status === status);
      if (!list.length) continue;
      out.push(`### ${WORDS[status]}`, "");
      for (const t of list) {
        const bits = [who(t.ownerId), t.prNumber ? `PR #${t.prNumber}` : "", t.dependsOn.length ? `after ${t.dependsOn.join(", ")}` : ""].filter(Boolean);
        out.push(`- [${t.status === "done" ? "x" : " "}] **${t.id}** ${t.title}${bits.length ? ` (${bits.join(", ")})` : ""}`);
        if (t.doneWhen) out.push(`  - Done when: ${t.doneWhen.replace(/\n+/g, " ")}`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}

export const planFile = (lead: Agent) => join(agentFolder(lead), "docs", "plan.md");

/** Rewrites docs/plan.md a moment after tasks change, for projects that turned it on. */
export class PlanExport {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private store: Store, private delayMs = 1500) {
    store.on((e) => {
      if (e.type === "task") this.soon(e.task.projectId);
      if (e.type === "project" && e.project.planExport) this.soon(e.project.id);
    });
  }

  soon(projectId: string) {
    clearTimeout(this.timers.get(projectId));
    this.timers.set(projectId, setTimeout(() => this.write(projectId), this.delayMs));
  }

  /** Writes the file now; returns its path, or null if off or the lead has no folder yet. */
  write(projectId: string): string | null {
    this.timers.delete(projectId);
    const db = this.store.db;
    const project = db.project(projectId);
    const team = db.agents(projectId);
    const lead = team.find((a) => a.isLead);
    if (!project?.planExport || !lead) return null;
    // Never create the lead's folder here: that would stop its clone from being made.
    if (!existsSync(join(agentFolder(lead), ".git"))) return null;
    const file = planFile(lead);
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, planMarkdown(project, db.tasks(projectId), team));
      return file;
    } catch {
      return null;
    }
  }
}
