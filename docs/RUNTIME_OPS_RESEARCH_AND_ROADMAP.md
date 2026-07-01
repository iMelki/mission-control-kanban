# Runtime Ops Research and Implementation Roadmap

Updated: 2026-07-01

This note records the research-first decisions for the post-runtime-ops MCK workstream tracked by [#38](https://github.com/iMelki/mission-control-kanban/issues/38) and the dispatch metadata refresh closeout tracked by [#34](https://github.com/iMelki/mission-control-kanban/issues/34).

## Research basis

Community/vendor guidance checked before implementation:

- shadcn Charts/Recharts: use small, accessible chart primitives for dashboard metrics rather than heavy bespoke visualization.
- Recharts/Tremor: good fit for future richer dashboards, but the first MCK slice can use small Tailwind bars to avoid new dependency weight.
- shadcn/Radix/React Hook Form/Zod: staged webhook validation wizard should validate URL, env-secret indirection, test delivery, signature freshness, and final enablement separately.
- TanStack Table/shadcn DataTable: best fit for bulk runtime migration with row selection, disabled-row reasons, and a sticky action bar.
- Terraform plan / GitOps diff patterns: dry-run dispatch and migration previews should show effective rendered output, no side effects, and a confirmation step before apply.
- React Flow/Dagre/ELK: reserve graph UI for true dependency DAGs; start with list/table blocked-by affordances when enough.
- GitHub Actions artifact docs and Security Lab guidance: artifact closeout links are best as issue/PR comments; workflow_run follow-ups must not execute untrusted artifacts.
- Next.js output file tracing docs and community Turbopack/NFT warning reports: keep webpack as the blocking production build, run Turbopack as a non-blocking inventory artifact until the trace warning is fully characterized.

## Implemented in this slice

- Added per-runtime failure-rate trend data to `/api/runtime/health` using `task_dispatch_attempts` grouped by day/runtime/status.
- Added compact per-runtime failure-rate cards to Settings → Runtime operations.
- Added persistence-level regression coverage proving GitHub Project sync refreshes an existing imported task's persisted `dispatch_metadata` after an issue body is repaired, without status churn.
- Added `/runtime-regression` as an operator-friendly drilldown page for local runtime smoke artifacts instead of making the Local Control card JSON-only.
- Extended runtime UI smoke to verify the drilldown page.
- Added a non-blocking `turbopack-inventory` GitHub Actions job that runs `npm run build:turbo`, captures logs/warnings, uploads an artifact, and does not block the supported webpack build.

## Remaining tracked work

1. Webhook endpoint validation wizard before enabling `dispatch_enabled`.
2. Runtime config template gallery for Hermes, Codex, Copilot, Claude Code, n8n, and generic webhook workers.
3. Dry-run dispatch preview for every runtime type.
4. Bulk agent runtime migration UI with before/after diff confirmation.
5. Task dependency / blocked-by visualization.
6. Operator-ready checklist editor for ready-for-agent tasks.
7. GitHub issue creation/update flow from MCK work slices.
8. Route-level decomposition for oversized workspace/task-modal components.
9. Mobile-first review of task modal and Settings runtime ops panels.
10. Daily summary refinements with screenshot/artifact deep links.
11. Automatic artifact-link comments after successful push/CI closeout.
12. Deeper Turbopack trace inventory and upstream issue tracking.

## Closeout semantics for the requested explanations

### Add CI artifact links into `OPEN_TASKS.md` or issue closeout comments automatically

Prefer issue/PR closeout comments. They are event-oriented, avoid churn in source-controlled task files, and can link the exact workflow run/artifact. `OPEN_TASKS.md` should keep durable status and the command/runbook, not expiring artifact URLs. If source-controlled links are required later, use a bot PR rather than direct CI commits.

### Revisit Turbopack support separately via `npm run build:turbo` inventory without blocking the supported webpack build

`npm run build` remains the required production build (`next build --webpack`). `npm run build:turbo` is now a CI inventory path that uploads logs/warnings. This lets us watch Next/Turbopack NFT trace behavior without breaking operators when the supported build is healthy.

### Close/reconcile #34 once dispatch metadata refresh persistence is fully regression-covered

The new persistence regression proves a stale imported task receives repaired dispatch metadata from GitHub Project sync and remains in its active status. That gives enough evidence to reconcile and close #34 after the full validation/push closeout.
