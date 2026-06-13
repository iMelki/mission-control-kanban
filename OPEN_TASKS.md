# Mission Control Kanban Open Tasks

Last updated: 2026-06-13

GitHub issues are the canonical task records for this repo. This root index is
the local operator entrypoint; historical task notes remain in
`docs/OPEN_TASKS.md`.

## Active

- [#24 - Reconcile closed GitHub/Project Done items to local MCK done state](https://github.com/iMelki/mission-control-kanban/issues/24)
  - Status: Ready in the Assistants Project.
  - Goal: keep project-backed MCK workspaces from showing older imported tasks
    as active after GitHub is closed and the GitHub Project item is Done.
  - Trigger: while closing `agent-settings#65`, the live sync updated the local
    task but left it in `inbox` until the dispatch contract was filled
    manually.
  - Validation target: `npm run test:github-sync` plus a focused live
    workspace sync against `http://127.0.0.1:3002/api/workspaces/assistants/github-sync`.
  - Latest implementation: added issue-body dispatch metadata hydration,
    Project/issue status reconciliation, workspace-banner drift notes, and
    focused unit coverage for Ready/Review/Blocked/Done mapping.

## Recently Completed

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
