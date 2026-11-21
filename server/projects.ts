// Adding projects and team members.

import { randomBytes, randomUUID } from "node:crypto";
import type { Agent, Project } from "../shared/types.ts";
import { now } from "./db.ts";
import type { Store } from "./store.ts";
import { DEFAULT_WORKERS, LEAD_SIGN, SIGNS, signOf } from "./team.ts";
import { run } from "./tmux.ts";

/** "Kanav-Chauhan/workforce-sandbox" → "workforce-sandbox"; also accepts a GitHub URL. */
export function parseRepo(input: string): string {
  const m = input.trim().replace(/\.git$/, "").match(/(?:github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);
  if (!m) throw new Error('Use the GitHub repo as "owner/name"');
  return `${m[1]}/${m[2]}`;
}

/** Task id prefix from the repo name: "workforce-sandbox" → "WS", "atlas" → "ATL". */
export function prefixFor(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const p = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "T").slice(0, 3);
  return p.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "T";
}

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";

export class Projects {
  constructor(private store: Store) {}

  private get db() {
    return this.store.db;
  }

  /** Looks the repo up on GitHub (with the machine's gh login) and adds it with the default team. */
  async add(repoInput: string): Promise<Project> {
    const repo = parseRepo(repoInput);
    if (this.db.projects().some((p) => p.repo.toLowerCase() === repo.toLowerCase())) throw new Error(`${repo} is already a project`);
    const r = await run("gh", ["repo", "view", repo, "--json", "name,nameWithOwner,defaultBranchRef"], { timeoutMs: 30_000 });
    if (!r.ok) throw new Error(`GitHub can't find ${repo} (or this machine's gh login can't see it)`);
    const info = JSON.parse(r.stdout) as { name: string; nameWithOwner: string; defaultBranchRef?: { name?: string } };
    let id = slug(info.name);
    for (let i = 2; this.db.project(id); i++) id = `${slug(info.name)}-${i}`;
    const project: Project = {
      id, repo: info.nameWithOwner, name: info.name, prefix: prefixFor(info.name),
      defaultBranch: info.defaultBranchRef?.name || "main", permissionStyle: "careful", createdAt: now(),
    };
    this.db.addProject(project);
    this.store.emit({ type: "project", project });
    for (const sign of [LEAD_SIGN, ...DEFAULT_WORKERS]) this.addAgent(project.id, sign);
    this.store.activity(project.id, null, `Project ${project.repo} added`);
    return project;
  }

  /** Adds a team member by zodiac sign (the lead is always Leo). */
  addAgent(projectId: string, sign?: string): Agent {
    const taken = new Set(this.db.agents(projectId).map((a) => a.sign));
    const pick = sign ?? SIGNS.find((s) => !taken.has(s.sign))?.sign;
    const s = pick ? signOf(pick) : undefined;
    if (!s) throw new Error("No free zodiac sign left");
    if (taken.has(s.sign)) throw new Error(`${s.name} is already on the team`);
    const agent: Agent = {
      id: `${projectId}.${s.sign}`, projectId, sign: s.sign, name: s.name, isLead: s.sign === LEAD_SIGN,
      extraRole: "", model: "", sessionId: randomUUID(), state: "off", note: "Not started", taskId: null, stateSince: now(),
    };
    this.db.addAgent(agent, randomBytes(24).toString("hex"));
    this.store.emit({ type: "agent", agent });
    return agent;
  }
}
