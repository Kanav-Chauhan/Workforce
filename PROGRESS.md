# Workforce: progress

## ▶ RESUME HERE

**LIVE STATUS (2026-11-21):** SPEC approved 2026-11-21 (zodiac team: Simha/Leo lead, Mesha + Kanya workers; p7 uses the p5 Caddy login). Phase 1 (engine) DONE and tested live 2026-11-21, waiting for the owner's OK. Next: Phase 2 (dashboard; ask the owner about design first). Phase 3 needs a test repo agents can push to (gh token on the VPS can't create repos: owner must create it).

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
| 2 | Dashboard (Next.js + Tailwind; owner picks the design first, no pixel/game look) | todo |
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
