// The three private files each agent gets, kept OUTSIDE its repo clone and passed to Claude Code
// on the command line: role.md (--append-system-prompt-file), settings.json (--settings) and
// mcp.json (--mcp-config). Nothing is written into the clone, so nothing can be committed by mistake.

import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stackPlan } from "../shared/stacks.ts";
import { DEFAULT_WORKFLOW, type Agent, type McpServer, type PermissionStyle, type Project, type Reviewer, type Workflow } from "../shared/types.ts";
import { agentFolder, agentPrivateDir, ensureDir, home, localUrl, projectDir } from "./paths.ts";
import { signOf } from "./team.ts";

export const MCP_NAME = "workforce";

/** Hook events Workforce listens to. */
export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "PermissionRequest", "Stop", "SessionEnd"] as const;

/** How long a permission prompt waits for the owner in the dashboard before falling back to the terminal. */
export const PERMISSION_WAIT_S = 600;

// ------------------------------------------------------------------ role

/** What the agent is told about its extras: env variable NAMES (never values) and the owner's MCP servers. */
export interface Extras {
  envNames: string[];
  mcp: McpServer[];
}
const NO_EXTRAS: Extras = { envNames: [], mcp: [] };

/** A custom agent's sign is its own id, not a zodiac sign. */
const roleOf = (a: Agent) => a.role || (a.isLead ? "lead" : "developer");

/** What each reviewer choice means for a developer. */
const REVIEW_RULE: Record<Reviewer, (wf: Workflow) => string> = {
  none: () => "There is no reviewer: once checks pass, your PR waits for the owner to merge.",
  owner: () => "The owner reviews your PR on GitHub. Their comments reach you as messages from Workforce.",
  coderabbit: () => "CodeRabbit reviews every PR. Wait for its review (Workforce sends you its comments) and address every actionable one; explain in a reply if you disagree.",
  greptile: () => "Greptile reviews every PR. Wait for its review (Workforce sends you its comments) and address every actionable one; explain in a reply if you disagree.",
  copilot: () => "GitHub Copilot reviews every PR. Wait for its review (Workforce sends you its comments) and address every actionable one; explain in a reply if you disagree.",
  custom: (wf) => "After each push Workforce runs `" + wf.reviewCommand + "` in your folder and sends you its output. Fix what it reports.",
};

