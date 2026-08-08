# Mission Control Kanban Open Tasks

Last updated: 2026-08-08

GitHub issues are the canonical task records for this repo. This root index is
the local operator entrypoint; historical task notes remain in
`docs/OPEN_TASKS.md`.

## Active


- [#47 - Build the signed MCK ↔ Paperclip software-factory bridge](https://github.com/iMelki/mission-control-kanban/issues/47)
  - Status: implementation PR #119 merged into `dev` on 2026-08-04 at merge commit `246cd82ad95a23347bf50087f8ed5299bdc63a89`; the canonical checkout is now non-bare, clean, unlocked, and aligned with `origin/dev` at `a0a7af1b541dc1b621b7215ced9f290b4c33a186`.
  - Local implementation now provides opt-in dispatch v2 with a
    pending-before-send attempt, stable attempt/delivery/correlation/revision
    IDs, raw-body HMAC, replay conflict detection, lifecycle v2 callbacks, and
    receipt-gated completion while preserving v1. The v2 revision now binds
    the final live `origin/dev` SHA read from the owned remote immediately
    before dispatch.
  - The installable `integrations/paperclip-bridge` plugin creates the
    sequential plan/build/validate/review/release graph, persists linkage and
    retry evidence, preserves and reads back the exact raw dispatch JSON before
    activating the parent, signs Mission Control outcomes with a dedicated
    secret reference, leaves initial Mission Control apply pending after the
    synchronous MCK `started` callback, and exposes redacted Paperclip
    dashboard, issue-linkage, and diagnostics surfaces.
  - Final independent-review hardening now pins current host compatibility,
    routes every outbound request through company-scoped Paperclip policy,
    rejects non-exact loopback identities and non-canonical paths before
    orchestration, preserves immutable per-channel retry envelopes, replays
    current lifecycle evidence on same-revision redispatch, and bounds callback
    body size plus total/inactivity time.
  - Remaining closure evidence: install into the owned Paperclip runtime,
    prove a signed health ping and real dispatch, reconcile the returned
    receipt across control surfaces, and read back the resulting Paperclip/MCK
    receipts. The old #127 bare-checkout/rebind gate is resolved; do not create
    another clone unless a fresh topology failure is observed.

- [#46 - Make Runtime Regression JSON fixture reads deterministic](https://github.com/iMelki/mission-control-kanban/issues/46)
  - Runtime Regression run `29887043238` attempt 1 failed while rendering
    `/workspace/default` with `Unexpected end of JSON input`; all temporary
    smoke entities were cleaned up. Failed-job-only attempt 2 passed unchanged,
    so preserve both receipts and identify the empty/partial JSON source rather
    than weakening the smoke gate.
  - Root cause: the failure log shows Next.js `next dev` compiling the route
    and reading a truncated internal JSON manifest before returning HTTP 500;
    no application fixture file or SQLite JSON value was partial. The runner
    now uses a fresh webpack `next build`, stages `public` and `.next/static`
    into `.next/standalone`, and launches the same standalone server entrypoint
    as Docker with explicit host and port settings. It rejects an occupied port
    and retains `MCK_REGRESSION_SERVER_MODE=dev` only for local diagnosis.
  - Runtime artifact receipts use one marker-based PR/issue comment that is
    updated and read back, preventing a new success notification on every run.
  - Local validation: server-plan contract `2/2`; full runtime smoke and three
    consecutive remote paths remain required before closure.


- [#38 - Post-runtime-ops MCK UX, automation, and regression workstream](https://github.com/iMelki/mission-control-kanban/issues/38)
  - Status: active on 2026-07-01.
  - Scope: component-pool-first runtime UX improvements, artifact-link closeout automation, failure-rate charts, webhook validation/templates, dry-run previews, bulk migration diffs, dependency/readiness surfaces, mobile review, and scheduled runtime-regression summaries.
  - First slice completed: restored local port 3021, updated Browserslist data, switched the default production build to webpack to remove the Turbopack NFT warning while retaining `npm run build:turbo` for Turbopack inventory, added runtime-regression artifact comment automation, added the home-page Runtime Regression card, and scheduled the daily Hermes runtime-regression summary job (`dea31c50c660`).
  - Second slice completed: added per-runtime failure-rate trend cards in Runtime operations, created `/runtime-regression` as a local artifact drilldown UI, extended smoke coverage for the drilldown, added a non-blocking `turbopack-inventory` CI artifact job, and documented the research-first roadmap in `docs/RUNTIME_OPS_RESEARCH_AND_ROADMAP.md`.
  - Third slice completed: added runtime config templates, webhook endpoint validation gating, dry-run dispatch previews, selected-agent runtime migration diffs, task dependency blocked-by UI/API, ready-for-agent checklist seeding, GitHub issue draft generation, runtime failure-threshold alerts, runtime-regression screenshot thumbnails, PR/requested-issue artifact comments after successful CI, and the reusable workflow doc `docs/workflows/RUNTIME_UX_AND_REGRESSION_WORKFLOW.md`.
  - Fourth slice completed: added explicit GitHub issue live create/update behind a plain-English confirmation checkbox, extracted Task modal runtime sections into reusable components, added dependency graph/badges with cycle-detection tests, added runtime migration audit history, runtime-template env diagnostics, local webhook mock receiver, Playwright browser-cache CI tuning, runtime artifact deep links, and expanded browser smoke coverage for dependency/checklist/webhook wizard states.
  - Fifth slice completed: webhook validation now distinguishes unsigned
    reachability from signed verification, auto-dispatch and live dispatch fail
    closed without a resolved signing secret, runtime audit exposes the missing
    secret without mutating agent records, and loopback route/adapter tests
    cover signed success, unsigned 2xx, non-2xx, and no-network failure.
  - Validation: `npm run lint`, `npm test`, `npm run build`, `npm run doctor:react`, `npm run smoke:runtime-ui`, and `npm run comment:runtime-artifacts -- --dry-run`.
  - Research basis: local MCK primitives, Component Marketplace, MemSys/Paperclip UI patterns, shadcn/ReUI/TanStack/Radix dashboard/form/table patterns, Tremor/Recharts chart guidance, React Flow/Dagre dependency graph guidance, GitHub Actions artifact REST API guidance, GitHub Security Lab `workflow_run` cautions, and Next.js output-file-tracing guidance.

## Recently Completed

<!-- Cured 2026-08-06 via the workspace issue-state audit (projects-ops#101/#73): entries below were active while their issues were closed. -->
- [#128 - Make Runtime Regression workspace readiness deterministic in CI](https://github.com/iMelki/mission-control-kanban/issues/128)
  - CI run `30759413222` failed only at the Settings-tab visibility wait while
    bridge, gitleaks, pre-commit, and inventory checks passed. A clean clone of
    the exact PR head initially passed the production regression locally, but
    that clone was on the older feature head and did not include the merged
    Tabs primitive.
  - The fix adds a page-owned `data-workspace-ready="true"` marker after the
    workspace API loads, waits on that marker before role assertions, uses the
    canonical Radix/shadcn `tab` role after the #48 UI consolidation, and logs
    a bounded URL/marker/nav/geometry diagnostic on timeout. The diagnostic
    proved the original Settings element was visible (`117x34`) but had role
    `tab`, not `button`; no CSS or application control defect was found.
  - The same #48 dnd-kit consolidation exposes a separate reorder-handle
    `role="button"` alongside each task-card `role="button"`. The smoke now
    scopes task-card locators to the direct `li > [role="button"]` card root
    and its visible title text so the handle cannot create a strict-mode
    collision.
  - Closure gate: PR #119 and its dependent fixes are merged into `dev`; retain
    the historical checks and now require the installed-host signed ping,
    bridge receipt reconciliation, and natural runtime evidence before closing
    the bridge workstream.
- [#48 - Adopt ReUI/shadcn kanban+Card+Tabs primitives instead of hand-rolled equivalents](https://github.com/iMelki/mission-control-kanban/issues/48)
  - Implemented: `MissionQueue.tsx`'s kanban board now uses `@dnd-kit/core` +
    `@dnd-kit/sortable` (`DndContext`/`SortableContext`/keyboard sensor)
    instead of native HTML5 drag events, giving accessible keyboard
    reordering; `ui/Panel.tsx` now re-exports shadcn `Card` primitives
    (`class-variance-authority`); `WorkspaceSectionTabs.tsx` now uses shadcn
    `Tabs` (Radix) for correct `role="tab"`/`aria-selected` semantics. Added
    `components.json`, `src/lib/utils.ts`, `src/components/ui/{card,tabs}.tsx`.
    `ui/DataTable.tsx` intentionally left as-is (low-priority render-layer
    note, not a violation). `npm run lint`, `npm run build`, and `npm test`
    (21/21) all pass.

- [#43 - Fix Runtime Regression PR artifact-comment permission](https://github.com/iMelki/mission-control-kanban/issues/43)
  - Completed on 2026-07-22 with least-privilege no-checkout comment jobs:
    same-repository PRs receive only `pull-requests: write`, explicit issue
    dispatches receive only `issues: write`, and fork PRs cannot enter the
    write-capable job.
  - Live proof: Runtime Regression run `29887043238` attempt 2 passed, posted
    comment `5041329447` on PR #45, and read the exact JSON body back. The
    comment records commit `56d8ea1`, the source branch, and both artifacts.

- [#44 - Make all-files pre-commit deterministic and one-shot](https://github.com/iMelki/mission-control-kanban/issues/44)
  - Completed on 2026-07-22: mixed-line-ending checks are report-only, React
    Doctor receives selected files once with `require_serial`, and the
    all-files proof hashed 209 tracked files before and after validation with
    zero changes.
  - Validation: 91.928-second all-files pass, 12/12 React Doctor tests, 2/2
    runtime-comment tests, full test/lint/build, and pre-push deep scan of 792
    files.

- [#41 - Migrate secret-policy configuration to scanning-only](https://github.com/iMelki/mission-control-kanban/issues/41)
  - Closed on 2026-07-21 after commit `e351e9c` removed legacy filter/store
    state, added explicit scanning-only policy, preserved a private opaque
    rollback receipt, and proved non-policy tracked bytes unchanged.
  - Validation: positive/negative local Gitleaks canaries, policy audit 25/0/0,
    pinned v3 secret scan, CI, exact issue readback, and open PR #42.

- [#40 - Make React Doctor pre-commit staged-scope and score-outage safe](https://github.com/iMelki/mission-control-kanban/issues/40)
  - Closed on 2026-07-17 after commit `1b564b9` made the local warning-level
    gate staged-file scoped, score-outage independent, and fail-closed for
    index/process failures.
  - Validation: all existing tests plus 10/10 hook/config fixtures, lint,
    Markdown links, staged secret scan, and deterministic no-source skip.
  - Follow-up on 2026-07-19: a real commit exposed `spawnSync npx.cmd EINVAL`
    on Windows. The gate now invokes npm's `npx-cli.js` with `node.exe`, keeps
    `shell: false`, and has explicit success/missing-entrypoint fixtures.

- [#39 - Add exact issue-filtered GitHub Project workspace sync](https://github.com/iMelki/mission-control-kanban/issues/39)
  - Completed on 2026-07-14 for the `projects-ops#73` / `memsys#301` bounded import path.
  - Result: `POST /api/workspaces/{id}/github-sync` accepts reviewed `issue_refs`, requires each ref to match exactly one active Project item before writes, and mutates only the selected subset.
  - Live proof: the targeted dry run selected only `iMelki/memsys#301`; the separately reviewed apply imported exactly one task into the existing `memsys` workspace with no updates, moves, status reconciliation, or errors outside that selection.
  - Validation: `npm run test:github-sync` (`21/21`), `npx tsc --noEmit --incremental false --pretty false`, and `npm run lint`.

- [#34 - Refresh dispatch metadata on existing GitHub Project sync tasks](https://github.com/iMelki/mission-control-kanban/issues/34)
  - Completed on 2026-07-01 after commit `7abfe0e` added persistence-level regression coverage proving existing imported tasks refresh `dispatch_metadata` from repaired GitHub Project issue bodies without status churn.
  - Validation: `npm run test:github-sync`, `npm run lint`, `npx tsc --noEmit --incremental false --pretty false`, `npm test`, React Doctor 100, `npm run build`, and `npm run check:runtime-regressions`.

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
