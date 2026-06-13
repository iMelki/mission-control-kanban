# Mission Control Kanban Open Tasks

Last updated: 2026-06-14

GitHub issues are the canonical task records for this repo. This root index is
the local operator entrypoint; historical task notes remain in
`docs/OPEN_TASKS.md`.

## Active

- No active repo-local task entries at this time.

## Recently Completed

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
