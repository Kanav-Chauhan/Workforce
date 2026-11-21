# Workforce: progress

## ▶ RESUME HERE

**LIVE STATUS (2026-11-21):** Phase 0b done: `SPEC.md` written, waiting for the owner's approval. Nothing built yet. Next after approval: Phase 1 (engine).

- Session: `701b5a1a-8ee7-4692-9a98-0c2c50ed80b8`, transcript `~/.claude/projects/-home-north/701b5a1a-8ee7-4692-9a98-0c2c50ed80b8.jsonl`
- Resume: `cd ~ && claude --resume 701b5a1a-8ee7-4692-9a98-0c2c50ed80b8`
- Their code (read only, never copy into this repo): `git clone --depth 1 https://github.com/jsmastery-pro/jsm-hq.git` into a scratch folder.
- Next step: owner approves `SPEC.md` (or asks for changes), then Phase 1.

## Plan

| Phase | What | Status |
|---|---|---|
| 0a | `STUDY.md`: how JSM HQ works, in plain words | done |
| 0b | `SPEC.md`: what Workforce does (owner approves before any build) | done, owner reviewing |
| 1 | Engine: projects, agents in tmux, rules files, MCP tools, hooks | todo |
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
