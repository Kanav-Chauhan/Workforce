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
| **Board** | A named plan board per project ("v1", "Polish"). Every task is on one board (the task's `phase` field holds the board name; empty = the first board). Changed 2026-11-21 (owner): several boards per project. |
| **Needs you** | Anything waiting on you: a question, a permission prompt, a blocked task, a PR ready to merge. |

## 4. What you can do (the core flow)

v1 is done when this works end to end on a test repo:

1. Log in. Add a project by GitHub repo (`owner/name`). Workforce clones it once.
2. The team appears: lead **Leo** plus 2 workers, **Aries** and **Virgo**. Press **Start team**.
3. Type to the lead: "Add a /health page and a footer". The lead creates 2 tasks and assigns them.
4. Each worker gets its task, makes a branch, codes, and opens a PR titled `[WF-1] …`.
5. The task moves to **Review**. A review comment on GitHub is sent to the worker, who fixes and pushes.
6. A worker asks to run a command → it shows in **Needs you** with **Allow / Deny**. You tap Allow on your phone.
7. You merge on GitHub → the task moves to **Done** and the lead is told.
8. You close the browser. The agents keep working. You reopen it later and everything is still there.

## 5. Screens

Design is chosen with you **before Phase 2**. **Changed 2026-11-21:** the main view is an **office** like JSM HQ's, with polished, non-pixel graphics (see §5b). Content:

| Screen | What's on it |
|---|---|
| **Login** | Password. |
| **Projects** | Your projects with a one-line status ("2 working, 1 needs you"). **Add project**. |
| **Project** (main) | **Needs you** bar at the top · **Team**: a card per agent (name, role, status, current task, last action) · **Board**: To do / Working / Review / Done · **Activity** feed · **Message the lead** box. |
| **Agent panel** (click a card) | Live **terminal** (watch and type) · its **task** · its **messages** · Start / Stop / Restart. |
| **Task panel** (click a task) | Description, files it may touch, done-when, owner, PR link and review state, history. |
| **Settings** | Tabs: **Team** (start/stop, add a zodiac worker, add a custom agent with your own name, role, colour, model and optional existing folder, remove an agent: keep or delete its folder) · **Stack** (§7b) · **MCP servers** (extra servers per agent; header values come from an env variable, never stored) · **Environment** (per-agent variables: names shown as set/not set, values never shown again) · **General** (office name, permission style, plan export, usage limit) · **Setup** (checklist) · **Debug** (version, uptime, tmux sessions, last hook per agent). |
| **Welcome** (first run, no projects) | Name the office → add the first project (`owner/name`, lead + 1–3 workers, Careful/Trusted) → setup checklist (git, gh + login, tmux, claude, node, disk; each OK or its fix with a **Run** button that runs only that fix from a fixed list in a terminal). |
| **Ports** (top bar) | Ports the agents' programs listen on (agent's tmux pane + Shell tab process trees matched against `ss -ltnp`), with Open links on a laptop; on the server a note that ports aren't exposed. |
| **Usage** (top bar) | Weekly Claude usage % and a **Pause team** button. |

Works on a phone: the Needs-you bar and team cards come first, the terminal opens full-screen.

## 5b. The office (added 2026-11-21, owner request)

