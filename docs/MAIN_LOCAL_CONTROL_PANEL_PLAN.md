# Main Local Control Panel Plan

Issue: [mission-control-kanban#22](https://github.com/iMelki/mission-control-kanban/issues/22)

Last updated: 2026-06-23

## Goal

Make MCK a clear local cockpit and handoff surface for the apps that matter to
agent work: MCK workspaces, GitHub Project sync, OpenClaw, n8n sync health,
Command Center, Mission Control, MemSys, Hermes, and recurring health reports.

MCK should not become a free-form process manager. Startup, stop, restart, and
log-tail actions should be delegated to Command Center and the shared Dev
Service Manager allowlist unless MCK owns a narrow, reviewed action itself.

## Current Entry Points

| Surface | Entry point | MCK role |
| --- | --- | --- |
| MCK | repo dev: `http://127.0.0.1:3002` via `npm run dev:n8n`; managed local workspace: `http://127.0.0.1:3021/workspace/assistants` | Primary GitHub Project cockpit and task board. Docker-backed n8n uses `http://mck.host:3021` for scheduled sync. |
| MCK sync history | `/n8n-sync-history` | Local automation run history for scheduled Project sync. |
| GitHub diagnostics | `/api/github/diagnostics` | Readiness probe for token, issue read, and Project read. |
| OpenClaw status | `/api/openclaw/status` | Runtime connectivity probe. |
| Command Center | `http://127.0.0.1:3088` | Preferred app launcher and surface registry handoff. |
| Mission Control | `http://127.0.0.1:3001` | Broader local operator dashboard and Dev Service Manager UI. |
| MemSys Web Console | `http://127.0.0.1:5111` | Memory-system operator console. |
| Hermes Native dashboard | `http://127.0.0.1:9119` | Messaging gateway control surface. |
| n8n | `http://127.0.0.1:5678` | Workflow runner for MCK sync and projects-ops alerts. |

## First Screen Shape

Add a compact **Local Control** area to the home workspace dashboard before the
workspace cards.

Cards should be grouped by operator intent:

- **Work Cockpits**: MCK workspaces, Mission Control, Command Center.
- **Memory and Agents**: MemSys Web Console, OpenClaw status, Hermes dashboard.
- **Automation Health**: n8n sync history, n8n UI, projects-ops health reports.
- **Readiness**: GitHub diagnostics, OpenClaw status, last MCK sync result.

Each card should expose:

- name
- short status text
- last checked timestamp when available
- primary `Open` action for known URLs
- secondary `Details` action for MCK-owned diagnostics or run history
- no start/stop/restart button unless the target is backed by a source-controlled
  allowlist and a reviewed API route

## Handoff Rules

- Use MCK for task/project cockpit state, import, sync, diagnostics, and
  write-back preview.
- Treat `3002` as the repo development default and `3021`/`mck.host:3021` as
  the managed local MCK/n8n sync route unless the operator explicitly records a
  temporary override.
- Use Command Center for app launch when a surface may need to be started first.
- Use Mission Control or the shared Dev Service Manager for local process,
  Docker, WSL, pressure, log, and stop/start decisions.
- Use MemSys Web Console for memory-system bootstrap, source setup, and runtime
  recovery actions.
- Use n8n for workflow execution history; MCK should show the latest sync result
  and link to deeper n8n inspection.
- Do not expose raw secrets, local tokens, env values, or raw command lines in
  cards. Diagnostics should report capability and source class only.

## Implementation Slices

1. **Static control cards**
   - Add a `LocalControlPanel` component to the home page.
   - Use hardcoded, source-controlled entries for the known local surfaces above.
   - Open URLs in a new tab; do not start services.

2. **MCK-owned health data**
   - Read from existing MCK endpoints: `/api/github/diagnostics`,
     `/api/openclaw/status`, `/api/n8n/mck-sync-status?limit=1`.
   - Show `ok`, `limited`, `attention`, or `unknown`, not raw backend payloads.

3. **Command Center handoff**
   - Add an explicit Command Center card that explains it owns safe launch/start
     paths.
   - If Command Center later exposes a read-only surface registry API, MCK can
     consume only the display-safe fields.

4. **Health report links**
   - Link to projects-ops weekly/monthly health report files only after a stable
     local route or downloadable report endpoint exists.
   - Until then, link to the owning MCK/n8n sync history and keep report file
     paths in projects-ops docs.

5. **Reviewed action expansion**
   - Add any non-open action only as a separate issue with an allowlist, audit
     log, `WhatIf` mode, tests, and rollback path.

## Acceptance Criteria For The Build Slice

- Home page exposes a visible local-control area without hiding the workspace
  cards.
- All cards use explicit known URLs or existing MCK diagnostics endpoints.
- No card starts, stops, restarts, kills, shells out, calls Railway, or mutates
  GitHub.
- GitHub, OpenClaw, and n8n health cards degrade gracefully when endpoints fail.
- Tests cover the surface list and status mapping.
- `OPEN_TASKS.md` and `CHANGELOG.md` link this plan and the follow-up build
  issue.

## Follow-Up Issues

- [#29 - Build static Local Control panel cards](https://github.com/iMelki/mission-control-kanban/issues/29):
  completed on 2026-06-23 with a compact home-page Local Control area and
  MCK-owned GitHub/OpenClaw/n8n health signals.
- Optional later slice: integrate a display-safe Command Center surface registry
  API after that API exists.
- Optional later slice: expose projects-ops health reports through a reviewed
  local report endpoint.
