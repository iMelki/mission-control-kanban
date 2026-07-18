# Runtime Ops Research and Implementation Roadmap

Updated: 2026-07-19

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
- GitHub webhook guidance: use a high-entropy secret, HMAC-SHA256, unique
  delivery IDs, HTTPS verification, and bounded response times rather than
  treating endpoint reachability as authenticity.
- Stripe webhook guidance: bind timestamps into signatures and reject stale
  deliveries to limit replay.
- OWASP SSRF guidance: operator-supplied webhook URLs are server-side request
  destinations; keep this local control plane trusted and require host/IP
  allowlisting before exposing configuration to untrusted callers.

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
- Added explicit live GitHub issue create/update from the Task modal issue-draft panel, gated by a plain-English confirmation checkbox and the existing write-back safety layer.
- Extracted Task modal runtime surfaces into reusable dispatch-contract, runtime-actions, and GitHub issue draft components.
- Added compact task dependency graph/badges plus automated cycle-detection coverage and batch task dependency summaries.
- Added runtime migration audit history, env-var presence diagnostics for runtime templates, and a safe local mock webhook receiver (`npm run mock:webhook`).
- Expanded browser smoke coverage for dependency panel visibility, blocked-by badges, ready-for-agent checklist seeding, and webhook validation wizard disabled states.
- Reduced SQLite/Turbopack trace pressure with type-only database imports/lazy loading while pinning the local `dev:n8n` script to webpack because Next dev/Turbopack can break file-backed SQLite route APIs in this app.
- Split Playwright system dependency and Chromium download steps in CI, added browser-cache restore, and added step-summary artifact deep links for daily/runtime closeout.
- Split webhook health evidence into `reachable` and `verified`, require a
  resolved signing secret for outbound dispatch, fail before network I/O when
  it is absent, and report missing-secret audit state without mutating agents.

Primary security references for the signed-webhook slice:

- <https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks>
- <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- <https://docs.stripe.com/webhooks>
- <https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html>

## Remaining tracked work

1. Evaluate whether operators need true multi-hop DAG navigation after using the compact blockers → task → downstream dependency graph in live work.
2. Add dedicated mock-webhook browser smokes for explicit success and failure validation wizard states using `npm run mock:webhook`.
3. Add a settings/runtime diagnostics surface for env-var template presence if operators need it outside the Agent modal template gallery.
4. Continue route-level Task modal decomposition if the remaining non-runtime edit fields become harder to maintain.
5. Keep Turbopack as inventory-only until both `next build` and `next dev` can run file-backed SQLite route APIs without regressions.
6. Promote daily runtime-summary links from local/CI artifacts into durable issue comments; avoid committing expiring artifact URLs into source docs.

## Closeout semantics for the requested explanations

### Add CI artifact links into `OPEN_TASKS.md` or issue closeout comments automatically

Prefer issue/PR closeout comments. They are event-oriented, avoid churn in source-controlled task files, and can link the exact workflow run/artifact. `OPEN_TASKS.md` should keep durable status and the command/runbook, not expiring artifact URLs. If source-controlled links are required later, use a bot PR rather than direct CI commits.

### Revisit Turbopack support separately via `npm run build:turbo` inventory without blocking the supported webpack build

`npm run build` remains the required production build (`next build --webpack`). `npm run build:turbo` is now a CI inventory path that uploads logs/warnings. This lets us watch Next/Turbopack NFT trace behavior without breaking operators when the supported build is healthy.

2026-07-01 triage result: tightening the new runtime-regression screenshot route removed it from the warning trace. The remaining non-blocking Turbopack NFT warning still traces `./next.config.mjs` → `./src/lib/db/index.ts` → `./src/app/api/tasks/[id]/planning/route.ts`, which is consistent with the local SQLite route-handler/database bootstrap path. Keep the inventory artifact and webpack build policy until the DB bootstrap can be isolated or annotated without breaking local file-backed operation.

### Close/reconcile #34 once dispatch metadata refresh persistence is fully regression-covered

The new persistence regression proves a stale imported task receives repaired dispatch metadata from GitHub Project sync and remains in its active status. That gives enough evidence to reconcile and close #34 after the full validation/push closeout.
