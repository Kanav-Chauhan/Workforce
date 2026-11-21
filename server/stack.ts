// The stack picker: installs the vendors' official agent skills for the ticked tools into each
// agent's own folder, as a small local plugin Claude Code loads with --plugin-dir
// (<folder>/.claude/workforce-stack, listed in .git/info/exclude so the repo stays clean).
// Repo-level .claude/skills would not load: agents start with --setting-sources local.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stackPlan, STACK } from "../shared/stacks.ts";
import type { Agent, Project } from "../shared/types.ts";
import { agentFolder, ensureDir, skillCacheDir, stackPluginDir } from "./paths.ts";
import { run } from "./tmux.ts";

export const PLUGIN_NAME = "workforce-stack";
const EXCLUDE_LINE = "/.claude/workforce-stack/";
const REFRESH_MS = 24 * 3600_000;

export interface StackReport {
  at: string;
  skills: { name: string; repo: string; tools: string[] }[];
  domains: string[];
  agents: { agentId: string; name: string; skills: number; note: string }[];
  problems: string[];
}

/** Adds a line to a .git/info/exclude text once. */
export function withExclude(text: string, line = EXCLUDE_LINE): string {
  const lines = text.split("\n");
  if (lines.some((l) => l.trim() === line)) return text;
  return (text && !text.endsWith("\n") ? text + "\n" : text) + line + "\n";
}

const cacheOf = (repo: string) => join(skillCacheDir(), repo.replace("/", "__"));

/** A shallow clone of the vendor's skills repo, refreshed once a day. */
export async function ensureSkillRepo(repo: string): Promise<string> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error(`Bad repo ${repo}`);
  const dir = cacheOf(repo);
  if (existsSync(join(dir, ".git"))) {
    if (Date.now() - statSync(join(dir, ".git")).mtimeMs > REFRESH_MS) {
      await run("git", ["-C", dir, "pull", "--ff-only", "--quiet"], { timeoutMs: 120_000 });
      await run("touch", [join(dir, ".git")]);
    }
    return dir;
  }
  ensureDir(skillCacheDir());
  rmSync(dir, { recursive: true, force: true });
  const r = await run("git", ["clone", "--depth", "1", "--quiet", `https://github.com/${repo}.git`, dir], { timeoutMs: 300_000 });
  if (!r.ok) throw new Error(`Couldn't download skills from ${repo}: ${r.stderr.trim().split("\n").pop()}`);
  return dir;
}

/** Puts the project's stack skills in the agent's folder (replacing old ones). Returns the skill names. */
export function installStackFor(agent: Agent, project: Project): { installed: string[]; missing: string[] } {
  const folder = agentFolder(agent);
  if (!existsSync(folder)) return { installed: [], missing: [] };
  const plan = stackPlan(project.stack);
  const dir = stackPluginDir(agent);
  rmSync(dir, { recursive: true, force: true });
  if (!plan.skills.length) return { installed: [], missing: [] };
  const installed: string[] = [];
  const missing: string[] = [];
  for (const s of plan.skills) {
    const from = join(cacheOf(s.repo), s.path);
    if (!existsSync(join(from, "SKILL.md"))) {
      missing.push(s.name);
      continue;
    }
    cpSync(from, join(dir, "skills", s.name), { recursive: true });
    installed.push(s.name);
  }
  if (!installed.length) {
    rmSync(dir, { recursive: true, force: true });
    return { installed, missing };
  }
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: PLUGIN_NAME, version: "1.0.0", description: "Official agent skills for this project's stack, installed by Workforce." }, null, 2) + "\n",
  );
  const exclude = join(folder, ".git", "info", "exclude");
  if (existsSync(join(folder, ".git"))) {
    mkdirSync(join(folder, ".git", "info"), { recursive: true });
    const before = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    const after = withExclude(before);
    if (after !== before) writeFileSync(exclude, after);
  }
  return { installed, missing };
}

/** The plugin dir to pass to Claude Code, if the agent has stack skills. */
export function stackPluginFor(agent: Agent): string | null {
  const dir = stackPluginDir(agent);
  return existsSync(join(dir, "skills")) && readdirSync(join(dir, "skills")).length ? dir : null;
}

/** Downloads what the stack needs, installs it for every agent and says what happened. */
export async function applyStack(project: Project, team: Agent[]): Promise<StackReport> {
  const plan = stackPlan(project.stack);
  const problems: string[] = [];
  for (const repo of new Set(plan.skills.map((s) => s.repo)))
    await ensureSkillRepo(repo).catch((err: Error) => problems.push(err.message));
  const agents = team.map((a) => {
    if (!existsSync(agentFolder(a))) return { agentId: a.id, name: a.name, skills: 0, note: "Installs when it first starts" };
    try {
      const r = installStackFor(a, project);
      return { agentId: a.id, name: a.name, skills: r.installed.length, note: r.missing.length ? `Missing: ${r.missing.join(", ")}` : "Restart to load" };
    } catch (err) {
      return { agentId: a.id, name: a.name, skills: 0, note: `Failed: ${(err as Error).message}` };
    }
  });
  const skills = plan.skills.map((s) => ({
    name: s.name,
    repo: s.repo,
    tools: STACK.filter((t) => project.stack.includes(t.id) && t.skills?.paths.includes(s.path)).map((t) => t.label),
  }));
  return { at: new Date().toISOString(), skills, domains: plan.domains, agents, problems };
}
