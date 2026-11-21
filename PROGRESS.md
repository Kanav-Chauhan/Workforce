# Workforce: progress

## ▶ RESUME HERE

**LIVE STATUS (2026-11-21, evening):** Phase 2b **all parts built** (2b-1 office, 2a terminal, **2b-2 JSM HQ extras**), waiting for owner OK. 2b-2: tmux prefix off + mouse on for agent sessions; wider side panel (Wider/Narrower) while an agent is open; remove agent (keep/delete folder); custom agents (name, role, colour, model, optional existing folder); welcome screen + setup checklist with Run (fixed fix list, xterm); stack picker (official vendor skills as a per-agent `--plugin-dir` plugin in `<folder>/.claude/workforce-stack`, git-excluded; docs domains → WebFetch allow); MCP servers per agent (header value = `${ENV}` from the agent's env); env per agent (600 file, names only); Ports drawer; office name sign; several boards per project (switcher on the office + Board tab, MCP `board`); plan export to the lead's `docs/plan.md`; reconnect banner with Retry; Debug tab. 70 tests, typecheck clean. Run: `npm run build:web && npm run server` → http://127.0.0.1:3010 (demo: /?demo=1, welcome demo: /?demo=1&welcome=1). Next: owner check, then Phase 3 (needs a test repo).

- Session: `701b5a1a-8ee7-4692-9a98-0c2c50ed80b8`, transcript `~/.claude/projects/-home-north/701b5a1a-8ee7-4692-9a98-0c2c50ed80b8.jsonl`
- Resume: `cd ~ && claude --resume 701b5a1a-8ee7-4692-9a98-0c2c50ed80b8`
- Their code (read only, never copy into this repo): `git clone --depth 1 https://github.com/jsmastery-pro/jsm-hq.git` into a scratch folder.
- Next step: owner OK on Phase 1 → ask design questions → build Phase 2.
- Test run: `WORKFORCE_HOME=<scratch>/wfhome node --import tsx server/main.ts` (kill with the pid from `ss -ltnp | grep :3010`; never `pkill -f` a pattern that matches your own shell). API on 127.0.0.1:3010. Agents: `tmux -L workforce ls`.

## Plan

| Phase | What | Status |
|---|---|---|
| 0a | `STUDY.md`: how JSM HQ works, in plain words | done |
| 0b | `SPEC.md`: what Workforce does (owner approves before any build) | done, approved |
| 1 | Engine: projects, agents in tmux, rules files, MCP tools, hooks | done, owner reviewing |
| 2a | Office look: 2 previews at p7, owner picks | done: B (2D) |
| 2b | Dashboard: office (§5b) + all screens + JSM HQ extras | done (owner check) |
| 3 | GitHub loop: PRs ↔ tasks, review comments to author, merged = done | todo |
| 4 | Online at p7 behind a password | todo |

## Rules

- Written from scratch. Their code is read to learn, never copied. MIT licence, owner's name only.
- Claude Code only. VPS runs Local mode (no sandboxes: no /dev/kvm). Permission prompts on.
- Stop after each phase and wait for the owner's OK.

## Log

- 2026-11-21: folder + git created, remote `Kanav-Chauhan/Workforce`. Phase 0a started.
- 2026-11-21: read their server (main, hub, sessions, tmux backend, agentFiles, adapters, hooks, inbox, planner, mcp, githubSync, actionItems, http, paths, store). `STUDY.md` written.
- 2026-11-21: confirmed Claude Code 2.1.330 has PermissionRequest hooks, --settings, --append-system-prompt-file, --mcp-config, --session-id; Node 24 has node:sqlite. `SPEC.md` written.
- 2026-11-21: owner approved SPEC with changes: zodiac team names, p7 login = p5 Caddy basic_auth, Claude Code only, no sandboxes/Windows/multi-user/auto-merge in v1.
- 2026-11-21: engine written (server/: db, store, team, status, tmux, agentFiles, delivery, work, hooks, runner, projects, mcp, usage, http, app, main) + engine.test.ts (18 pass). Weekly limit rule raised to 90% by owner.
- 2026-11-21: live test on Kanav-Chauhan/Workforce (lead + 2 workers, dry run, nothing pushed): message → lead → 2 tasks via MCP → assigned → workers branched + committed locally → reported → lead told. Trust prompt from dashboard works.
- Lessons: (1) the trust prompt highlights "No, exit": Allow = Down + Enter. (2) The owner's ~/.claude/settings.json allows everything, so agents start with `--setting-sources local` (only Workforce's settings count). (3) Claude Code auto-allows simple read-only commands (node --version). (4) Permission prompt → Needs you → Allow worked; deny rules (~/deploy, docker) proven with a rule-less run. (5) Lead sent instructions before assigning → added `note` to assign.
- 2026-11-21: owner OK on Phase 1. Owner wants the JSM HQ office back (cabins, CEO cabin, walking to talk) with beautiful non-pixel graphics + all JSM HQ features. Read their office code (layout, bots, parcels, plan notes, effects) to learn the behaviours. SPEC updated. p7 preview server + Caddy block live (401 without login). 2 preview builders started.
- 2026-11-21: owner picked B (2D). A deleted. Phase 2b part 1 builder started.
- 2026-11-21: Phase 2b part 1 built: /live (state + every store event, same-origin only), /api/agents/:id/type, static web/out served by the engine; web/ dashboard + office from preview B driven by live events; Director + ActQueue (pure, 14 tests) + /live tests; 35 tests pass, typecheck clean. Checked in headless Chromium at 1440×900 and 390×844 (web/shots/), no console errors. Owner change: team uses English zodiac names (Leo/Aries/Virgo…), SPEC §17 updated. Live check (scratch WORKFORCE_HOME, port 3012, only Leo started, then stopped): added Kanav-Chauhan/Workforce from the UI, Start from the agent panel, trust prompt allowed from the Needs-you strip, owner message → `node -e` permission prompt → Leo walked to the CEO cabin with a bubble → Allow in the browser → Leo went back. Fixed on the way: office crashed when /live's state arrived after the office mounted; activity order on load.
- 2026-11-21: Part 2a. Job 1 (originality, clean room, JSM HQ not opened): delivery.ts → courier.ts (per-agent seat phases offline/idle/typing/confirming/busy; submit confirmed by UserPromptSubmit inside CONFIRM_WINDOW_MS 2.5 s, one retry from the sweep; drainForStopHook, readyForTyping, PromptPort put/submit) + handover.ts; plan-wall cards → planBoard.ts (pure lanes/slots, tested) + planWall.ts (spring-driven cards); renamed activeTaskOf, subscribers, watchLoop. Job 2: live terminal + Shell tab (see status). Fixed on the way: tmux `set-option -t =name` silently failed (remain-on-exit/history-limit were never set) → now `=name:`. Live check (scratch WORKFORCE_HOME, port 3013, only Leo): colours, `/help` + Enter, Esc closed it, Shift+Enter made a 2-line prompt, Shell tab `git status`, phone full screen; then Leo stopped, server killed, no tmux left. 53 tests pass, typecheck clean. Shots: web/shots/terminal-desktop.png, terminal-phone.png, shell.png, terminal-help.png, terminal-demo-panel.png.
- Gaps (2a): a narrow phone viewer narrows the agent's window while watching.
- 2026-11-21: Part 2b-2 (JSM HQ extras, clean room, JSM HQ not opened). Server: env.ts, stack.ts, ports.ts, setup.ts, planExport.ts, db migrations (ADDED_COLUMNS) + mcp_servers table, routes in http.ts, `agentRemoved`/`office` live events. Web: Welcome, Setup, Settings (7 tabs), Extras (banner, ports drawer, board switcher), office sign + board filter, lookFor() for custom colours, demo data for every new screen. Found: repo `.claude/skills` does NOT load under `--setting-sources local`; `--plugin-dir` does (tested with a throwaway skill). Live check (scratch WORKFORCE_HOME, port 3014, only Leo): stack install → react-best-practices skill shows in Leo's `/` menu; exclude line written; env var reached the claude process, not its args; MCP `echo-test` listed in `/mcp` (failed on DNS as expected, no env warning), team tools OK; plan.md written in Leo's folder; custom agent added + removed with folder; Shell tab `python3 -m http.server 8765` showed in Ports; prefix None + mouse on set; server stop → banner → restart → resynced. Then Leo stopped, server killed, no tmux left. Shots: web/shots/welcome-1/2, checklist, checklist-run, settings-team, settings-custom, stack, mcp, env, general, debug, ports, ports-live, boards-office, boards-tab, boards-polish, banner, agent-wide, live-agent, phone-*.
- Gaps (2b-2): Claude Code runs fullscreen and takes the mouse itself, so the wheel goes to Claude Code's own scrolling (tmux copy-mode only applies when a program doesn't take the mouse); no MCP status in the dashboard (Claude Code doesn't report it; see `/mcp` in the agent's terminal); stack/env/MCP/permission changes need an agent restart (the UI says so); plan export leaves `docs/plan.md` untracked in the lead's clone; the welcome's real first-run wasn't shot against an empty home (demo shots cover it).
- 2026-11-21 16:05 (coordinator): demo build of eebc39b published at https://p7.kanav.space/ (redirects to /?demo=1; p5 login). Files: ~/deploy/workforce-preview/site (static copy of web/out + office-b), container on 127.0.0.1:3093. To refresh: build web, copy web/out/. into that folder. Replaced by the real app in Phase 4.
