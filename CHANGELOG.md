# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- Runtime-ops research roadmap for [#38](https://github.com/iMelki/mission-control-kanban/issues/38) in `docs/RUNTIME_OPS_RESEARCH_AND_ROADMAP.md`, plus per-runtime failure-rate trend data/cards and the `/runtime-regression` local artifact drilldown UI.
- Runtime UX workflow for [#38](https://github.com/iMelki/mission-control-kanban/issues/38) in `docs/workflows/RUNTIME_UX_AND_REGRESSION_WORKFLOW.md`, covering validation wizards, dry-run previews, bulk migration plans, dependencies, artifact closeout, and Turbopack inventory policy.
- Webhook endpoint validation wizard and runtime config template gallery for Hermes, Codex, Copilot, Claude Code, n8n, and generic webhook workers, with webhook `dispatch_enabled` gated on a successful signed non-task ping.
- Dry-run dispatch previews for manual/OpenClaw/webhook agents, bulk selected-agent runtime migration diffs, task dependency blocked-by UI/API, ready-for-agent checklist seeding, and GitHub issue draft generation from task dispatch metadata.
- Runtime failure-rate threshold alerts plus screenshot-thumbnail drilldown details under `/runtime-regression`, backed by a safe screenshot-serving API route and PR/requested-issue artifact comments after successful Runtime Regression CI.
- Non-blocking Turbopack inventory in the Runtime Regression workflow: `npm run build:turbo` logs are uploaded as `mck-turbopack-inventory` without blocking the supported webpack production build.
- Persistence-level regression coverage for [#34](https://github.com/iMelki/mission-control-kanban/issues/34), proving GitHub Project sync refreshes stale imported task dispatch metadata after issue grooming without status churn.

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
- The local React Doctor pre-commit wrapper now passes clean scans even when
  the remote score API is temporarily unreachable
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
