# Workforce: progress

## ▶ RESUME HERE

**LIVE STATUS (2026-11-21, night):** Owner picked office **B (2D illustrated SVG)**. **Phase 2b part 1 DONE** (waiting for owner OK): `/live` WebSocket + dashboard served by the engine on one port; `web/` = Next.js 16 static export + Tailwind 4: Projects list (+ Add project), the office ported from office-b and driven by real events (Director → per-agent act queues: visits with bubbles, envelopes, walk to the CEO cabin on needs, PR parcels to the gate, confetti on done, coffee/wander when idle, dim cabin when off; 1 lead + 1–5 workers layout), Needs you strip (Allow/Deny + note, answers), right column (Activity / Board / Message the lead), agent panel (status, task, actions, messages, live screen polled 1 s, type + keys, Start/Stop/Restart), task panel (details, files, PR link, assign, history), team settings (start/stop, add worker by sign, usage limit). `/?demo=1` (`&workers=1..5`) plays the preview story as fake live events through the same pipeline. **Team renamed to English zodiac names** (Leo lead, Aries, Virgo, …) per owner. Run: `npm run build:web && npm run server` → http://127.0.0.1:3010 (demo: /?demo=1). Next: part 2 (setup checklist, stack picker, plan export, shell tab, ports/env drawers). Phase 3 still needs a test repo from the owner.

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
| 2b | Dashboard: office (§5b) + all screens + JSM HQ extras | part 1 done (owner check), part 2 todo |
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