The Project screen's main area is a live **office**, like JSM HQ's but with **proper, polished graphics (not pixel art)**:
- **Cabins:** every agent is an employee with **their own cabin** (glass front, desk, screen). You can see what each one is doing from their cabin: typing at the desk, their screen shows the current action ("editing page.tsx"), a status light.
- **CEO cabin:** you (the owner) have a cabin too. When an agent asks you something (`ask_owner`, permission prompt), it **walks to the CEO cabin** and waits there with a speech bubble until you answer.
- **Talking:** when one agent messages another, it **walks to that agent's cabin** and they talk (speech bubbles), then it walks back.
- **Everything JSM HQ's office shows:** the plan wall with sticky notes that move between To do / Working / Review / Done; PRs carried as parcels to a review gate; merge = celebration and the note moves to Done; idle agents get coffee in the lounge or wander; click an agent for its panel and terminal.
- The rest of the dashboard (Needs you, activity feed, chat with the lead, drawers, settings) sits around the office: calm light look, side by side (owner choices 2026-11-21).
- **All JSM HQ features**, except Docker sandboxes (the VPS can't run them) and Codex (Claude Code only).
- Look is picked from previews first (Phase 2a), then built for real (Phase 2b).

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

**Extras at start-up (Phase 2b).** The agent's env file (`~/.workforce/env/<agent>.env`, 600) is sourced by the shell before `exec claude`, so values never appear in a command line; the role file lists the variable names only. Extra MCP servers go into its `mcp.json`. Stack skills (§7b) load with `--plugin-dir`.

**§7b Stack picker.** Per project, tick tools from a short curated list (`shared/stacks.ts`). For tools whose makers publish official Claude Code skills on GitHub (Vercel, Prisma, Clerk, Stripe, Supabase, Docker), Workforce shallow-clones that repo once (`~/.workforce/cache/skills`) and copies the chosen skills into each agent's folder at `.claude/workforce-stack/` (a local plugin, listed in `.git/info/exclude`). Plain `.claude/skills` in the repo would **not** load because agents start with `--setting-sources local` (checked 2026-11-21). The tools' docs domains are added as `WebFetch(domain:…)` allow rules. Tools with no official skill only add docs domains.

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

Every 30 seconds (about 4 s after an agent finishes a turn, never closer than 10 s), one `gh api graphql` query per project (`server/github.ts`, ~1 point of the 5,000/hour budget):
- PR title starts with `[ID]` (or the worker reported that PR number) → linked to that task (number, URL, state, review decision, checks, mergeable) → task moves to **Review**.
- New feedback (review bodies, unresolved inline comments with file:line, PR comments, failed checks, merge conflicts; bots like CodeRabbit included) → one message to the PR's author, each item only once (deduped by GitHub id in `pr_seen`) → task back to **Working** until a new commit lands on the branch, then **Review** again. The team's own GitHub comments start with `[Name]` (role-file rule) and are skipped.
- Ready (open, not draft, checks passing or none, no conflict, no changes requested, nothing waiting on the author, the chosen review bot has spoken) → **Needs you: "PR #4 is ready to merge"** with Open on GitHub / **Merge** / Later, and the lead is told.
- **Merge** (owner's click, dashboard or PR drawer) runs `gh pr merge --squash|--merge|--rebase` (the project's method if the repo allows it, else the first allowed), then deletes the branch.
- Merged → task **Done**, the lead (and author) are told, confetti at the gate. Closed without merge → task back to **To do** with no owner and a note, the lead is told.
- Errors back off (30 s × 2ⁿ, up to 10 min); under 300 points left it waits for the reset. Last sync, errors and points left show in Settings → Debug and the PR drawer.

**Workflow settings** (Settings → Workflow, per project): reviewer = you (default) / CodeRabbit / Greptile / Copilot (agents wait for and address the bot) / a command (run in the author's folder after each push, output sent to them) / none · who merges = you (default) or the lead (MCP `merge_pr`, only linked + ready PRs; agents' `gh pr merge` stays denied) · merge method (squash default) · optional deploy step command + which agents run it (they run it before the PR and report the result; no deploy infrastructure). Agents follow changes after a restart.

**Office:** a parcel goes back to the author's cabin on changes requested, passes through the gate (green tick) when ready, confetti on merge. Clicking a parcel opens the PR drawer.

Uses the machine's `gh` login. Agents push with the same login.

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
  env/<agent>.env       per-agent environment (600), never in a repo
  cache/skills/         shallow clones of vendors' official skill repos
```

Plan export (per project, off by default): `docs/plan.md` in the **lead's** folder, rewritten after each task change, never committed by Workforce.

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

Codex (Claude Code only for now) · Docker or sandbox modes (later) · Windows (later; Mac should work since it has tmux) · several users (only the owner) · agent memory across projects · **auto-merge** (the lead merging a PR by itself once review passes; maybe later, the owner merges for now).

**Built in Phase 2b (2026-11-21):** welcome + setup checklist, stack picker, MCP servers and env per agent, ports drawer, custom agents, remove agent, office name sign, several boards, plan export, reconnect banner + Debug panel. **Moved into v1 on 2026-11-21** (owner wants all JSM HQ features): plan export to `docs/plan.md`, stack picker (official agent skills per tool), setup checklist, shell tab per agent, ports/env drawers, the office (§5b).

Rules can be changed later if there's a good reason.

## 16. Phases and checks

| Phase | Builds | Done when |
|---|---|---|
| **1. Engine** | server, SQLite, agents in tmux, role/settings/MCP files, hooks → status, message delivery, team tools | on a test repo: start 3 agents from a script, the lead creates and assigns 2 tasks, the workers receive them and reply |
| **2a. Office look** | 2 clickable office previews (3D soft vs 2D illustrated), password-protected at p7 | you pick one |
| **2b. Dashboard** | the office (§5b) + all screens in §5; live terminal; Needs you + permission Allow/Deny; JSM HQ extras (§15) | you run a small job entirely from the browser, including one permission prompt |
| **3. GitHub loop** | §10, PR drawer, Settings → Workflow | a task goes assigned → PR → review comment fixed → you merge → Done, without help |
| **4. Online** | login, service, Caddy at p7, README, MIT licence (your name) | you open it on your phone and see live agents |

After each phase: I stop, show you, update `PROGRESS.md`, commit and push, and wait for your OK.

## 17. Defaults (change any of these)

- **Team names are the zodiac signs, English names** (renamed to English names 2026-11-21 (owner); first draft used the Sanskrit rashi names), each with a personality from its sign. The personality only changes the agent's tone and focus, never the rules:

| Name | Sign | Role | Personality |
|---|---|---|---|
| **Leo** | ♌ | **Lead** (always) | confident, decisive, sees the big picture, plans and leads |
| **Aries** | ♈ | Worker | bold, fast starter, good at building new features |
| **Virgo** | ♍ | Worker | careful, detail-minded, good at fixes, tests and polish |
| Capricorn | ♑ | extra worker | disciplined, steady, good at long, structured jobs |
| Libra | ♎ | extra worker | balanced, good at UI and clean code |
| Scorpio | ♏ | extra worker | deep, good at debugging and security |

  New projects start with Leo + Aries + Virgo. Extra workers come from the rest of the 12 signs.
- Model: Claude Code's default.
- Port 3010, address `p7.kanav.space`.
- Task ID prefix from the project name (`WF-1`, `ATL-1`…).
- First test repo: a new private `workforce-sandbox` repo on your GitHub, created by me in Phase 1.
