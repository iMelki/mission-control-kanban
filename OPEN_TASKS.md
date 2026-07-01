# Mission Control Kanban Open Tasks

Last updated: 2026-07-01

GitHub issues are the canonical task records for this repo. This root index is
the local operator entrypoint; historical task notes remain in
`docs/OPEN_TASKS.md`.

## Active

- None currently tracked in this root index. Use GitHub issues for the live backlog.

## Recently Completed

- [#32 - Add runtime-aware dispatch adapters for manual, OpenClaw, and webhook agents](https://github.com/iMelki/mission-control-kanban/issues/32)
  - Completed on 2026-07-01.
  - Result: added agent runtime fields, SQLite migration/schema support, manual/OpenClaw/webhook dispatch adapters, auto-dispatch safety gating, Agent modal runtime controls, Task modal handoff copy, task-card runtime badges, and browser smoke coverage.
  - Safety: unknown/disabled runtimes fall back to manual handoff; direct OpenClaw/webhook dispatch validates the dispatch contract; webhook secrets use env-var indirection, bounded timeout, and redacted response URLs.
  - Validation: `npm run test:agent-runtimes`, `npm run test:github-sync`, `npx tsc --noEmit --incremental false --pretty false`, `npm run lint`, `npm run build`, React Doctor changed-scope scan, and `npm run smoke:runtime-ui`.

- [#31 - Make workspace side panels collapsible](https://github.com/iMelki/mission-control-kanban/issues/31)
  - Completed on 2026-07-01.
  - Result: the Agents and Live Feed side panels now collapse into narrow rails,
    persist their local browser state, and let the Mission Queue expand into
    the freed width while preserving existing filters, add-agent controls,
    OpenClaw connection controls, and feed rendering.
  - Validation: `npm run test:github-sync`, `npm run lint`, `npm run build`,
    React Doctor, and browser smoke verification.

- [#29 - Build static Local Control panel cards](https://github.com/iMelki/mission-control-kanban/issues/29)
  - Completed on 2026-06-23.
  - Result: added a compact home-page Local Control area with source-controlled
    cards for MCK, Mission Control, Command Center, MemSys, OpenClaw, Hermes,
    n8n, recurring health handoff, and GitHub diagnostics.
  - Guardrail: cards only open known URLs or MCK-owned diagnostic/detail routes;
    they do not start, stop, restart, shell out, call Railway, mutate GitHub,
    or expose secrets.
  - Validation: `npm run test:github-sync`, `npm run lint`, and in-app browser
    desktop/mobile QA with a click-through to `/n8n-sync-history`.

- [#22 - Plan main local control panel for app launch and UI handoff](https://github.com/iMelki/mission-control-kanban/issues/22)
  - Completed on 2026-06-23.
  - Result: added
    [docs/MAIN_LOCAL_CONTROL_PANEL_PLAN.md](docs/MAIN_LOCAL_CONTROL_PANEL_PLAN.md)
    to define MCK as the local cockpit/handoff surface while Command Center and
    the shared Dev Service Manager own safe launch and process-control paths.
  - Next implementation: [#29 - Build static Local Control panel cards](https://github.com/iMelki/mission-control-kanban/issues/29).

- [#24 - Reconcile closed GitHub/Project Done items to local MCK done state](https://github.com/iMelki/mission-control-kanban/issues/24)
  - Completed via PR #26 and closed on 2026-06-14.
  - Result: added issue-body dispatch metadata hydration, Project/issue status
    reconciliation, workspace-banner drift notes, and focused unit coverage for
    Ready/Review/Blocked/Done mapping.
  - Validation: `pre-commit run --all-files`, `npm run test:github-sync`,
    `npm run build`, and a live Assistants workspace sync against
    `http://127.0.0.1:3021/api/workspaces/assistants/github-sync`.
- [#20 - Clarify workspace-level manual sync control](https://github.com/iMelki/mission-control-kanban/issues/20)
  - Completed via PR #21. The project-backed workspace banner now labels the
    manual refresh control as **Sync now** and reports workspace-level sync
    results explicitly.
- [#18 - Choose and activate MCK n8n alert notification destination](https://github.com/iMelki/mission-control-kanban/issues/18)
  - Completed by selecting projects-ops Workflow Pack 1 alert intake as the
    local destination:
    `http://127.0.0.1:5678/webhook/projects-ops/mck-sync-alert`.
  - MCK still writes the ignored `.logs/mck-n8n-sync-alerts.jsonl` fallback log
    when failed/error sync runs occur.

## Legacy Index

- [docs/OPEN_TASKS.md](docs/OPEN_TASKS.md)
