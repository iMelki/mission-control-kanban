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
- Added webhook runtime config templates for Hermes, Codex, Copilot, Claude Code, n8n, and generic webhook workers.
- Added a webhook validation wizard that sends a signed non-task ping before enabling webhook `dispatch_enabled`.
- Added dry-run dispatch previews for manual/OpenClaw/webhook agents so operators can inspect prompts, callbacks, and webhook payloads without side effects.
- Added bulk runtime migration diff/apply support with selected-agent before/after runtime-field previews.
- Added task dependency blocked-by APIs and Task modal list visualization.
- Added ready-for-agent checklist seeding and GitHub issue draft generation from MCK work slices.
- Added runtime failure-rate threshold alerts to `/api/runtime/health` and Settings → Runtime operations.
- Added screenshot thumbnail previews and a safe screenshot-serving route for `/runtime-regression`.
- Updated Runtime Regression CI to comment artifact links on successful PR/requested issue runs.
- Captured the reusable operator workflow in `docs/workflows/RUNTIME_UX_AND_REGRESSION_WORKFLOW.md`.

## Remaining tracked work

1. Upgrade the blocked-by list into a true dependency graph only if operators need DAG navigation.
2. Wire GitHub issue drafts to an explicit live create/update action after adding a plain-English confirmation step.
3. Continue extracting Task modal sections into smaller route/component chunks as follow-up work.
4. Add scheduled daily summary deep links to the exact latest `/runtime-regression` screenshots once CI artifact URLs are available at run time.
5. Continue Turbopack trace triage for the `next.config.mjs` → `src/lib/db/index.ts` path while keeping webpack as the supported build.

## Closeout semantics for the requested explanations

### Add CI artifact links into `OPEN_TASKS.md` or issue closeout comments automatically

Prefer issue/PR closeout comments. They are event-oriented, avoid churn in source-controlled task files, and can link the exact workflow run/artifact. `OPEN_TASKS.md` should keep durable status and the command/runbook, not expiring artifact URLs. If source-controlled links are required later, use a bot PR rather than direct CI commits.

### Revisit Turbopack support separately via `npm run build:turbo` inventory without blocking the supported webpack build

`npm run build` remains the required production build (`next build --webpack`). `npm run build:turbo` is now a CI inventory path that uploads logs/warnings. This lets us watch Next/Turbopack NFT trace behavior without breaking operators when the supported build is healthy.

2026-07-01 triage result: tightening the new runtime-regression screenshot route removed it from the warning trace. The remaining non-blocking Turbopack NFT warning still traces `./next.config.mjs` → `./src/lib/db/index.ts` → `./src/app/api/tasks/[id]/planning/route.ts`, which is consistent with the local SQLite route-handler/database bootstrap path. Keep the inventory artifact and webpack build policy until the DB bootstrap can be isolated or annotated without breaking local file-backed operation.

### Close/reconcile #34 once dispatch metadata refresh persistence is fully regression-covered

The new persistence regression proves a stale imported task receives repaired dispatch metadata from GitHub Project sync and remains in its active status. That gives enough evidence to reconcile and close #34 after the full validation/push closeout.
