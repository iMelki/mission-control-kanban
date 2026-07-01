# Mission Control Kanban Open Tasks

Last updated: 2026-07-01

GitHub issues are the canonical task records for this repo. This root index is
the local operator entrypoint; historical task notes remain in
`docs/OPEN_TASKS.md`.

## Active

- [#38 - Post-runtime-ops MCK UX, automation, and regression workstream](https://github.com/iMelki/mission-control-kanban/issues/38)
  - Status: active on 2026-07-01.
  - Scope: component-pool-first runtime UX improvements, artifact-link closeout automation, failure-rate charts, webhook validation/templates, dry-run previews, bulk migration diffs, dependency/readiness surfaces, mobile review, and scheduled runtime-regression summaries.
  - First slice completed: restored local port 3021, updated Browserslist data, switched the default production build to webpack to remove the Turbopack NFT warning while retaining `npm run build:turbo` for Turbopack inventory, added runtime-regression artifact comment automation, added the home-page Runtime Regression card, and scheduled the daily Hermes runtime-regression summary job (`dea31c50c660`).
  - Research basis: local MCK primitives, Component Marketplace, MemSys/Paperclip UI patterns, shadcn/ReUI/TanStack/Radix dashboard/form/table patterns, Tremor/Recharts chart guidance, React Flow/Dagre dependency graph guidance, and GitHub Actions artifact REST API guidance.

- [#34 - Refresh dispatch metadata on existing GitHub Project sync tasks](https://github.com/iMelki/mission-control-kanban/issues/34)
  - Status: open; implementation appears mostly present, but needs persistence-level regression coverage and closeout reconciliation.

## Recently Completed

- [#37 - Raise raw full-project React Doctor score to 100](https://github.com/iMelki/mission-control-kanban/issues/37)
  - Completed on 2026-07-01; raw `npx -y react-doctor@latest . --score` returned `100`, and the source-controlled React Doctor policy documents local-operator dashboard exceptions.


- [#36 - Runtime ops admin console, replay-safe callbacks, and React Doctor 100](https://github.com/iMelki/mission-control-kanban/issues/36)
  - Completed on 2026-07-01; GitHub issue closed after validation.
  - Scope: global dispatch failure queue, bulk runtime audit/migration, workspace section decomposition, callback replay protection/schema validation, webhook bridge docs/examples, webhook health test UI/API, runtime health badges, retention settings/metrics, callback replay ledger, webhook schema/template downloads, CI runtime-regression artifact workflow, and React Doctor 100 clean-diff/full-project proof.
  - Validation: `npm run lint`, `npx tsc --noEmit --incremental false --pretty false`, `npm test`, `npm run build`, raw full-project `npx -y react-doctor@latest . --score` = 100, and `npm run check:runtime-regressions` browser smoke.
  - Research basis: shadcn/ReUI/Radix-style tabs/data tables/admin panels, Stripe/GitHub/Slack webhook replay/HMAC patterns, JSON Schema callback contracts, Prometheus low-cardinality metrics, and GitHub Actions artifact workflows.
  - Safety: signed callbacks require delivery IDs, duplicate deliveries are idempotently ignored, health tests send non-task pings only, migration actions default to preview/dry-run, and secrets stay env-var referenced/redacted.

- [#35 - Add workspace runtime policy, signed callbacks, metrics, and runtime ops UI](https://github.com/iMelki/mission-control-kanban/issues/35)
  - Completed on 2026-07-01.
  - Scope: workspace default runtime policy UI, `/metrics`, schema export/download, webhook callback signatures, dispatch retention/rate limits, runtime health, smoke screenshots, scheduled regression automation, modal decomposition, and clearer dispatch-disabled/manual-fallback affordances.
  - Research basis: shadcn/ui/ReUI/Radix/Base UI component pools; Next.js route-handler guidance; Stripe/GitHub/Slack HMAC webhook signature patterns; JSON Schema 2020-12 conventions; Prometheus low-cardinality metrics practice.
  - Safety: store env-var names instead of raw secrets, redact webhook evidence, require confirmation for repeated webhook retries, and keep recurring regression output delivered to the origin chat.

- [#33 - Harden runtime dispatch audit, retry, schema, and responsive smoke coverage](https://github.com/iMelki/mission-control-kanban/issues/33)
  - Completed on 2026-07-01.
  - Scope: dispatch side-effect tests, mock webhook success/failure/timeout/retry coverage, OpenClaw adapter mock coverage, runtime audit UI, runtime filter chips, agent health labels, dispatch timeline, webhook schema docs, responsive smoke coverage, and local regression automation.
  - Research basis: official/community guidance from shadcn/ui, ReUI, Radix/Base UI, Playwright emulation docs, Ajv/JSON Schema guidance, Next.js env-var docs, Stripe/GitHub webhook guidance, and webhook security best-practice sources.
  - Safety: webhook retries are enabled only after a failed/timeout webhook attempt; raw webhook secrets stay outside runtime config.



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
