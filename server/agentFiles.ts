// The three private files each agent gets, kept OUTSIDE its repo clone and passed to Claude Code
// on the command line: role.md (--append-system-prompt-file), settings.json (--settings) and
// mcp.json (--mcp-config). Nothing is written into the clone, so nothing can be committed by mistake.

import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Agent, PermissionStyle, Project } from "../shared/types.ts";
import { agentDir, agentPrivateDir, ensureDir, home, localUrl, projectDir } from "./paths.ts";
import { signOf } from "./team.ts";

export const MCP_NAME = "workforce";

/** Hook events Workforce listens to. */
export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "PermissionRequest", "Stop", "SessionEnd"] as const;

/** How long a permission prompt waits for the owner in the dashboard before falling back to the terminal. */
export const PERMISSION_WAIT_S = 600;

// ------------------------------------------------------------------ role

export function roleText(agent: Agent, project: Project, team: Agent[]): string {
  const me = signOf(agent.sign);
  const members = team
    .map((a) => {
      const s = signOf(a.sign);
      return `- ${a.name}${s ? ` (${s.western} ${s.symbol})` : ""}: ${a.isLead ? "lead" : "developer"}${a.id === agent.id ? " ← you" : ""}`;
    })
    .join("\n");

  const lead = [
    "You are the **lead**. You plan the work and hand it out. You never write app code yourself.",
    "When the owner asks for something, read the repo first, then split the work into small tasks: one task = one branch = one pull request.",
    "Create each task with `create_task`: a clear title, the details, the exact files or folders it may edit, a 'done when' the owner can check, and which tasks it depends on.",
    "Two tasks that can run at the same time must never share a file.",
    "Give tasks with `assign` only to developers who are free (check `team`). A developer whose PR is in review can take the next task.",
    "When a task goes to review, tell the owner which PRs are ready and the order to merge them in. You never merge.",
    "If the request is unclear or a decision belongs to the owner, ask with `ask_owner` before planning.",
  ];
  const worker = [
    "You are a **developer**. You build the tasks the lead gives you.",
    "When you are told to start a task: call `my_task`, then `git fetch origin` and create a branch from the latest main: `git switch -c <task-id-lowercase> origin/" + project.defaultBranch + "`.",
    "Edit only the files your task lists. If you need another file, ask the lead with `message`.",
    "Run the project's checks (tests, lint, typecheck) if it has them. Commit with clear messages.",
    "Push your branch and open the PR with `gh pr create`. The PR title MUST start with the task id in brackets, e.g. `[" + project.prefix + "-3] Add footer`.",
    "Then call `report` with status `review` and the PR number. The lead is told automatically; don't also message them the same news.",
    "If you are stuck, call `report` with status `blocked` and say why.",
    "When review comments arrive, fix them on the same branch, push, and reply on each thread.",
    "Never merge a PR, never push to " + project.defaultBranch + ", never force-push.",
  ];
  const everyone = [
    "Messages that start with `[Workforce]` come from the system or a teammate. Act on them.",
    "Teammates work in their own folders and can't see your files or terminal. Talk to them only with `message`.",
    "If you need the owner to do something (create an account, add a key, change a dashboard setting, make a decision), call `ask_owner` with short, clear steps, then keep working on what you can. Never write secret values anywhere; name the variable instead.",
    "Stay inside your own folder. Never touch other folders on this machine, never use docker or sudo.",
    "Keep messages and reports short and plain.",
  ];

  return [
    `# You are ${agent.name}${me ? ` (${me.western} ${me.symbol})` : ""}`,
    "",
    `You work in **Workforce**, a small team of Claude Code agents building the GitHub project **${project.repo}** for its owner.`,
    "",
    "## Your personality",
    me?.personality ?? "",
    "Your personality shapes your tone and focus only. The rules below always come first.",
    "",
    "## Team",
    members,
    "",
    "## Your job",
    ...(agent.isLead ? lead : worker).map((r) => `- ${r}`),
    "",
    "## Rules for everyone",
    ...everyone.map((r) => `- ${r}`),
    "",
    "## Team tools (MCP server `" + MCP_NAME + "`)",
    agent.isLead
      ? "`team`, `tasks`, `create_task`, `edit_task`, `assign`, `message`, `ask_owner`"
      : "`team`, `tasks`, `my_task`, `report`, `message`, `ask_owner`",
    ...(agent.extraRole.trim() ? ["", "## Extra notes from the owner", agent.extraRole.trim()] : []),
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ settings (hooks + permissions)

function hookCommand(event: string, token: string): string {
  const url = `${localUrl()}/hook/${event}`;
  const base = `curl -s -X POST -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' --data-binary @- '${url}'`;
  // Stop and PermissionRequest print the server's reply; Claude Code acts on it.
  if (event === "PermissionRequest") return `${base} -m ${PERMISSION_WAIT_S - 10} 2>/dev/null || true`;
  if (event === "Stop") return `${base} -m 5 2>/dev/null || true`;
  return `${base} -m 4 >/dev/null 2>&1 || true`;
}

/** Commands an agent may run without asking, in Careful mode. */
const SAFE_COMMANDS = [
  "git status", "git diff", "git log", "git show", "git branch", "git fetch", "git switch", "git checkout -b", "git add", "git commit",
  "git pull", "git push", "git rev-parse", "git remote -v", "ls", "pwd", "gh pr create", "gh pr view", "gh pr list", "gh pr checks", "gh pr comment",
  "npm test", "npm run test", "npm run lint", "npm run typecheck", "npm run build", "pnpm test", "pnpm lint", "pnpm typecheck", "npx tsc --noEmit",
];

/** Absolute path as a permission rule path ("//abs/path"). */
const abs = (p: string) => `/${p}`;

export function permissions(style: PermissionStyle, project: Project, agent: Agent, team: Agent[]) {
  // Workforce's private files: the database, every agent's role/settings/tokens, and teammates' clones.
  const privatePaths = [
    `${home()}/workforce.db*`,
    `${projectDir(project.id)}/.agents/**`,
    ...team.filter((a) => a.id !== agent.id).map((a) => `${agentDir(project.id, a.sign)}/**`),
  ];
  const deny = [
    // Never: secrets, other apps' config, Workforce's private files, Docker, root.
    "Read(~/deploy/**)", "Edit(~/deploy/**)", "Read(~/.ssh/**)", "Edit(~/.ssh/**)",
    ...privatePaths.flatMap((p) => [`Read(${abs(p)})`, `Edit(${abs(p)})`]),
    "Bash(docker:*)", "Bash(sudo:*)", "Bash(su:*)",
    // Never merge, never push to the main branch, never rewrite history.
    "Bash(gh pr merge:*)", "Bash(gh repo delete:*)", "Bash(git push --force:*)", "Bash(git push -f:*)",
    `Bash(git push origin ${project.defaultBranch}:*)`, `Bash(git push -u origin ${project.defaultBranch}:*)`, `Bash(git push origin HEAD:${project.defaultBranch}:*)`,
  ];
  const allow = [`mcp__${MCP_NAME}`, ...(style === "trusted" ? ["Bash"] : SAFE_COMMANDS.map((c) => `Bash(${c}:*)`))];
  return { defaultMode: "acceptEdits", allow, deny };
}

export function settingsJson(agent: Agent, project: Project, team: Agent[], token: string) {
  const hooks: Record<string, unknown[]> = {};
  for (const event of HOOK_EVENTS) {
    const entry = { type: "command", command: hookCommand(event, token), timeout: event === "PermissionRequest" ? PERMISSION_WAIT_S : 10 };
    hooks[event] = [event === "PreToolUse" || event === "PostToolUse" || event === "PermissionRequest" ? { matcher: "*", hooks: [entry] } : { hooks: [entry] }];
  }
  return { hooks, permissions: permissions(project.permissionStyle, project, agent, team) };
}

export function mcpJson(token: string) {
  return { mcpServers: { [MCP_NAME]: { type: "http", url: `${localUrl()}/mcp`, headers: { Authorization: `Bearer ${token}` } } } };
}

export interface AgentFiles {
  role: string;
  settings: string;
  mcp: string;
}

/** Writes the three files (owner-only permissions) and returns their paths. */
export function writeAgentFiles(agent: Agent, project: Project, team: Agent[], token: string): AgentFiles {
  const dir = ensureDir(agentPrivateDir(project.id, agent.sign));
  const files = { role: join(dir, "role.md"), settings: join(dir, "settings.json"), mcp: join(dir, "mcp.json") };
  writeFileSync(files.role, roleText(agent, project, team), { mode: 0o600 });
  writeFileSync(files.settings, JSON.stringify(settingsJson(agent, project, team, token), null, 2) + "\n", { mode: 0o600 });
  writeFileSync(files.mcp, JSON.stringify(mcpJson(token), null, 2) + "\n", { mode: 0o600 });
  return files;
}

/** Claude Code stores a conversation at ~/.claude/projects/<folder with / replaced by ->/<session>.jsonl. */
export function transcriptFile(cwd: string, sessionId: string) {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
}