export function roleText(agent: Agent, project: Project, team: Agent[], extras: Extras = NO_EXTRAS): string {
  const wf = project.workflow ?? DEFAULT_WORKFLOW;
  const deploy = !!wf.deployCommand.trim() && wf.deployAgents.includes(agent.id);
  const me = signOf(agent.sign);
  const personality = me?.personality ?? (agent.role ? `You are the team's ${agent.role}. Focus on what a good ${agent.role} cares about.` : "");
  const members = team
    .map((a) => {
      const s = signOf(a.sign);
      return `- ${a.name}${s ? ` ${s.symbol}` : ""}: ${roleOf(a)}${a.id === agent.id ? " ← you" : ""}`;
    })
    .join("\n");

  const lead = [
    "You are the **lead**. You plan the work and hand it out. You never write app code yourself.",
    "When the owner asks for something, read the repo first, then split the work into small tasks: one task = one branch = one pull request.",
    "Create each task with `create_task`: a clear title, the details, the exact files or folders it may edit, a 'done when' the owner can check, and which tasks it depends on.",
    "Two tasks that can run at the same time must never share a file.",
    "Tasks sit on plan boards (see `tasks`). When the owner names a board or a stage (\"v1\", \"Polish\"), pass it as `board` in `create_task`.",
    "Give tasks with `assign` only to developers who are free (check `team`). A developer whose PR is in review can take the next task.",
    "Put any extra instructions for a task in `assign`'s note. Don't send them as a separate message first: the developer would start before the task is theirs.",
    "Workforce watches GitHub for you: a PR titled `[ID] …` is linked to its task (task → Review), review comments and failed checks go straight to the PR's author (task → Working until they push), a merged PR makes the task Done and you are told, a PR closed without merging puts the task back in To do and you are told.",
    ...(wf.mergeBy === "lead"
      ? ["The owner lets you merge: when Workforce tells you a PR is ready (checks pass, review done), you may merge it with `merge_pr`, in a sensible order. Never merge with gh or git, and never merge a PR Workforce hasn't called ready."]
      : ["When PRs are ready, tell the owner the order to merge them in. The owner merges; you never merge."]),
    "If the request is unclear or a decision belongs to the owner, ask with `ask_owner` before planning.",
  ];
  const worker = [
    "You are a **developer**. You build the tasks the lead gives you.",
    "When you are told to start a task: call `my_task`, then `git fetch origin` and create a branch from the latest main: `git switch -c <task-id-lowercase> origin/" + project.defaultBranch + "`.",
    "Edit only the files your task lists. If you need another file, ask the lead with `message`.",
    "Run the project's checks (tests, lint, typecheck) if it has them. Commit with clear messages.",
    ...(deploy ? ["Before you open the PR, run the deploy step `" + wf.deployCommand + "` in your folder. If it fails, fix it first. Pass its result in `report`'s `deploy` field ('passed', or 'failed: why')."] : []),
    "Push your branch and open the PR with `gh pr create`. The PR title MUST be `[TASK-ID] title`, e.g. `[" + project.prefix + "-3] Add footer`. That is how Workforce links the PR to your task.",
    "Then call `report` with status `review` and the PR number. The lead is told automatically; don't also message them the same news.",
    "If you are stuck, call `report` with status `blocked` and say why.",
    REVIEW_RULE[wf.reviewer](wf),
    "When Workforce sends you review feedback, fix it on the SAME branch, commit and push (no new PR, never force-push), reply on each comment thread, then call `report` with status `review` and the PR number again.",
    "Start every comment or reply you write on GitHub with your name in brackets, e.g. `[" + agent.name + "] Fixed: …`. Workforce uses this to tell your comments apart from the reviewer's.",
    "Never merge a PR (the owner merges), never push to " + project.defaultBranch + ", never force-push.",
  ];
  const everyone = [
    "Messages that start with `[Workforce]` come from the system or a teammate. Act on them.",
    "Teammates work in their own folders and can't see your files or terminal. Talk to them only with `message`.",
    "If you need the owner to do something (create an account, add a key, change a dashboard setting, make a decision), call `ask_owner` with short, clear steps, then keep working on what you can. Never write secret values anywhere; name the variable instead.",
    "Stay inside your own folder. Never touch other folders on this machine, never use docker or sudo.",
    "Keep messages and reports short and plain.",
  ];

  return [
    `# You are ${agent.name}${me ? ` ${me.symbol}` : ""}`,
    "",
    `You work in **Workforce**, a small team of Claude Code agents building the GitHub project **${project.repo}** for its owner.`,
    "",
    "## Your personality",
    personality,
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
      ? "`team`, `tasks`, `create_task`, `edit_task`, `assign`, `message`, `ask_owner`" + (wf.mergeBy === "lead" ? ", `merge_pr`" : "")
      : "`team`, `tasks`, `my_task`, `report`, `message`, `ask_owner`",
    ...(extras.mcp.length ? ["", "## Other tools the owner added (MCP servers)", extras.mcp.map((m) => `\`${m.name}\``).join(", ")] : []),
    ...(extras.envNames.length
      ? ["", "## Environment variables", `These are set in your shell: ${extras.envNames.map((n) => `\`${n}\``).join(", ")}. Use them by name (e.g. \`$${extras.envNames[0]}\`); never print, log or commit their values.`]
      : []),
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
    `${home()}/env/**`,
    ...team.filter((a) => a.id !== agent.id).map((a) => `${agentFolder(a)}/**`),
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
  // The stack's docs sites may be read without asking.
  const docs = stackPlan(project.stack ?? []).domains.map((d) => `WebFetch(domain:${d})`);
  const allow = [`mcp__${MCP_NAME}`, ...docs, ...(style === "trusted" ? ["Bash"] : SAFE_COMMANDS.map((c) => `Bash(${c}:*)`))];
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

/** The team tools plus the owner's servers for this agent. Header values are `${ENV}` references
 * that Claude Code fills in from the agent's environment, so no secret is ever written here. */
export function mcpJson(token: string, extra: McpServer[] = []) {
  const servers: Record<string, unknown> = { [MCP_NAME]: { type: "http", url: `${localUrl()}/mcp`, headers: { Authorization: `Bearer ${token}` } } };
  for (const m of extra) {
    if (m.name === MCP_NAME) continue;
    servers[m.name] =
      m.kind === "http"
        ? { type: "http", url: m.url, ...(m.headerName && m.envName ? { headers: { [m.headerName]: `\${${m.envName}}` } } : {}) }
        : { type: "stdio", command: m.command, args: m.args };
  }
  return { mcpServers: servers };
}

export interface AgentFiles {
  role: string;
  settings: string;
  mcp: string;
}

/** Writes the three files (owner-only permissions) and returns their paths. */
export function writeAgentFiles(agent: Agent, project: Project, team: Agent[], token: string, extras: Extras = NO_EXTRAS): AgentFiles {
  const dir = ensureDir(agentPrivateDir(project.id, agent.sign));
  const files = { role: join(dir, "role.md"), settings: join(dir, "settings.json"), mcp: join(dir, "mcp.json") };
  writeFileSync(files.role, roleText(agent, project, team, extras), { mode: 0o600 });
  writeFileSync(files.settings, JSON.stringify(settingsJson(agent, project, team, token), null, 2) + "\n", { mode: 0o600 });
  writeFileSync(files.mcp, JSON.stringify(mcpJson(token, extras.mcp), null, 2) + "\n", { mode: 0o600 });
  return files;
}

/** Claude Code stores a conversation at ~/.claude/projects/<folder with / replaced by ->/<session>.jsonl. */
export function transcriptFile(cwd: string, sessionId: string) {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
}
