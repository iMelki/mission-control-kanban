# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed

- Added a deterministic Paperclip workspace provisioner for the factory path:
  clean workspaces install the root and plugin lockfiles with lifecycle scripts
  disabled, rebuild only `better-sqlite3`, and expose the same exact argv as the
  first repository-manifest validation (`#124`).
- Kept factory base-SHA resolution on an authoritative `origin/dev`
  `git ls-remote` read while increasing its finite child-process allowance from
  10 to 30 seconds. This matches the existing factory webhook default and
  avoids false dispatch failures on verified 10–14 second SSH reads.
- Hardened the Paperclip factory bridge's final independent-review boundary:
  all host HTTP requests are company-scoped against Paperclip `021ab2f`; apply
  mode and dispatch v2 require exact loopback identities; immutable persisted
  rows drive retry and same-revision replay; MCK and Mission Control retry
  independently; source occurrences no longer collapse; factory paths are
  canonical and scope-bound; lifecycle v2 requires the canonical delivery
  header; and callback bodies are bounded by size, total time, and inactivity.
- Closed two P1 Paperclip bridge boundaries: completion now requires exact
  latest Validator- and Reviewer-authored, schema-valid, body-hash-bound
  evidence tied to the current successful stage runs instead of trusting the
  Integrator receipt alone; and migration 005 plus every SQL/tool/event/UI
  path now scopes mappings, deliveries, retries, keys, counts, and diagnostics
  by authorized `company_id` with fail-closed legacy backfill. The context-free
  health hook validates configuration without querying or aggregating tenant
  runtime state. Exact-host SQL-policy validation and a digest-pinned
  PostgreSQL 17 harness now reproduce the empty install, legacy backfill and
  composite constraints, cross-company rejection, and unresolved-row failure
  with `ON_ERROR_STOP` in the deterministic factory gate.
- Runtime Regression now builds a fresh webpack production output, stages the
  standalone runtime assets, and launches `.next/standalone/server.js` with the
  same host/port contract as Docker. This avoids both the intermittent
  development-manifest race and Next.js's unsupported `next start` warning for
  standalone output.
- Successful Runtime Regression artifact receipts now update one marker-based
  PR/issue comment and read it back exactly instead of appending a notification
  on every run.
- Corrected Runtime Regression comment readback to use GitHub's repository-level
  issue-comment endpoint and report the pull request head SHA/ref instead of the
  synthetic merge ref. Run `29887043238` attempt 2 posted and verified the live
  PR #45 artifact comment successfully.
- Tracked the separate intermittent runtime JSON fixture failure as #46 after
  run `29887043238` attempt 1 failed and attempt 2 passed unchanged.

### Added

