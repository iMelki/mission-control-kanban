# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed

- **Silent stuck cockpit loads no longer present false pre-data as settled
  (2026-09-01, #166, 2026-08-31 gauntlet row)** -
  Workspace metadata arrival no longer clears the loading flag before tasks
  exist, the placeholder cockpit is a skeleton instead of a confident empty
  board, GitHub readiness treats "not fetched yet" as Checking rather than
  "No token detected / 0/3 lanes ready", and the header connection badge
  stays Checking until the OpenClaw probe finishes. Local SSE open/error no
  longer writes that badge (it is not OpenClaw). Task fetch is no longer
  blocked behind agents/events, hangs become a retryable error after 10s,
  and `data-workspace-ready` is true only when the board phase is ready.
  Regression: `npm run test:cockpit-load-state`.

- **Muted timestamp contrast (2026-09-01, #151)** -
  `text-[10px] text-mc-text-secondary/60` composited to rgb(92,100,108) on
  the task-card `#161b22` at ~2.87:1. Replaced at the token/class level with
  solid `text-mc-text-muted` (`#8b949e`) which is >=4.5:1 on `#0d1117`,
  `#161b22`, and `#21262d`.

- **n8n and OFFLINE leftover contrast (2026-09-01, #151)** -
  Default n8n status line dropped `text-mc-text-secondary/70` (3.45:1 on
  `#161b22`) for solid `text-mc-text-secondary` (5.62:1). OFFLINE badge fill
  moved from `bg-mc-accent-red/20` (4.05:1 live on `:3122`) to existing
  `bg-mc-bg` (5.65:1 live on `:3123`). No new tokens. Regression:
  `npm run test:contrast-tokens`.

### Changed

- **Cockpit CTA and a11y lift (2026-08-27, #139)** -
  `Import GitHub` and `New Task` now share `mc-accent` (outline + filled
  primary). Sidebars toggle width instantly (`transition-none`). A skip
  link lands on `#main-content` on every served page. Added
  `mc-success` / `mc-warn` / `mc-danger` and migrated the board, readiness,
  and agent runtime pill maps only. Dashboard loading uses skeleton cards
  instead of a pulsing glyph. Reduced-motion was already the fleet
  contract in `globals.css`. Score remains **UNMEASURED / 5.7 carried** —
  see `docs/uiux-awwwards-lift-2026-08-27.md`. No 8.0 claim.

### Fixed

- **Capture probes refuse the dying next-dev listener (2026-08-27, #164, #139)** -
  `scripts/assert-production-capture-target.mjs` is now the shared preflight for
  `surfaces:probe` and `probe-surface-a11y.mjs`. `MCK_BASE_URL` is required;
  `http://127.0.0.1:3021` is refused without a GET, because that GET is the
  on-demand compile that killed the supervised server. A leftover
  `.next/BUILD_ID` does not make next-dev scoreable. Negative proofs cover the
  missing URL, 3021, next-dev HTML, missing BUILD_ID, and the CLI exit-2 path
  the probes actually invoke. Operator rule: `docs/production-capture.md`.
  Also landed the `capturedViewports` narrowing in
  `scripts/derive-captured-surfaces.ts` so `next build` is no longer blocked by
  `'record.viewports' is of type 'unknown'`.

### Documentation

- **First production-build capture (2026-08-26, #164, #165)** -
  `docs/production-capture-2026-08-26.md`. Every UI/UX round before this one
  measured this app on `next dev`, and `next dev` does not survive being
  measured: it died compiling the 4th consecutive on-demand route, and its
  watchdog then failed recovery twice at a 300-second ceiling while first-hit
  compiles were measured at 15-54 s per route. Built from a detached worktree at
  `c3bfc6f` and served with `next start` on a separate port, the same sequential
  warm answers 200 on 11 of 11 routes in 18-161 ms and the server stays up -
  `/runtime-regression` improves from 53,880 ms to 17.9 ms. `.next/BUILD_ID` is
  `LhwzqpkXyePprPbNMSBmo`, verified present before any number was recorded.
  Measured on that build: WCAG **2.5.8 (AA, 24x24) passes with 0 failures of
  4,394 controls** (positive control caught on 18 of 18 units), 2.5.5 (AAA,
  44x44) fails 53.4%, contrast coverage is **100%** (13,488 of 13,488 elements,
  cross-checked against a 1x1 canvas readback with 0 disagreements) with a worst
  ratio of 2.87:1, and focus coverage is **67.3%** - so 1,438 Tab-reachable
  controls remain unmeasured rather than clean. Composite 5.8 -> 5.9, and the
  report states plainly that this is a measurement gain rather than a product
  improvement, and which way it will move if the unmeasured remainder is
  reached. Nothing in `src/` changed, the manifest was not re-recorded, and
  `livenessContract` stays at `none`: 5 of 18 route x viewport units still
  refuse under `liveness_unstable_across_runs`, which was traced to the settle
  detector accepting a pre-data quiet window - the per-surface content assertion
  agent-settings#691 asks for is still the missing half.

### Fixed

- **The captured-surface gate accepted a stale capture (2026-08-16, #147)** -
  `docs/captured-surfaces.json` records a `capturedAt.commit` per surface, and nothing
  ever compared it to the code. `scripts/derive-captured-surfaces.ts` validated that the
  sha was 40 hex characters and stopped, so a surface could be rewritten after its capture
  and the gate stayed green: the capture drifted back to unmeasured while still reading as
  evidence. Confirmed by control first - with a clean tree `npm run surfaces:check` exited
  **0**, and it exited **0** again after appending a comment to
  `src/app/settings/page.tsx`, still citing the pre-change capture. **This was already
  live:** `5b846ce` changed `src/app/globals.css`, which the root layout imports and every
  surface renders through, yet 8 of the 9 surfaces still cited the pre-change `e50e256`.
  A capture now carries `sourceDigest`, a 16-hex content fingerprint over the transitive
  static local-import closure that renders that surface - its page, every `layout`/
  `template` wrapping it, everything they import through `@/` or a relative path, and
  `tailwind.config.ts`/`postcss.config.mjs`. The gate recomputes it and fails, naming the
  surface and the files that moved. It is **content, not ancestry**: a rebase or re-land
  producing identical files keeps a capture valid, and a rewrite keeping the same sha does
  not. Line endings are normalised to LF first, because the repo has `core.autocrlf=true`
  and no `.gitattributes`, so a raw-byte digest would fail on whichever platform did not
  take the capture. Depth is the design decision, so it is asserted rather than described:
  a `page.tsx`-only rule would have missed `RuntimeConfigTemplateGallery.tsx`, where the
  #145 clipping bug actually lived, and a whole-repo hash would invalidate everything on
  every commit and be routed around within a week. Measured on this repo's own history:
  the dependency union is 61 of 133 `src/` files, 35% of the last 60 commits touch it, and
  7% touch a global file that invalidates all nine. Six proofs, both directions: mutating
  `src/app/settings/page.tsx` fails naming `/settings` alone; mutating the shared
  `RuntimeConfigTemplateGallery.tsx` fails naming 6 of 9 while `/`, `/n8n-sync-history`
  and `/runtime-regression` still pass; mutating `globals.css` fails all 9; mutating
  `scripts/check-runtime-regressions.js` passes; an unreachable capture commit still fails
  and names the surface, degrading only the file list; and reverting each mutation returns
  the gate to green. A capture with no `sourceDigest` is rejected outright - it could never
  be shown to be stale - and the freshness lookup is a required argument, so "nobody
  checked" cannot be mistaken for "nothing was stale". `npm run surfaces:fingerprint`
  prints the current digests and deliberately never writes them, so a stale capture cannot
  be re-greened without editing the same block that holds the date and the method. All
  nine surfaces were re-probed at `8f72854` on 2026-08-16: 18 measurements, 0 clipped,
  probe self-proof alive. What this deliberately does **not** cover - npm dependency bumps,
  runtime/env-dependent content, `src/app/api/**` handlers reached by string URL,
  `next.config.mjs`, `public/` assets - is documented at the top of
  `scripts/surface-dependencies.ts`.

- **Closed four fail-open holes in the captured-surface gate (2026-08-13, #144)** -
  `scripts/derive-captured-surfaces.ts` validated that a manifest *entry* existed, not
  that a capture *decision* was valid. `CaptureDecision` is a compile-time union;
  `JSON.parse` returns `any`, so the `as CapturedSurfaceManifest` cast asserted a shape
  nothing checked. Four mutations of `docs/captured-surfaces.json` each exited **0**
  against the real repo with the unit suite green: (a) deleting an entry's `capture`
  field, (b) `capture: "excludedd"` - which also dodged the missing-reason check,
  because that check string-matched the exact literal `'excluded'` - (c) flipping every
  cockpit to `excluded` with `reason: "x"`, and (d) `capture: "required"` on a surface
  nobody had ever captured. A positive control (removing an entry outright) exited 1
  first, so the holes are not a dead probe. Every check now validates the parsed value
  at runtime and reports a stable problem `code`, so tests assert the specific reason
  rather than "something failed". Exclusions need a substantive `reason` (placeholders
  such as `"x"`/`"TBD"` rejected) plus an `excludedBy` tracking reference; `required`
  needs a `capturedAt` record naming a full 40-hex commit, an ISO date, the viewport
  labels covered, and the method used, or an explicit `captureDeferred` carrying a
  reason and an issue. A manifest that requires nothing now fails as `programme_empty`.
  The header comment claimed the gate "fails until someone records a capture DECISION"
  when it failed only until someone recorded an ENTRY; corrected. Re-run against the
  hardened gate, all four mutations exit 1 with their specific code, the unmutated
  manifest exits 0, and the resolved pre-push hook
  (`git rev-parse --git-path hooks/pre-push` -> `.git/hooks/pre-push`, `core.hooksPath`
  unset) blocks the push with `Push blocked (Node tests failed)`. 13 unit tests pass.

- **`/settings` clips 17 elements at 1440px (2026-08-13, #145)** - found by the first
  ever capture of a required-but-never-captured surface. Filed, not yet fixed.

### Added

- **Measured the six required surfaces nobody had ever captured (2026-08-13, #144)** -
  all 9 entries in `docs/captured-surfaces.json` were marked `capture: "required"` but
  only 3 had ever been captured, and the gate scored `required` + never-captured as
  passing. `npm run surfaces:probe` (`scripts/probe-surface-clipping.mjs`) now drives
  its route list from the manifest, so the probe cannot drift from the gate, and all 9
  surfaces carry a `capturedAt` record at both declared viewports. The probe measures
  **element-level** clipping and never document scroll: `globals.css` clamps
  `html, body` with `max-width: 100vw; overflow-x: hidden`, so an overflowing page
  reports zero document scroll and any probe reading `documentElement`/`body`
  `scrollWidth` is defeated by construction. Proven rather than assumed - injecting a
  1200px element into a 390px viewport moved `clippedElements` 0 -> 1 while
  `docOverflow` stayed 0px - and the probe exits 2 instead of reporting zeroes if the
  injection fails to move the count. Result at `e50e256`: 17 of 18 measurements clean;
  `/settings` clean at 390px but **17 clipped elements at 1440px**, rooted in the
  `RuntimeConfigTemplateGallery` env-diagnostic badges (#145). A prior report calling
  `/settings` a *mobile* defect ("body scrollWidth 504 vs 390, 4 clipped at 390px") did
  **not** reproduce: it measures 0 clipped and `body.scrollWidth` 390 == `clientWidth`
  390 at HEAD.

- **Adopted the canonical fleet motion primitive (2026-08-13, #142)** -
  `globals.css` now carries `fleet-motion-primitive` v1.0.0 verbatim from
  `agent-settings shared/assets/motion-primitive/motion.css`: four duration tokens,
  three easing tokens, and the two-layer `prefers-reduced-motion` contract. Nothing
  was re-derived; the app previously had **no motion tokens at all** and exactly one
  `motion-reduce:` utility in all of `src/`, against 50 animated and 481 transitioned
  elements on a single measured route. The tokens live on `:root` rather than in an
  `@theme` block because this app is Tailwind 3.4 - `@theme` is the v4 variant of the
  primitive and would be inert here - and `tailwind.config.ts` maps them to named
  `duration-fast` / `ease-standard` utilities so they are consumable rather than
  declared-and-unreferenced. Layer B of the contract is what makes the adoption a
  paste instead of a rewrite: it reaches the 481 call sites still using Tailwind's
  hardcoded `transition`, so those can migrate to tokens incrementally. Durations
  collapse to `0.01ms`, never `0`, because CSS Transitions Level 1 requires a
  non-zero combined duration before a transition is created at all - at `0s`
  `transitionend` never fires. Proven with the primitive's own recipe
  (`Test-ReducedMotionCollapse.ps1`), which reported `fail`/`tokens-missing` before
  this change and `pass` after.

- **Captured-surface list derived from the app's real routes (2026-08-13, #142)** -
  `docs/captured-surfaces.json` now records a capture decision for every route the
  app serves, and `scripts/derive-captured-surfaces.ts` derives that list from the
  App Router tree (`src/app/**/page.tsx`) plus the existing workspace registry
  (`GITHUB_PROJECT_WORKSPACE_MAPPINGS`) and fails when the two disagree. Wired into
  `npm test` as `test:captured-surfaces`. The surface list used by the UI/UX scoring
  programme had been a hand-maintained claim: `/workspace/frontend-revenue` shipped
  in `690a5fb` and never entered it, so the cockpit was scored without ever being
  looked at. On its first run the new gate found a second never-listed cockpit,
  `/workspace/memsys`. A newly added route now fails the check until someone records
  `capture: "required"`, or `"excluded"` with a reason.

### Fixed

- **Settings header reflows at phone widths (2026-08-13, #142)** -
  Found by measuring every derived route at 390px rather than only the route the
  issue named. The `/settings` header put its title group and its action group in one
  non-wrapping `justify-between` row: 504px of content in a 342px content box, 114px
  clipped with no scroller and no ellipsis. The row now wraps, so the actions drop to
  their own line. Same class of defect as the cockpit reflow below, on a route that
  fix did not touch - and the only route in the app still clipping at 390px.
- **Workspace cockpits reflow at phone widths (2026-08-13, #142)** -
  Below `lg` the board row stacked its two fixed-width rails (`w-64` + `w-80` =
  576px) beside the board inside a 390px viewport, which crushed `MissionQueue` to a
  0px content box: 1636px of board sat inside a 24px flex child, and the board was
  unreachable on a phone. The rails are now full-width bounded-height sections that
  return to side rails from `lg` up, the board carries `min-w-0`, and the header and
  queue toolbar shrink and wrap instead of clipping mid-word. The `agents` and
  `activity` sections got the same treatment. This is a WCAG 1.4.10 (Reflow) fix and
  it applies to every `/workspace/[slug]` cockpit, not only Frontend Revenue.
- **Cockpit headings have a role of their own (2026-08-13, #142)** -
  The cockpit rendered no `h1` at all outside its not-found state, so there was no
  top-level heading to carry hierarchy. The workspace name is now the route's `h1`,
  and `h1`-`h6` pick up an explicit weight and tracking role in `globals.css`. The
  role is expressed on the axes the already-chosen typeface provides - JetBrains Mono
  is loaded by `next/font/google` as a variable font across the 100-800 weight axis -
  rather than by introducing a second family, which would be a new typeface decision
  for the operator to make rather than an engineering fix.

- **Frontend Revenue cockpit workspace bound to GitHub Project #15 (2026-08-12, #140)** -
  Migration `021` seeds a `frontend-revenue` workspace mapped to
  `iMelki` project `#15` (Frontend Revenue Program 2026), the largest active
  project that had no local cockpit. The mapping is declared in
  `GITHUB_PROJECT_WORKSPACE_MAPPINGS` alongside its siblings and starts with
  `github_project_auto_refresh = 0`, matching the Asimtop precedent: a manual
  **Sync now** has to prove the mapping before any scheduled cadence.
  A new persistence test fails if a declared mapping is ever missing from - or
  drifts from - its migration seed, which closes the gap that let the code
  constant and the database disagree; the two partial-database migration tests
  in `tests/factory-webhooks.test.ts` now isolate themselves from every later
  migration rather than only from `020`. Verified against the live project: 266
  items scanned, 231 imported, 35 skipped (4 closed, the rest drafts/PRs), and
  the board at `/workspace/frontend-revenue` renders 231 real tasks across
  `content-factory`, `landing-page`, `mission-control-kanban`, `asimtop-landing`
  and 8 further repositories. No new UI component was written - the existing
  workspace board, banner, and dashboard cards render the workspace unchanged.

### Changed

- **Pinned bridge host compatibility to the reviewed Paperclip dev tip
  (2026-08-12, #47/#135)** - The installable bridge now requires clean owned
  Paperclip commit `aeff5ddaf25e861f2bbff5d5840be417866cae3a` and keeps the
  exact-SHA gate fail-closed when additive file attestations are present.
  Focused migration validation covers that exact host; installed signed
  ping/dispatch/receipt acceptance remains separately gated.

- **Migrated all six modal overlays onto the owned dialog primitives (2026-08-11, #139)** -
  `AgentModal`, `TaskModal`, `GitHubImportModal`, and the create-workspace form
  now render through the vendored shadcn/Radix `Dialog`, and the
  delete-workspace and live-GitHub-mutation confirms now render through
  `ActionReviewDialog`. Every modal gains `role="dialog"`, a title-bound
  accessible name, a focus trap, Escape-to-close, and focus return; the
  hand-rolled `fixed inset-0` overlays are gone. No new component was written -
  both primitives already existed in this repository - so five files left the
  component-sourcing baseline for
  `docs/preflight/records/2026-08-11-dialog-overlay-migration.md`. Deleting a
  workspace that still holds tasks or agents now explains the refusal in the
  dialog instead of greying out the confirm button, and `smoke:runtime-ui`
  proves the dialog semantics in a real browser.

### Fixed

- **Closed the four PR #137 review follow-ups on the factory bridge (2026-08-11, #136)** -
  Dispatch v2 refuses out-of-bounds work text before the canonical envelope is
  built, returning HTTP 400 (or dry-run blockers) that name the offending field
  instead of the envelope's opaque failure; the bounds live in
  `FACTORY_V2_WORK_CONTRACT_LIMITS` and are pinned to the canonical validator by
  test. `validateReceiptForMapping` now rejects `dispatch_version: 1` mappings
  before any Paperclip call, so a v2 receipt can no longer complete a v1
  dispatch by comparing `repositoryBaseSha` with itself.
  `validateWebhookCallbackPayload` accepts a caller-supplied
  `expectedReceiptIdentity` and no longer builds a self-referential expectation
  that always passed. The published v2 dispatch schema resolves the factory
  envelope from a local `$defs` entry with a stable `$id` instead of a mutable
  `agent-settings@dev` raw URL.

### Documentation

- **Refresh Paperclip bridge topology truth (2026-08-08, #47/#119/#127)** -
  Records that bridge PR #119 merged into `dev`, the canonical checkout is
  non-bare and aligned with `origin/dev`, and the remaining gate is installed
  runtime signed-ping/dispatch plus cross-surface receipt reconciliation.

### Added

- **Made factory envelopes canonical and receipt v2 authoritative (2026-08-09, #136)** -
  Dispatch v2 now embeds, validates, hashes, and persists the complete Agent
  Settings `factory-task-envelope.v1` before network I/O, while retaining
  exact-match snake_case aliases for installed-plugin compatibility. Lifecycle
  readback revalidates the stored envelope and digest. Historical receipt v1
  remains readable, but only receipt v2 with exact index, independent reviewer
  session, release-steward identity, remote `refs/heads/dev` SHA/tree readback,
  reconciliation, and privacy evidence can authorize Done. Receipt authority
  and canonical digest are stored on the dispatch attempt and activity/event
  records. The v2 builder now lives in a server-only module, while the webpack
  resolver maps NodeNext `.js` specifiers to their TypeScript sources so the
  shared plugin contract compiles in both the plugin and production app builds.

- **Adopt dnd-kit/shadcn for kanban, Card, and Tabs (2026-08-02, #48)** -
  `MissionQueue.tsx`'s kanban board now uses `@dnd-kit/core`/`@dnd-kit/sortable`
  instead of native HTML5 drag events (accessible keyboard reordering);
  `ui/Panel.tsx` re-exports shadcn `Card`; `WorkspaceSectionTabs.tsx` uses
  shadcn `Tabs`. Added `components.json`, `src/lib/utils.ts`,
  `src/components/ui/{card,tabs}.tsx`. Lint, build, and the full test suite
  (21/21) pass.

### Fixed

- **Moved GitHub Actions to native Node 24 releases (2026-08-09, #138)** -
  Upgrades checkout to v5.1.0, setup-node to v6.5.0, cache to v5.1.0, and
  upload-artifact to v6.0.0 across CI, Runtime Regression, and secret scan.
  Every external action reference is pinned to the reviewed release commit;
  existing Node inputs, permissions, cache keys, artifacts, retention, and
  failure semantics are unchanged. Replaces the maintenance-only
  `pre-commit/action@v3.0.1` composite after live annotation readback exposed
  its nested `actions/cache@v4`; explicit setup-python, cache, install, and run
  steps preserve its behavior using native Node 24 action releases. A focused
  workflow test now rejects mutable action refs, reviewed-pin drift, and
  reintroduction of that hidden Node 20 dependency.

- **Made Doctor schema discovery public and warning-level sync state visible (2026-08-09, PR #137)** -
  Publishes a versioned public distribution mirror of the canonical private
  `doctor-genome.v1` contract, points the repository genome at that reachable
  URI, and covers TypeScript component barrels such as
  `src/components/index.ts`. The workspace and n8n history views now render
  warning or unknown clean runs in amber as `Review needed`, preserve their
  message, and keep failed/error runs distinct in red.

- **Made Runtime Regression cleanup receipt-gated (2026-08-09, #46)** -
  The UI smoke now tracks partially created fixtures, deletes every temporary
  task and agent in unconditional teardown, and requires an exact-path `404`
  readback before reporting success. It emits the structured
  `mck.runtime-smoke-cleanup.v1` receipt into the uploaded artifact directory,
  fails on deletion/readback/receipt-write/browser-close errors, and preserves
  simultaneous UI and cleanup failures with an aggregate error. Added focused
  success, residual-agent, transport-failure, and deterministic-writer tests.
  Current-sha PR run `31296740445` and push run `31296738848` each uploaded a
  four-entity receipt proving DELETE `200` plus GET `404` for three tasks and
  one agent; issue #46 closed after exact artifact, comment, and state readback.

- **Made Paperclip host compatibility exact-SHA fail-closed (2026-08-08, #135)** -
  Host migration validation now requires the declared `testedCommit` to match
  the actual host even when partial file attestations are supplied. Added
  regression coverage for mismatched, missing, and malformed host metadata;
  file attestations remain additive evidence rather than a compatibility
  bypass.

- **Revalidated persisted bridge envelopes before reuse (2026-08-08, #136)** -
  JSONB/string envelopes loaded by correlation and issue mappings now pass
  through the canonical `parseDispatch` validator before orchestration. Malformed
  or owner-conflicting persisted contracts fail closed, with regression coverage.

- **Hardened bridge diagnostics and callback byte boundaries (2026-08-08, #136)** -
  Recursive diagnostic redaction now removes embedded URL queries, Bearer/HMAC
  signatures, and common API-key-shaped values from arbitrary failure strings.
  Callback intake rejects leading UTF-8 BOMs and non-canonical/invalid UTF-8
  before HMAC verification, preserving exact signed-byte semantics. Added
  focused Paperclip bridge and callback regression fixtures.
- Added a deterministic Paperclip workspace provisioner for the factory path:
  clean workspaces install the root and plugin lockfiles with lifecycle scripts
  disabled, rebuild only `better-sqlite3`, and expose the same exact argv as the
  first repository-manifest validation (`#124`). Repeated setup/validation calls
  now reuse a lockfile/runtime-bound marker and serialize Windows installs.
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
- Runtime UI smoke now waits for an explicit workspace-ready marker before
  asserting the Settings section, and emits bounded DOM diagnostics when the
  readiness contract is not reached (`#128`).
- The smoke follows the consolidated shadcn/Radix Tabs accessibility contract
  (`role="tab"`) for the workspace Settings and Board controls, preventing a
  stale `role="button"` selector from failing CI after the UI reuse merge.
- Task-card smoke assertions now scope to the direct list-item card root and
  visible card text to distinguish the dnd-kit reorder-handle button
  introduced by the same UI consolidation.
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
