# How JSM HQ works (study notes)

Notes from reading JSM HQ's code (github.com/jsmastery-pro/jsm-hq, version 0.7.6, read on 2026-11-21) so we can build Workforce our own way. **Nothing here is their code.** It explains, in our words, what each part does, what is clever, and what we will do differently.

---

## 1. The big picture

HQ is **one Node server** plus **one web page**.

```
 Browser page  ⇄ WebSocket ⇄  HQ server  ──starts──▶  tmux session per agent ──runs──▶ claude
                                  ▲                                                     │
                                  ├──── HTTP "hooks" (status events) ◀──────────────────┤
                                  ├──── MCP tools (tasks, messages)  ◀──────────────────┘
                                  └──── polls GitHub with `gh` every ~20 s
```

- Everything the server knows sits in **one big in-memory object** (the "snapshot"): team, agent statuses, boards, tasks, PRs, messages, activity feed.
- Every change to it is **broadcast to every open browser** as a small event ("agent X changed", "task Y changed"). The page never asks; it just listens.
- Plan and team are saved as JSON files **inside the project repo** (`.jsmhq/config.json`, `.jsmhq/plan.json`) so they can be committed. Private things (agent folders, tokens, action items) live in `~/.jsmhq/<project>/`.

---

## 2. Starting an agent

When you press **Start** on an agent:

1. **Its own folder.** HQ makes a **full git clone** of your repo at `~/.jsmhq/<project>/<agent>/` (not a git worktree, because worktrees break inside sandboxes). It sets `origin` to the real GitHub URL so the agent can push.
2. **Its files.** HQ writes 3 files into that folder and hides them from git using `.git/info/exclude` (a private ignore list that is never committed):
   - **a role file** (`.jsmhq-role.md`): who you are, the team, the rules, your tools
   - **Claude Code settings** (`.claude/settings.local.json`): the hooks (see §4) plus "allow the team tools without asking"
   - **an MCP config** (`.claude/hq-mcp.json`): where the team tool server is, plus a secret token and the agent's id
3. **Its terminal.** HQ runs `claude --mcp-config <that file>` inside a **tmux session** named after the project and agent. tmux is what keeps the agent alive if HQ or the browser closes.
4. **The browser view.** HQ "attaches" to the tmux session through a pseudo-terminal (node-pty) and streams everything to the browser, where xterm.js draws it. Typing in the browser goes back the same way.

**How the role reaches Claude:** not through CLAUDE.md. The `SessionStart` hook simply prints the role file, and Claude Code adds hook output to the conversation. Smart: the project's own CLAUDE.md stays untouched.

**Every 3 seconds** HQ checks each tmux session: still alive? crashed (then show the last lines of the screen as the reason)? started before HQ restarted (then re-attach)?

---

## 3. The rules each agent gets (the role file)

- **Lead:** plan and assign, never write app code. Keep tasks small: **one task = one branch = one PR**. Each task lists the files it may touch and a "done when". Assign only to free, running workers. Either the lead merges (if you allow it) or it tells you the merge order.
- **Worker:** work only on your task. Call `get_my_task`, pull main, make a branch. Touch only the listed files; ask the lead for more. PR title starts with `[TASK-ID]`. Report "in review" with the PR number. If blocked, say why.
- **Everyone:** if you need the human (a key, an account, a dashboard setting), use `ask_user` with clear steps, and never write secret values, only variable names. Messages starting with `[HQ]` are from the system.

The user can add extra text per agent (their "ROLE.md" box in settings) on top of these rules.

---

## 4. How HQ knows what an agent is doing (hooks)

Claude Code can run a command on certain events. HQ registers a tiny `curl` command for 7 events that POSTs the event's JSON to `http://127.0.0.1:<port>/hook/<agent>/<event>`.

| Event | Meaning for HQ |
|---|---|
| SessionStart | Claude is up → "ready" (and print the role) |
| UserPromptSubmit | a new instruction arrived → "working" |
| PreToolUse | it is using a tool → "working: using Bash" |
| PostToolUse | a tool finished → if it was waiting on you, you answered |
| Notification | it is asking you something (permission, question) → **"needs you"** |
| Stop | the turn finished → "idle" |
| SessionEnd | Claude closed |

**Backup plan, because hooks can be missed:** if no hook has arrived for a few seconds, HQ **reads the last lines of the screen** from tmux. "esc to interrupt" means busy; "Do you want to proceed?" means a permission prompt; the input box means idle. This fixes wrong statuses.

---

## 5. How agents talk (the cleverest part)

There is no real chat system inside Claude Code, so HQ **types into the agent's terminal**:

- **Agent idle?** HQ uses `tmux send-keys` to type one line like `[HQ] Message from Michael: start TASK-3…` and presses Enter. If 3 seconds later no "UserPromptSubmit" hook came, it presses Enter again.
- **Agent busy?** The message waits in a queue. When the agent's turn ends, its **Stop hook** asks HQ "anything for me?". If yes, HQ answers "don't stop, here are your messages" (a Claude Code feature: a Stop hook can block stopping and give a reason). So Claude reads the messages and carries on.
- A timer retries every 2 seconds for anything still queued.
- Everything is joined into **one line**, because a newline would submit early.

