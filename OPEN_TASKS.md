# Mission Control Kanban Open Tasks

Last updated: 2026-06-23

GitHub issues are the canonical task records for this repo. This root index is
the local operator entrypoint; historical task notes remain in
`docs/OPEN_TASKS.md`.

## Active

- [#29 - Build static Local Control panel cards](https://github.com/iMelki/mission-control-kanban/issues/29)
  - Goal: implement the first safe home-page Local Control area from
    [docs/MAIN_LOCAL_CONTROL_PANEL_PLAN.md](docs/MAIN_LOCAL_CONTROL_PANEL_PLAN.md).
  - Runtime note: `3002` is the repo development default; the current managed
    local workspace and Docker-backed n8n sync route use `3021` /
    `http://mck.host:3021`.
  - Guardrail: cards may open known URLs and consume MCK-owned health endpoints,
    but must not start, stop, restart, shell out, call Railway, mutate GitHub,
    or expose secrets.

## Recently Completed

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
    `http://127.0.0.1:3002/api/workspaces/assistants/github-sync`.
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
