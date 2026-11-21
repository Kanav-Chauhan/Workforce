# Workforce v1: spec

What Workforce v1 does, and how. Approve this before anything is built. `STUDY.md` explains the ideas we learned from JSM HQ; this file is our own design.

---

## 1. In one paragraph

Workforce runs a small team of **Claude Code** agents on a GitHub project. A **lead** agent turns your request into small tasks and assigns them. **Workers** each build one task in their own copy of the repo and open a pull request. Workforce watches GitHub, sends review comments back to the right agent, and marks tasks done when you merge. You run it all from **one web dashboard** (laptop or phone): see every agent live, answer their questions and permission prompts, and merge. **You always merge; agents never do.**

## 2. Who uses it

One person: **you, the owner**. No teams, no sign-ups, no billing.

## 3. Words

| Word | Meaning |
|---|---|
| **Project** | One GitHub repo Workforce manages. Workforce can hold several. |
| **Agent** | One Claude Code session with a name, a role and its own folder. One **lead** per project, 1–3 **workers**. |
| **Task** | One small job: one task = one branch = one PR. Has an ID like `WF-12`. |
| **Phase** | Optional label on tasks ("Phase 1"), to group them. No separate boards. |
| **Needs you** | Anything waiting on you: a question, a permission prompt, a blocked task, a PR ready to merge. |

## 4. What you can do (the core flow)

v1 is done when this works end to end on a test repo:

1. Log in. Add a project by GitHub repo (`owner/name`). Workforce clones it once.
2. The team appears: lead **Simha** (Leo) plus 2 workers, **Mesha** (Aries) and **Kanya** (Virgo). Press **Start team**.
3. Type to the lead: "Add a /health page and a footer". The lead creates 2 tasks and assigns them.
4. Each worker gets its task, makes a branch, codes, and opens a PR titled `[WF-1] …`.
5. The task moves to **Review**. A review comment on GitHub is sent to the worker, who fixes and pushes.
6. A worker asks to run a command → it shows in **Needs you** with **Allow / Deny**. You tap Allow on your phone.
7. You merge on GitHub → the task moves to **Done** and the lead is told.
8. You close the browser. The agents keep working. You reopen it later and everything is still there.

## 5. Screens

Design is chosen with you **before Phase 2** (no game look). Content:

| Screen | What's on it |
|---|---|
| **Login** | Password. |
| **Projects** | Your projects with a one-line status ("2 working, 1 needs you"). **Add project**. |
| **Project** (main) | **Needs you** bar at the top · **Team**: a card per agent (name, role, status, current task, last action) · **Board**: To do / Working / Review / Done · **Activity** feed · **Message the lead** box. |
| **Agent panel** (click a card) | Live **terminal** (watch and type) · its **task** · its **messages** · Start / Stop / Restart. |
| **Task panel** (click a task) | Description, files it may touch, done-when, owner, PR link and review state, history. |
| **Settings** | Per project: team (add/remove agents, name, role text, model) and permission style (§8). Global: password, usage limit (default 90%). |
| **Usage** (top bar) | Weekly Claude usage % and a **Pause team** button. |

Works on a phone: the Needs-you bar and team cards come first, the terminal opens full-screen.

## 6. How it runs

```
 Browser ──HTTPS──▶ Caddy (VPS only) ──▶ Workforce server (one Node process, one port)
                                          ├─ serves the dashboard (Next.js, built to static files)
                                          ├─ /api      dashboard actions
                                          ├─ /live     WebSocket: live updates + terminals
                                          ├─ /hook     Claude Code hooks (status, permission prompts)
                                          ├─ /mcp      team tools for agents
                                          ├─ tmux: one session per agent, running `claude`
                                          ├─ gh: GitHub polling
                                          └─ SQLite: ~/.workforce/workforce.db
```

- **One process, one port**, run as a service. On the VPS it sits behind Caddy at `p7.kanav.space`. On a laptop it opens at `http://localhost:3010`.
- Hooks and MCP only accept requests from the machine itself (127.0.0.1), each with **its own agent token**.

## 7. Agents