This trick (type when idle, hand over at Stop when busy) is the heart of the whole product.

---

## 6. The team tools (MCP server)

HQ runs an MCP server at `/mcp` on its own port. Each agent connects with the shared token plus its own id in a header. 12 tools:

| Tool | Who | What |
|---|---|---|
| list_workers | all | the team and who is running or busy |
| get_status | all | everyone's status plus board counts |
| list_tasks | all | tasks, filterable |
| create_board | lead | a board = a phase or area |
| create_task | lead | title, description, files, done-when, needs |
| update_task | lead | edit a task |
| assign_task | lead | give a task to a worker → HQ types "start TASK-X" into the worker |
| get_my_task | worker | my task's details; marks it in progress |
| set_my_status | worker | in-progress / blocked / in-review (+ PR) / done → **lead is told automatically** |
| send_message | all | message someone (delivered as in §5) |
| ask_user | all | create an "action item" for the human |
| request_access | all | ask to allow a website (sandbox only) |

**Task IDs** come from the board: board "Phase 1" → "P1", tasks `P1-T01`, `P1-T02`… The PR title carries this ID.

When **you** close an action item ("Done" or "Dismiss" with a note), HQ messages the agent so it can continue.

---

## 7. The GitHub loop

Every ~20 seconds (sooner when an agent finishes a turn or reports a PR), HQ runs **one GraphQL query through your `gh` login**: open PRs, recently merged and closed ones, review state, comments, conflicts.

- **Match a PR to a task** by the `[TASK-ID]` at the start of the title (or by the branch name).
- **PR opened** → task becomes "in review".
- **New review comments** (CodeRabbit, Copilot, a human…) → the author is told: "read them with `gh pr view N --comments`, fix on the same branch, push, resolve".
- **Review passed** → the lead is told (merge it, or tell the human it's ready).
- **Merge conflict** → the author is told to rebase and fix.
- **Merged** → task done, the lead is told to assign the next one.
- **Rate limits:** GitHub allows 5,000 points per hour, shared with the agents' own `gh` commands. HQ keeps itself to about 1,200 and slows down when low. Sensible.

---

## 8. Safety and secrets

- **Two tokens.** One for the browser (in the URL the first time), one for agents (hooks and MCP). Both are random and stored in `~/.jsmhq/<project>/`. The server only listens on 127.0.0.1.
- **Sandbox mode** (Docker `sbx` mini-VMs): about 1,000 lines handle network rules, "allow this website" requests, port forwarding, secrets and MCP servers inside sandboxes. **We skip all of this for now** (the VPS can't run them).
- **App variables:** an env file per agent, loaded into the tmux shell. Agents are told the names, never the values.

---

## 9. Other features (smaller)

- **Setup checklist:** checks git, gh, tmux, claude, sbx and shows the fix command. It can run the fix in a terminal on the page.
- **Shell tab:** a plain shell in the agent's folder, next to its Claude terminal.
- **Stack picker:** you tick Next.js, Supabase, Clerk…, and HQ installs those tools' official agent skills into each agent's folder and allows their websites.
- **Plan export:** writes the board to `docs/plan.md`.
- **Codex support:** the same thing for OpenAI's Codex CLI. We skip it.
- **Windows:** no tmux there, so HQ runs agents itself with node-pty. Agents then stop when HQ stops.

---

## 10. What we learned

**Clever (we will use the same ideas, built our own way):**
1. One folder per agent, plus private files hidden with `.git/info/exclude`.
2. The role delivered by the SessionStart hook, so the repo's CLAUDE.md is untouched.
3. Status from hooks, with a screen-reading backup.
4. **Message delivery: type when idle, hand over at Stop when busy.**
5. Team tools over an MCP server running inside the app.
6. Tasks with files plus done-when, linked to PRs by `[TASK-ID]`.
7. One GitHub query per poll, kept within a rate budget.

**Overcomplicated or not for us (skip in version 1):**
- Docker Sandboxes (~1,000 lines), Codex, the stack/skills installer, plan export, the pixel-art office (~2,600 lines), the Windows pty path (later).
- The whole state as one big in-memory object saved to JSON in several places. We'll use **one SQLite file**.
- Config committed into the user's repo. We'll keep Workforce's data in its own home folder and leave the repo alone (maybe an export option later).

**What Workforce will do differently:**
- **Several projects in one app** (HQ runs one project per server). Good for the VPS: one dashboard for all your repos.
- **A real login** (for the VPS) instead of a token in the URL.
- **Permission prompts handled in the dashboard** (to check in Phase 0b: whether Claude Code's hooks let us answer them): when an agent asks "allow this command?", show it in the "Needs you" inbox with Allow/Deny, instead of making you open the terminal.
- A **clean dashboard design** (your choice, decided before Phase 2).
- **A usage guard:** show how much of the weekly Claude limit the team is using, and pause at your 70% rule.

---

## 11. Size check

| Their part | Lines | Workforce v1 |
|---|---|---|
| Server engine | ~4,700 | ~2,000 (no sandboxes, no Codex) |
| UI: panels + settings | ~4,000 | ~2,000 (Next.js + Tailwind) |
| Pixel office | ~2,600 | 0 |
| Data, mock world, stores | ~3,100 | small (SQLite + types) |
