# Workforce: progress

## ▶ RESUME HERE

**LIVE STATUS (2026-11-21, late):** Phase 2b part 1 done + **part 2a done** (waiting for owner OK). Part 2a: own-shape rewrite (server/courier.ts + handover.ts replace delivery.ts; web/lib/office/planBoard.ts + planWall.ts replace the engine's sticky-note code) and a **live interactive terminal**: node-pty 1.1.0 (server/terminals.ts, WS `/term/agent/:id` = `tmux attach` to the agent, `/term/shell/:id` = `bash -l` in the agent's folder; one pty per terminal shared by all browsers, closed 8 s after the last leaves; window-size latest while watched, back to 200×50 after), xterm.js 6 + fit + web-links in the agent panel (tabs Claude Code / Shell, New shell, full screen, phone key bar, Shift+Enter = ESC+CR, Ctrl+C copies a selection else interrupts, Ctrl+V / Ctrl+Shift+C/V clipboard, light theme with minimumContrastRatio 4.5), snapshot fallback when node-pty can't load (`/api/terminals`), demo has a fake terminal + toy shell. Run: `npm run build:web && npm run server` → http://127.0.0.1:3010 (demo: /?demo=1). Next: part 2b (setup checklist, stack picker, plan export, ports/env drawers). Phase 3 still needs a test repo from the owner.

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
| 2b | Dashboard: office (§5b) + all screens + JSM HQ extras | part 1 + 2a done (owner check), 2b todo |
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
- Gaps: agent tab scrollback is tmux's screen only (history needs tmux copy-mode); tmux prefix Ctrl+B still active in the agent tab (Claude Code's Ctrl+B needs pressing twice); a narrow phone viewer narrows the agent's window while watching.