**Folder.** Each agent gets a full git clone at `~/.workforce/projects/<project>/<agent>/`, with `origin` set to GitHub.

**Nothing extra goes into the repo folder.** Unlike JSM HQ, Workforce keeps each agent's files in `~/.workforce/projects/<project>/.agents/<agent>/` and points Claude at them with command-line options:
- `--append-system-prompt-file role.md`: the agent's role, team and rules
- `--settings settings.json`: the hooks and permission rules
- `--mcp-config mcp.json`: the team tools (with that agent's token)
- `--session-id <id>`: so Workforce can resume the same conversation after a crash or reboot

**Session.** It runs in tmux (`wf-<project>-<agent>`), so it survives the browser and the server restarting. Workforce re-attaches on start-up.

**Status** comes from hooks, with a screen-reading backup when hooks go quiet:

| Status | When |
|---|---|
| Off | not running |
| Ready | started, waiting |
| Working | busy (shows "using Bash", "editing page.tsx"…) |
| Needs you | a question or permission prompt |
| Blocked | reported blocked (with the reason) |

**Rules (role file).**
- Lead: plan and assign, never write app code. Small tasks with files + done-when. Assign only to free workers. Tell the owner the merge order. Never merge.
- Worker: only your task. Branch from the latest `main`. Edit only the listed files, or ask the lead. PR title `[ID] title`. Report review / blocked. Never merge, never push to `main`.
- Everyone: use `ask_owner` for keys, accounts or decisions; name variables, never write secret values.
- Your own extra text per agent (from Settings) is added at the end.

**Messages** use the idea from `STUDY.md` §5: typed into the terminal when the agent is idle, and handed over by the Stop hook when it's busy.

## 8. Permission prompts (from the dashboard)

Claude Code's `PermissionRequest` hook (confirmed in our installed version) fires when an agent wants to do something that needs approval. Workforce:
1. Shows it in **Needs you**: "Sam wants to run `npm install zod`" → **Allow** / **Deny** (+ optional note).
2. Sends your answer back to Claude, which continues.
3. If you don't answer within 10 minutes, the normal prompt stays in the agent's terminal, so nothing is lost.

**Permission style** (per project):
- **Careful** (default on the VPS): file edits inside its own folder are allowed; every shell command and web fetch asks you. Safe commands (git status/diff/log, ls, cat, the project's test and lint scripts) are pre-allowed.
- **Trusted:** most commands allowed; only risky ones ask (`rm -rf`, `docker`, `sudo`, anything touching paths outside its folder). For a laptop or a throwaway repo.

Always blocked, in both styles: reading `~/deploy`, `~/.ssh`, `~/.workforce/workforce.db`, other agents' folders, and any `docker` command.

## 9. Team tools (MCP)

| Tool | Who | Does |
|---|---|---|
| `team` | all | everyone's name, role, status and current task |
| `tasks` | all | list tasks (filter by status, owner, phase) |
| `create_task` | lead | title, details, files, done-when, depends-on, phase |
| `edit_task` | lead | change a task |
| `assign` | lead | give a task to a worker → the worker is told to start |
| `my_task` | worker | my task's details (marks it Working) |
| `report` | worker | working / blocked (why) / review (PR number) → the lead is told |
| `message` | all | message a teammate or the lead |
| `ask_owner` | all | add a question to **Needs you**; your answer comes back as a message |

## 10. GitHub loop

Every 30 seconds (sooner after an agent finishes a turn), one `gh api graphql` query per project:
- PR title starts with `[ID]` → linked to that task → task moves to **Review**.
- New review comments → the author is told to read, fix, push and resolve them.
- Changes approved / checks passing → **Needs you: "PR #4 ready to merge"**, and the lead is told.
- Merge conflict → the author is told to update from `main`.
- Merged → task **Done**, the lead is told to assign the next one.
- Closed without merge → task back to **To do**, the lead is told.
- Stays under GitHub's hourly limit (slows down when low).

Uses the VPS's existing `gh` login. Agents push with the same login.

## 11. Usage guard

Reads the weekly Claude usage that Claude Code's status line already saves (`~/.claude/state/statusline-last.json`, used by your `week-limit.sh`).
- Shown in the top bar.
- At your limit (default **90%**), Workforce **pauses**: no new messages or assignments are delivered, and the lead and workers are told to stop after their current step. **Resume** is one click.

## 12. Data

One SQLite file (Node's built-in `node:sqlite`, nothing to install): projects, agents, tasks, messages, needs-you items, activity, PR cache, settings.

Folder layout:
```
~/.workforce/
  workforce.db
  projects/<project>/
    <agent>/            the agent's clone
    .agents/<agent>/    role.md, settings.json, mcp.json (never inside the clone)
```

Nothing is written into your project's repo except what the agents commit through PRs.

## 13. Login and safety

- **On the VPS:** the same login as p5 (Caddy password, user `kanav`, same password). Server on 127.0.0.1 only, Caddy (HTTPS) in front.
- **On a laptop (later):** Workforce's own password screen (stored hashed, cookie for 30 days, 5 wrong tries per minute → wait).
- The live terminal is powerful (you can type into an agent's shell), so the login is mandatory, even on a laptop when it's reachable from the network.

## 14. Tech

| Part | Choice |
|---|---|
| Server | Node 24 + TypeScript, Fastify, `ws`, `@modelcontextprotocol/sdk`, `node-pty`, `zod`, `node:sqlite` |
| Dashboard | Next.js 16 (static export) + Tailwind 4 + xterm.js |
| Agents | Claude Code in tmux |
| GitHub | `gh` CLI |
| Layout | `server/`, `web/`, `shared/` (types used by both), one `package.json` workspace |
| Tests | Vitest for the server logic (task rules, hook → status, message queue, PR matching) |

## 15. Not in v1

Codex (Claude Code only for now) · Docker or sandbox modes (later) · Windows (later; Mac should work since it has tmux) · several users (only the owner) · plan export to the repo · installing agent "skills" by stack · agent memory across projects · **auto-merge** (the lead merging a PR by itself once review passes; maybe later, the owner merges for now).

Rules can be changed later if there's a good reason.

## 16. Phases and checks

| Phase | Builds | Done when |
|---|---|---|
| **1. Engine** | server, SQLite, agents in tmux, role/settings/MCP files, hooks → status, message delivery, team tools | on a test repo: start 3 agents from a script, the lead creates and assigns 2 tasks, the workers receive them and reply |
| **2. Dashboard** | design chosen with you first; all screens in §5; live terminal; Needs you + permission Allow/Deny | you run a small job entirely from the browser, including one permission prompt |
| **3. GitHub loop** | §10 | a task goes assigned → PR → review comment fixed → you merge → Done, without help |
| **4. Online** | login, service, Caddy at p7, README, MIT licence (your name) | you open it on your phone and see live agents |

After each phase: I stop, show you, update `PROGRESS.md`, commit and push, and wait for your OK.

## 17. Defaults (change any of these)

- **Team names are the Indian zodiac signs (rashi)**, each with a personality from its sign. The personality only changes the agent's tone and focus, never the rules:

| Name | Sign | Role | Personality |
|---|---|---|---|
| **Simha** | Leo ♌ | **Lead** (always) | confident, decisive, sees the big picture, plans and leads |
| **Mesha** | Aries ♈ | Worker | bold, fast starter, good at building new features |
| **Kanya** | Virgo ♍ | Worker | careful, detail-minded, good at fixes, tests and polish |
| Makara | Capricorn ♑ | extra worker | disciplined, steady, good at long, structured jobs |
| Tula | Libra ♎ | extra worker | balanced, good at UI and clean code |
| Vrishchika | Scorpio ♏ | extra worker | deep, good at debugging and security |

  New projects start with Simha + Mesha + Kanya. Extra workers come from the rest of the 12 signs.
- Model: Claude Code's default.
- Port 3010, address `p7.kanav.space`.
- Task ID prefix from the project name (`WF-1`, `ATL-1`…).
- First test repo: a new private `workforce-sandbox` repo on your GitHub, created by me in Phase 1.
