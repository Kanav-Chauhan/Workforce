// Adding projects and team members.

import { randomBytes, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { DEFAULT_BOARD } from "../shared/boards.ts";
import { DEFAULT_WORKFLOW, type Agent, type PermissionStyle, type Project } from "../shared/types.ts";
import { home } from "./paths.ts";
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

export interface NewProject {
  /** Workers besides the lead (1–3). */
  workers?: number;
  permissionStyle?: PermissionStyle;
}

export interface CustomAgent {
  name: string;
  role: string;
  color?: string;
  model?: string;
  folder?: string;
}

/** The models the dashboard offers ("" = Claude Code's default). */
export const MODELS = ["", "opus", "sonnet", "haiku"];

/** Checks an existing folder the owner wants a custom agent to work in. */
export function checkFolder(input: string): string {
  const raw = input.trim().replace(/^~(?=\/|$)/, homedir());
  if (!isAbsolute(raw)) throw new Error("Give the folder as a full path, like /home/you/code/app");
  const dir = resolve(raw);
  const banned = [homedir(), resolve(homedir(), "deploy"), resolve(homedir(), ".ssh"), resolve(homedir(), ".claude"), home(), "/"];
  if (banned.includes(dir) || banned.slice(1, 4).some((b) => dir.startsWith(b + "/")) || dir.startsWith(home() + "/"))
    throw new Error("Pick a project folder, not a system or Workforce folder");
  let ok = false;
  try {
    ok = statSync(dir).isDirectory();
  } catch {
    /* missing */
  }
  if (!ok) throw new Error(`${dir} isn't a folder on this machine`);
  return dir;
}

export class Projects {
  constructor(private store: Store) {}

  private get db() {
    return this.store.db;
  }

  /** Looks the repo up on GitHub (with the machine's gh login) and adds it with the default team. */
  async add(repoInput: string, opts: NewProject = {}): Promise<Project> {
    const repo = parseRepo(repoInput);
    if (this.db.projects().some((p) => p.repo.toLowerCase() === repo.toLowerCase())) throw new Error(`${repo} is already a project`);
    const r = await run("gh", ["repo", "view", repo, "--json", "name,nameWithOwner,defaultBranchRef"], { timeoutMs: 30_000 });
    if (!r.ok) throw new Error(`GitHub can't find ${repo} (or this machine's gh login can't see it)`);
    const info = JSON.parse(r.stdout) as { name: string; nameWithOwner: string; defaultBranchRef?: { name?: string } };
    let id = slug(info.name);
    for (let i = 2; this.db.project(id); i++) id = `${slug(info.name)}-${i}`;
    const project: Project = {
      id, repo: info.nameWithOwner, name: info.name, prefix: prefixFor(info.name),
      defaultBranch: info.defaultBranchRef?.name || "main", permissionStyle: opts.permissionStyle === "trusted" ? "trusted" : "careful", createdAt: now(),
      stack: [], boards: [DEFAULT_BOARD], planExport: false, workflow: { ...DEFAULT_WORKFLOW },
    };
    this.db.addProject(project);
    this.store.emit({ type: "project", project });
    const workers = Math.max(1, Math.min(3, Math.round(opts.workers ?? DEFAULT_WORKERS.length)));
    const picks = [...DEFAULT_WORKERS, ...SIGNS.map((x) => x.sign).filter((x) => x !== LEAD_SIGN && !DEFAULT_WORKERS.includes(x))].slice(0, workers);
    for (const sign of [LEAD_SIGN, ...picks]) this.addAgent(project.id, sign);
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
      extraRole: "", model: "", role: "", color: "", folder: "", sessionId: randomUUID(), state: "off", note: "Not started", taskId: null, stateSince: now(),
    };
    this.db.addAgent(agent, randomBytes(24).toString("hex"));
    this.store.emit({ type: "agent", agent });
    return agent;
  }

  /** Adds an agent with the owner's own name and role ("QA", "Designer"); always a worker. */
  addCustom(projectId: string, input: CustomAgent): Agent {
    if (!this.db.project(projectId)) throw new Error("No such project");
    const name = input.name.replace(/\s+/g, " ").trim().slice(0, 24);
    const role = input.role.replace(/\s+/g, " ").trim().slice(0, 30);
    if (!name) throw new Error("Give the agent a name");
    if (!role) throw new Error("Give the agent a role, like QA or Designer");
    const color = (input.color ?? "").trim();
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Pick a colour");
    const model = (input.model ?? "").trim();
    if (!MODELS.includes(model)) throw new Error("Unknown model");
    const team = this.db.agents(projectId);
    if (team.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already on the team`);
    const folder = input.folder?.trim() ? checkFolder(input.folder) : "";
    // The id must not clash with a zodiac sign (which may join later) or a teammate.
    let id = `x-${slug(name)}`.slice(0, 30);
    for (let i = 2; team.some((a) => a.sign === id); i++) id = `x-${slug(name)}-${i}`.slice(0, 30);
    const agent: Agent = {
      id: `${projectId}.${id}`, projectId, sign: id, name, isLead: false, extraRole: "", model, role, color, folder,
      sessionId: randomUUID(), state: "off", note: "Not started", taskId: null, stateSince: now(),
    };
    this.db.addAgent(agent, randomBytes(24).toString("hex"));
    this.store.emit({ type: "agent", agent });
    this.store.activity(projectId, null, `${name} (${role}) joined the team`);
    return agent;
  }
}