- Opt-in Paperclip software-factory dispatch v2 for
  [#47](https://github.com/iMelki/mission-control-kanban/issues/47), including
  pending-before-send attempt identity, task-revision hashing, raw-body HMAC
  and payload-hash replay protection, signed lifecycle stages, stale-task
  rejection, a live owned-remote `origin/dev` base-SHA freeze bound into the
  task revision and receipt, receipt-gated completion, and factory linkage in
  the MCK Dispatch timeline.
- Installable `integrations/paperclip-bridge` plugin with a sequential
  plan/build/deterministic-validation/independent-review/release issue graph,
  idempotent plugin storage, event-driven stage wakeups, exact-byte bounded
  lifecycle reconciliation, independently retryable MCK/Mission Control
  publications, live Paperclip run/role/decision-bound completion,
  strict canonical receipt/envelope identity gates, host-compatible
  object-shaped secret-reference configuration, a separately scoped exact-byte
  Mission Control outcome signature, raw markdown envelope readback before
  parent activation, fast MCK acceptance with deferred Mission Control
  reconciliation, explicit 2xx failure detection, redacted
  run/cost/decision dashboard/linkage/diagnostics UI, pinned SDK lockfile,
  focused tests, and a dedicated CI job.
- Repository-owned `.agentic-factory.json` exact-argv validation and
  `origin/dev` release-readback policy, plus the Paperclip bridge runbook and
  v2 dispatch/callback examples.
- Least-privilege Runtime Regression artifact comments for #43: validation jobs
  stay read-only; separate no-checkout jobs receive only `pull-requests: write`
  for same-repository PRs or `issues: write` for explicit dispatches, and each
  posted body is read back.
- Deterministic all-files pre-commit behavior for #44: mixed line endings fail
  without rewriting files and `require_serial` makes React Doctor execute once
  with the selected filenames. The broad-gate regression proof also compares
  tracked-file hashes before and after validation.

- Explicit scanning-only policy for [#41](https://github.com/iMelki/mission-control-kanban/issues/41), with a private hash-bound legacy-store backup, staged positive/negative Gitleaks canary proof, and repository-health readback showing no remaining filter/store conflicts.
- Secret-scanning policy documentation covering local staged enforcement, the independently pinned Gitleaks v3 pull-request job, server-side protection, and rollback boundaries.
- Follow-up tracking for [#43](https://github.com/iMelki/mission-control-kanban/issues/43) and [#44](https://github.com/iMelki/mission-control-kanban/issues/44), separating the Runtime Regression artifact-comment permission defect and all-files pre-commit churn from the completed #41 security-policy migration.

- Signed-webhook lifecycle regression coverage for
  [#38](https://github.com/iMelki/mission-control-kanban/issues/38): validation
  separates `reachable` from `verified`, webhook dispatch requires a resolved
  HMAC secret before network I/O, and runtime audit reports missing secrets
  without mutating agent records.
- React Doctor's staged pre-commit gate now launches npm's JavaScript npx
  entrypoint through Node on Windows, avoiding `spawnSync npx.cmd EINVAL`
  without enabling shell interpolation; #40 fixtures cover the launcher.

- Exact issue-filtered GitHub Project workspace sync for [#39](https://github.com/iMelki/mission-control-kanban/issues/39). Callers can pass `issue_refs` to require one active Project match per ref and limit both dry-run and apply behavior to that reviewed subset.
- Runtime-ops research roadmap for [#38](https://github.com/iMelki/mission-control-kanban/issues/38) in `docs/RUNTIME_OPS_RESEARCH_AND_ROADMAP.md`, plus per-runtime failure-rate trend data/cards and the `/runtime-regression` local artifact drilldown UI.
- Runtime UX workflow for [#38](https://github.com/iMelki/mission-control-kanban/issues/38) in `docs/workflows/RUNTIME_UX_AND_REGRESSION_WORKFLOW.md`, covering validation wizards, dry-run previews, bulk migration plans, dependencies, artifact closeout, and Turbopack inventory policy.
- Webhook endpoint validation wizard and runtime config template gallery for Hermes, Codex, Copilot, Claude Code, n8n, and generic webhook workers, with webhook `dispatch_enabled` gated on a successful signed non-task ping.
- Dry-run dispatch previews for manual/OpenClaw/webhook agents, bulk selected-agent runtime migration diffs, task dependency blocked-by UI/API, ready-for-agent checklist seeding, and GitHub issue draft generation from task dispatch metadata.
- Runtime failure-rate threshold alerts plus screenshot-thumbnail drilldown details under `/runtime-regression`, backed by a safe screenshot-serving API route and PR/requested-issue artifact comments after successful Runtime Regression CI.
- Non-blocking Turbopack inventory in the Runtime Regression workflow: `npm run build:turbo` logs are uploaded as `mck-turbopack-inventory` without blocking the supported webpack production build.
- Persistence-level regression coverage for [#34](https://github.com/iMelki/mission-control-kanban/issues/34), proving GitHub Project sync refreshes stale imported task dispatch metadata after issue grooming without status churn.
- Explicit GitHub issue live create/update from the reusable task-modal issue draft panel, gated behind a plain-English confirmation checkbox and the existing write-back safety layer.
- Reusable Task modal runtime sections for the dispatch contract, runtime actions, and GitHub issue draft/live writeback controls.
- Compact dependency graph and task-card blocked-by/blocking badges, backed by cycle-detection tests and batch dependency summaries in task APIs.
- Runtime migration audit history, runtime config-template env-var diagnostics, and a safe local mock webhook receiver (`npm run mock:webhook`) for webhook template testing.
- Expanded runtime UI smoke coverage for dependency panels, ready-for-agent checklist seeding, and webhook validation wizard disabled states, with latest local screenshot artifact paths emitted by the smoke result.
- Runtime regression CI artifact summaries now include local deep links and cached Playwright browser installation to reduce Chromium install slowness.

- Post-runtime-ops tracking for [#38](https://github.com/iMelki/mission-control-kanban/issues/38), including a home-page Runtime Regression card, `/api/runtime/regression`, CI artifact closeout automation via `npm run comment:runtime-artifacts`, and `docs/RUNTIME_REGRESSION_ARTIFACTS.md`.
- Runtime ops admin console for [#36](https://github.com/iMelki/mission-control-kanban/issues/36): global dispatch failure queue, runtime audit/migration action, workspace section tabs, callback replay protection, callback completion schema export, bridge callback examples, webhook health-test API/UI, runtime health badges, retention settings UI, callback replay ledger, schema/template downloads, retention audit metrics, CI runtime-regression workflow artifacts, and React Doctor full-project 100 policy plus changed-scope 100 wrapper output.
- Runtime dispatch hardening for [#33](https://github.com/iMelki/mission-control-kanban/issues/33): `task_dispatch_attempts` timeline storage, dispatch history API, Task modal dispatch timeline, safe webhook retry controls, webhook JSON Schema validation/docs, mock webhook/OpenClaw adapter tests, runtime filter chips, agent runtime audit summary, per-agent runtime health labels, reusable panel primitives, and responsive desktop/tablet/mobile smoke checks.
- `npm run check:runtime-regressions` to run the changed-scope React Doctor gate plus runtime UI smoke from one local regression command.
- `docs/WEBHOOK_DISPATCH_SCHEMA.md` documenting the canonical webhook payload, secret handling, and attempt timeline semantics.
- Runtime-aware dispatch adapters for [#32](https://github.com/iMelki/mission-control-kanban/issues/32): agents now carry `runtime_type`, `runtime_config`, and `dispatch_enabled`; `/api/tasks/:id/dispatch` routes through `manual`, `openclaw`, and `webhook` adapters; manual dispatch returns copyable handoff prompts; webhook dispatch posts a canonical payload with env-var token indirection.
- Agent modal runtime controls, Task modal handoff copy action, and task-card runtime badges so operators can see whether assignment means manual handoff, OpenClaw auto, webhook auto, or dispatch-off behavior.
- `npm run smoke:runtime-ui` browser coverage for runtime controls, task-card runtime badges, handoff copy visibility, and browser-console cleanliness.
- `npm run test:agent-runtimes` for runtime fallback, manual handoff, webhook payload/header, and auto-dispatch gating coverage.
- Collapsible workspace side panels for [#31](https://github.com/iMelki/mission-control-kanban/issues/31), with persistent Agents and Live Feed rails so the Mission Queue can use more screen width on demand.
- `docs/MULTI_AGENT_RUNTIMES.md` for [#32](https://github.com/iMelki/mission-control-kanban/issues/32), documenting the current OpenClaw-only auto-dispatch boundary and manual handoff/callback pattern for Hermes, Codex, Copilot, Claude Code, and other non-OpenClaw agents.
- Compact home-page Local Control area for `mission-control-kanban#29`, with
  source-controlled operator links and MCK-owned health signals for GitHub
  diagnostics, OpenClaw status, and n8n sync history.
- Main local control panel plan in
  `docs/MAIN_LOCAL_CONTROL_PANEL_PLAN.md`, covering MCK/Command Center/Mission
  Control/MemSys/Hermes/n8n handoff boundaries and a safe static-card build
  slice for `mission-control-kanban#22`
- Beginner-facing GitHub import flow in the Mission Queue UI with an
  **Import GitHub** modal for loading a GitHub issue URL before creating a
  linked local task
- Visible **GitHub Write-Back** panel in the task modal with dry-run and apply
  controls for GitHub-linked tasks
- `POST /api/github/load-issue` for resolving issue data plus linked GitHub
  Project item field values through `gh api`
- `GET /api/github/diagnostics` plus a Mission Queue diagnostics pill so
  operators can verify token source, GitHub auth, and Project-read availability
  before importing work
- Mission Queue GitHub readiness card that maps the same diagnostics into
  import preview, dry-run write-back, and apply write-back availability
- First-run operator documentation for the GitHub-native flow in
  `docs/GITHUB_IMPORT_PREVIEW.md`
- Diagnostics now probe a real GitHub Project field read, so tokens that can
  read issues but lack `read:project` report `limited` instead of a false
  import/write-back-ready state
- GitHub issue loading now degrades gracefully when Project fields are
  unavailable, allowing issue-only imports while warning that Project-backed
  sync is limited
- Project-backed workspace mappings for Assistants, MemSys, and Content
  Factory, including a local GitHub Project refresh API and workspace banner
  control
- Durable n8n MCK sync run-history API at `/api/n8n/mck-sync-status` plus a
  workspace banner status line for the last scheduled sync result and alert
  state
- MCK n8n sync alert notifications through `MCK_N8N_ALERT_WEBHOOK_URL` and a
  local ignored JSONL alert log for failed/error sync runs
- Documented the selected local alert destination:
  `http://127.0.0.1:5678/webhook/projects-ops/mck-sync-alert`
- Bounded MCK n8n sync history retention through
  `MCK_N8N_SYNC_HISTORY_LIMIT`, defaulting to the latest `100` rows
- n8n sync history page at `/n8n-sync-history`, linked from Project-backed
  workspace banners
- Guarded `mck-sync-test-assistants` workspace for non-dry-run n8n sync smoke
  tests without touching canonical operator workspaces
- Baseline `.git-secrets-ignore` for local secret-scan exclusions
- Root `OPEN_TASKS.md` index for current GitHub issue tracking
- `npm run dev:n8n` for running local MCK on `0.0.0.0:3021` so Docker-backed
  n8n workflows can reach the app consistently
- Operator guidance for restarting local `next dev` after `npm run build` so
  stale `.next` chunks do not trigger `_document` runtime failures

### Changed

- Scoped the React Doctor pre-commit gate for [#40](https://github.com/iMelki/mission-control-kanban/issues/40) to staged frontend files, made warning-level local diagnostics fail closed, and removed remote score-service availability from the commit decision.
- Switched the default production build to `next build --webpack` to remove the noisy Turbopack NFT trace warning from the supported build path while preserving `npm run build:turbo` for Turbopack inventory.
- Updated Browserslist/caniuse-lite data; no target browser changes were reported.
- Scoped README, the OpenClaw agent protocol, first-run operator guide, and dispatch-contract docs so `ASSIGNED` auto-dispatch is explicitly OpenClaw-only until [#32](https://github.com/iMelki/mission-control-kanban/issues/32) adds runtime adapters.
- Aligned the repo agent instructions with the current GitHub Issues + root `OPEN_TASKS.md` tracking model.
- Updated the repo-owned React Doctor hook and project config for Next.js 16 / React 19 / ESLint 9 so changed-scope scans and raw full-project scoring report 100/100 while intentional local-operator dashboard exceptions remain documented in `doctor.config.mjs`.
- Aligned the MCK local n8n route on `3021` / `mck.host:3021`; `3002` is no
  longer documented as the repo development default for scheduled sync work.
- GitHub Actions workflows now opt JavaScript actions into the Node 24 runtime
  to clear the Node 20 deprecation warning before GitHub's removal date.
- GitHub import preview now normalizes required dispatch-contract fields from
  GitHub Project fields as well as issue-body sections
- Imported GitHub tasks are blocked from entering active work statuses until
  `Allowed File Scope`, `Acceptance Criteria`, `Test Requirements`, `Review
  Mode`, `Impact`, and `Rollback / Fallback Plan` are present
- Imported task cards and the task modal now explain why a task remains in
  `Inbox` instead of forcing the operator to infer that from a failed drag
- GitHub write-back continues to fall back to `gh api` when direct Node fetches
  are unavailable in the local environment
- The local React Doctor pre-commit wrapper uses deterministic staged-file
  diagnostics and does not call the remote score API
- Project-backed workspaces now auto-refresh from their mapped GitHub Project
  on open while preserving GitHub as the source of truth and avoiding local
  workflow status churn
- The project-backed workspace banner now labels the manual refresh control as
  **Sync now** and reports workspace-level sync results explicitly
- Project-backed workspace sync now reconciles closed GitHub issues and Project
  `Done` items to local `done`, maps Project `Review` to the local review
  column, hydrates readiness/review/risk/impact from issue-body headings, and
  surfaces status reconciliation/drift notes in the workspace banner

---

## [1.0.2] - 2026-02-04

### Fixed

- Removed broken `db:migrate` script from package.json (referenced non-existent file)
- Migrations run automatically on app startup — no manual step needed

---

## [1.0.1] - 2026-02-04

### Changed

- **Clickable Deliverables** - URL deliverables now have clickable titles and paths that open in new tabs
- Improved visual feedback on deliverable links (hover states, external link icons)

---

## [1.0.0] - 2026-02-04

### 🎉 First Official Release

This is the first stable, tested, and working release of Mission Control.

### Added

- **Task Management**
  - Create, edit, and delete tasks
  - Drag-and-drop Kanban board with 7 status columns
  - Task priority levels (low, normal, high, urgent)
  - Due date support

- **AI Planning Mode**
  - Interactive Q&A planning flow with AI
  - Multiple choice questions with "Other" option for custom answers
  - Automatic spec generation from planning answers
  - Planning session persistence (resume interrupted planning)

- **Agent System**
  - Automatic agent creation based on task requirements
  - Agent avatars with emoji support
  - Agent status tracking (standby, working, idle)
  - Custom SOUL.md personality for each agent

- **Task Dispatch**
  - Automatic dispatch after planning completes
  - Task instructions sent to agent with full context
  - Project directory creation for deliverables
  - Activity logging and deliverable tracking

- **OpenClaw Integration**
  - WebSocket connection to OpenClaw Gateway
  - Session management for planning and agent sessions
  - Chat history synchronization
  - Multi-machine support (local and remote gateways)

- **Dashboard UI**
  - Clean, dark-themed interface
  - Real-time task updates
  - Event feed showing system activity
  - Agent status panel
  - Responsive design

- **API Endpoints**
  - Full REST API for tasks, agents, and events
  - File upload endpoint for deliverables
  - OpenClaw proxy endpoints for session management
  - Activity and deliverable tracking endpoints

### Technical Details

- Built with Next.js 15 (App Router)
- SQLite database with automatic migrations
- Tailwind CSS for styling
- TypeScript throughout
- WebSocket client for OpenClaw communication

---

## [0.1.0] - 2026-02-03

### Added

- Initial project setup
- Basic task CRUD
- Kanban board prototype
- OpenClaw connection proof of concept

---

## Future Plans

- [ ] Multiple workspaces
- [ ] Team collaboration
- [ ] Task dependencies
- [ ] Agent performance metrics
- [ ] Webhook integrations
- [ ] Mobile-responsive improvements
- [ ] Dark/light theme toggle

---

[1.0.1]: https://github.com/crshdn/mission-control/releases/tag/v1.0.1
[1.0.0]: https://github.com/crshdn/mission-control/releases/tag/v1.0.0
[0.1.0]: https://github.com/crshdn/mission-control/releases/tag/v0.1.0
