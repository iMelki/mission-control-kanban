# Mission Control Kanban Open Tasks

Last updated: 2026-09-01

GitHub issues are the canonical task records for this repo. This root index is
the local operator entrypoint; historical task notes remain in
`docs/OPEN_TASKS.md`.

## Active

- [#166 - cockpit loads can stick in a false pre-data board and present it as settled](https://github.com/iMelki/mission-control-kanban/issues/166)
  - 2026-08-31 gauntlet: ~3/13 cockpit loads painted "Showing 0/0", "No events
    yet", "No token detected · 0/3 lanes ready", and header ONLINE as settled
    fact. No console errors, no retry.
  - **2026-09-01 Wave 2:** pending vs empty-after-load split, loading shell,
    GitHub null-as-checking, SSE no longer writes the OpenClaw badge, 10s
    fetch budget, `data-workspace-ready` only when the board is ready.
    Regression: `npm run test:cockpit-load-state`. Live 13/13 on a production
    side-serve (not :3021) with `stuckCount` 0.

- [#164 - the capture harness cannot survive its own subject: the dev server dies under on-demand compile](https://github.com/iMelki/mission-control-kanban/issues/164)
  - `next dev` first-hit compiles measured at 15-54 s per route; the process
    exited while compiling the 4th consecutive one. The LocalNext watchdog then
    failed recovery twice at a **300-second ceiling**, and one post-boot attempt
    failed with "root was not found" because the repo volume was not mounted yet.
  - Removed at the source, not worked around: `next build` + `next start` from a
    detached worktree answers 200 on 11 of 11 routes in 18-161 ms and stays up.
    Evidence and the reproduce steps: `docs/production-capture-2026-08-26.md`.
  - **Harness harden 2026-08-27:** `scripts/assert-production-capture-target.mjs`
    plus both surface probes refuse port 3021 *without fetching it*, require
    `MCK_BASE_URL` and a production BUILD_ID, and refuse next-dev HTML. Operator
    path: `docs/production-capture.md`. Not a gauntlet score.
  - Still needed for a surviving scored capture: serve from a detached worktree
    (`next build` / `next start` on 3121), then re-run the probes. The
    `capturedViewports` narrowing that blocked `next build` is now on `dev`.

- [#165 - two served workspace routes are invisible to both captured-surface gates](https://github.com/iMelki/mission-control-kanban/issues/165)
  - `/workspace/default` and `/workspace/mck-sync-test-assistants` both answer
    200, both are linked from the dashboard, and neither is in the manifest.
    Both gates derive from committed source; **neither reads the workspaces
    table**, so nothing raises. `mck-sync-test-assistants` ships from migration
    011, so this is not test residue.
  - The config `$comment` also names the wrong gate; proven with controls.
  - **Do not "fix" this by adding the slugs to the config** - that greens the
    gate and deletes the only signal.

- [#150 - focus:outline-none without a focus-visible ring: 18 of 4192 Tab-reachable controls, plus 40 of 40 arrow-key ones](https://github.com/iMelki/mission-control-kanban/issues/150)
  - First ever keyboard/focus/contrast/axe measurement landed:
    `scripts/probe-surface-a11y.mjs` plus `docs/a11y-baseline-2026-08-24.md`.
  - **The "58 of 208" figures were measured over 4.9% of the app** and were
    restated on 2026-08-25 (#156). At 99.9% coverage it is **18 of 4192**, and
    those 18 are only TWO distinct call sites: the four `/settings` inputs that
    share one className (8 of the 18, one edit) and the cockpit `Board` control
    (10). The old `208/208 focus unobscured` is **withdrawn** entirely - it
    measured the probe's own scroll state, not the app (#155).
  - Plus **40 of 40** roving `tabindex="-1"` cockpit tab controls
    (Agents/Dispatch/Settings/Activity, five cockpits, both viewports), which no
    earlier run could reach at all (#154).
  - All of them are one defect: `focus:outline-none` with no
    `focus-visible:ring-*`. The repo already uses the correct pattern in 9 of
    its 40 `focus:outline-none` sites, so the fix extends an existing
    convention rather than inventing one. The sites in modals and dialogs are
    **unmeasured, not clean** - the probe does not open them.
  - **Blocked on a coordinated change, not on a decision:** any `src/` edit
    moves `sourceDigest` and invalidates existing clipping captures. Proven
    with a control (one `aria-label` in `Header.tsx` produced
    `captured-surface drift: 6 problem(s) across 9 derived route(s)`, then
    reverted). Landing the fix also means re-probing and re-recording
    `capturedAt` for the affected surfaces.

- a11y probe follow-ups, opened 2026-08-24 and worked 2026-08-25:
  - [#154](https://github.com/iMelki/mission-control-kanban/issues/154) roving
    `tabindex="-1"` children never focus-audited - **implemented**: a separate
    arrow-key pass reaches all 40 (`rovingEnumeratedNotAudited: 0`) and every
    one of them fails.
  - [#155](https://github.com/iMelki/mission-control-kanban/issues/155) 960
    controls off-viewport at mobile - **not a UI defect**: a probe artifact,
    refuted with three controls over 157 failures. Occlusion is now measured on
    the control's visible rect and the detector has self-proof legs for the
    first time.
  - [#156](https://github.com/iMelki/mission-control-kanban/issues/156) restate
    #150 - **done**, above.
  - [#157](https://github.com/iMelki/mission-control-kanban/issues/157) two
    self-proof legs compare whole-page axe node counts and fail closed about
    half the time; a full sweep needed 4 attempts. **Open.**
  - [#159](https://github.com/iMelki/mission-control-kanban/issues/159) the
    coverage reporter scores a surface that rendered ZERO controls as `full` at
    100%, and ignores its own `unaccounted` invariant (observed at `-1`). The
    "99.9% coverage" headline is not reproducible: 99.9% / 92.7% / 88.7% on the
    same surface, same unmodified code, one session. **Open.**

- [#151 - Three colour pairs below WCAG AA, worst 2.87:1](https://github.com/iMelki/mission-control-kanban/issues/151)
  - 10px timestamps using `text-mc-text-secondary/60` (2.87:1), the n8n status
    line (3.43:1), and the `OFFLINE` badge (4.04:1). Contrast is computed from
    computed style, not from hand-authored annotations.
  - **2026-09-01:** timestamp class landed at the token/class level
    (`text-mc-text-muted` solid `#8b949e`, sRGB >=4.5:1 on the real card and
    column backdrops). **2026-09-01 leftover:** n8n default line dropped
    `/70` (`text-mc-text-secondary` solid, fixture 5.62:1). OFFLINE badge
    fill is `bg-mc-bg` (live 5.65:1 on `:3123`). Source no longer contains
    the 3.43 / 4.04 classes.

- [#152 - 45 axe WCAG violations including one critical](https://github.com/iMelki/mission-control-kanban/issues/152)
  - `nested-interactive` (692 nodes, workspace task cards), `color-contrast`,
    `scrollable-region-focusable` (tables with no keyboard scroll access),
    `link-name` (icon-only header link), and critical `aria-valid-attr-value`
    (Radix Tabs `aria-controls` pointing at an unmounted panel).
  - Smallest first: `link-name` and `scrollable-region-focusable` are one
    attribute each.

- [#153 - Bind a11y evidence to the captured-surfaces staleness gate](https://github.com/iMelki/mission-control-kanban/issues/153)
  - Deliberate decision: a11y evidence rides the **existing**
    `capturedAt.sourceDigest` rather than a second mechanism. Not yet wired,
    so today's baseline is point-in-time, not enforced.
  - Also carries the `a11y:probe` / `a11y:selfproof` npm scripts, deferred
    because `package.json` had another in-flight change in the working tree.
  - Should land after the `scripts/captured-surfaces/` canonical migration
    settles, so the check is not written twice.

- [#142 - Frontend Revenue cockpit reflow and heading role](https://github.com/iMelki/mission-control-kanban/issues/142)
  - Reflow and heading-role fixes are landed and browser-proven; the derivable
    captured-surface gate (`docs/captured-surfaces.json`,
    `scripts/derive-captured-surfaces.ts`, `npm run test:captured-surfaces`) is
    wired into `npm test`.
  - **Open, operator decision:** the issue's acceptance criterion asks for a
    computed `font-family` on `h1` that differs from body. The app has chosen
    exactly one typeface (JetBrains Mono, loaded as a variable font by
    `next/font/google`). Satisfying that criterion literally means adopting a
    second family, which is a typeface decision rather than an engineering fix.
    Shipped instead: a weight and tracking heading role on the existing family,
    per the issue's own stated alternative. Adopting a display family remains
    available if the operator wants it.
  - Resolved by #144: `/workspace/memsys` and the other five never-captured
    required surfaces are now measured and carry `capturedAt` records.

- [#144 - Captured-surface gate is fail-open](https://github.com/iMelki/mission-control-kanban/issues/144)
  - Landed: runtime validation of the parsed manifest closes all four holes
    (missing `capture`, misspelled value, blanket `excluded` with a placeholder
    reason, and `required` + never-captured). Each has a negative fixture
    asserting its specific problem `code`, and each was re-run against the real
    repo to confirm it exits 1.
  - Wired on the free local layer only: `npm test` -> `test:captured-surfaces`
    plus `surfaces:check`, reached by `.git/hooks/pre-push` via git-toolkit
    `pre-push-quality.ps1`. No CI job was added. Reachability confirmed with
    `git rev-parse --git-path hooks/pre-push` (`core.hooksPath` unset).
  - Landed in `a9a274c` on `origin/dev`; closed. Duplicate report #146 was
    self-closed by its author.
  - Open follow-up, tracked as #147: a `capturedAt` record can go stale
    silently. The gate checks that a capture happened, not that it happened at a
    commit that still reflects the surface. A staleness ratchet (re-capture
    required when a surface's own source changes after `capturedAt.commit`) is
    the next step, and belongs in the same free pre-push layer.

- [#147 - Captured-surface gate accepts a stale capture](https://github.com/iMelki/mission-control-kanban/issues/147)
  - Follow-up to #144 and the known remaining hole in it. `capturedAt` is never
    invalidated, so a surface can drift back to unmeasured while the gate stays
    green - the original #142 failure shape, one level up.
  - Confirmed by control before fixing: with the tree clean `surfaces:check`
    exited 0; appending a comment to `src/app/settings/page.tsx` and re-running
    it exited 0 again, still citing the pre-change `capturedAt`. The same held
    for `src/components/RuntimeOpsSettings.tsx`.
  - It was already live, not hypothetical. `5b846ce` changed
    `src/app/globals.css`, which the root layout imports and every surface
    renders through, yet 8 of the 9 surfaces still cited the pre-change
    `e50e256` and the gate stayed green.
  - Landed: `capturedAt.sourceDigest`, a 16-hex content fingerprint over the
    transitive static local-import closure that renders each surface, resolved
    by `scripts/surface-dependencies.ts` and recomputed by the gate. Content,
    not ancestry, so a rebase or re-land producing identical files keeps a
    capture valid. Deliberately NOT a whole-repo hash: 35% of the last 60
    commits touch the dependency union (61 of 133 `src/` files), 7% touch a
    global file that invalidates all nine.
  - Known blind spots, documented at the top of
    `scripts/surface-dependencies.ts`: npm dependency bumps
    (`package-lock.json` is excluded on purpose), runtime/env-dependent content,
    `src/app/api/**` handlers reached by string URL, `next.config.mjs`, and
    `public/` assets.
  - All nine surfaces re-probed at `8f72854` on 2026-08-16 against the running
    dev server: 18 measurements, 0 clipped, probe self-proof alive (injection
    moved clipped 0 -> 1 while document overflow stayed 0).
  - Wired on the same free local layer as #144: `npm test` ->
    `test:captured-surfaces` plus `surfaces:check`, reached by
    `.git/hooks/pre-push`. No CI job added.

- [#148 - Root type errors are ungated: no `typecheck` script, and `tsc --noEmit` is already failing](https://github.com/iMelki/mission-control-kanban/issues/148)
  - Found while working #147, pre-existing and NOT introduced by it:
    `npx tsc --noEmit` at the repo root reports
    `scripts/derive-captured-surfaces.ts ... TS18046: 'record.viewports' is of
    type 'unknown'`. Proven pre-existing by restoring the HEAD version of that
    file and re-running `tsc` - the same error appears at its old line number.
  - Nothing runs it: `package.json` has no `typecheck` script, and the only
    `npm run typecheck` in `.github/workflows/ci.yml` is inside the
    `paperclip-bridge` job with `working-directory: integrations/paperclip-bridge`.
    Filed separately rather than fixed inline, to keep #147 to one concern.

- [#145 - /settings clips 17 elements at 1440px](https://github.com/iMelki/mission-control-kanban/issues/145)
  - Live shipped defect, found by the first ever capture of `/settings`. Rooted
    in `RuntimeConfigTemplateGallery.tsx:61`: an env-diagnostic badge is a single
    unbreakable token wider than its grid column, with no `min-w-0`, no
    `break-all`, and no ellipsis. Desktop-only; 390px measures clean.
  - Not fixed. Invisible to page-level probes because `globals.css` clamps
    `html, body` with `max-width: 100vw; overflow-x: hidden`.

- [#141 - Scheduled n8n sync carries a hardcoded workspace list](https://github.com/iMelki/mission-control-kanban/issues/141)
  - Follow-up from #140. Every recorded run in `n8n_sync_runs.workspaces` is
    `["assistants","memsys","content-factory","asimtop"]`, and it includes
    `asimtop` despite `github_project_auto_refresh = 0`, so the list is
    n8n-side and is not derived from the `workspaces` table.
  - `frontend-revenue` therefore refreshes only through the manual **Sync now**
    control until the workflow is changed inside the n8n instance.
  - Recommended: have the workflow read project-backed workspaces from
    `GET /api/workspaces` and gate inclusion on `github_project_auto_refresh`,
    so a new workspace joins the cadence by existing rather than by hand-edit.

- [#136 - Make bridge contracts v2-authoritative and byte-safe](https://github.com/iMelki/mission-control-kanban/issues/136)
  - Bounded byte-safety/redaction slice completed on 2026-08-08: diagnostic
    strings now recursively scrub embedded URL queries, Bearer/HMAC signatures,
    and common API-key-shaped values; callback intake rejects leading UTF-8 BOMs
    and non-canonical/invalid UTF-8 before signature verification.
  - Focused regression coverage passes in the Paperclip bridge plugin and MCK
    factory callback tests. Persisted JSONB envelopes are now revalidated by
    the canonical `parseDispatch` path before correlation reuse or issue lookup;
    malformed persisted contracts fail closed.
  - Canonical contract slice completed on 2026-08-09: dispatch v2 validates and
    persists the complete Agent Settings `factory-task-envelope.v1` plus its
    canonical digest before network I/O, then revalidates/hash-checks the stored
    envelope for lifecycle readback. Receipt v1 remains readable but cannot
    complete; only receipt v2 with exact index, independent session, release
    steward, remote `dev` SHA/tree, reconciliation, and privacy authority moves
    a task to Done.
  - Remaining issue gate: prove the upgraded contract through the installed
    Paperclip host and live MCK/Mission Control reconciliation under #47 after
    the separately tracked exact host-SHA gate in #135 is refreshed.
  - CodeRabbit PR #137 follow-ups (recorded 2026-08-10, non-trivial; each links
    the source review comment). All four are implemented on `dev`
    (2026-08-11); each carries its own regression coverage:
    - DONE — dispatch length pre-validation: `FACTORY_V2_WORK_CONTRACT_LIMITS`
      and `validateFactoryV2WorkContract` in `src/lib/dispatch-contract.ts`
      mirror the canonical envelope bounds (title 8-240, acceptance 8-1000,
      test 3-500, rollback 8-1000, 64-entry lists). Both v2 dispatch paths in
      `src/lib/dispatch-adapters.ts` refuse out-of-bounds text before the
      envelope is built — live dispatch returns HTTP 400 naming the field, the
      dry run returns the same blockers. v1 dispatch and the default
      `validateDispatchMetadata` behaviour are unchanged; the opt-in is
      `{ factoryDispatchVersion: 2, taskTitle }`. A test pins the mirror to
      `validateCanonicalFactoryTaskEnvelope` so the two cannot drift
      ([comment](https://github.com/iMelki/mission-control-kanban/pull/137#discussion_r3744190577)).
    - DONE — v1-mapping rejection: `validateReceiptForMapping` in
      `integrations/paperclip-bridge/src/worker.ts` now throws before any host
      call when `mapping.dispatch_version !== 2` or the persisted envelope is
      v1, so a v2 receipt can no longer complete a v1 dispatch by
      self-comparing `repositoryBaseSha`. Covered by the new
      `integrations/paperclip-bridge/tests/receipt-mapping.spec.ts`, whose
      context proxy fails the test if Paperclip is touched at all
      ([comment](https://github.com/iMelki/mission-control-kanban/pull/137#discussion_r3744190580)).
    - DONE — self-referential expected identity: `validateWebhookCallbackPayload`
      accepts `{ expectedReceiptIdentity }` and forwards it to
      `validateBridgeReceipt`; the self-derived `expected` object is gone, so
      omitting the identity no longer implies a check that never runs. Five
      wrong-identity permutations now reject and the bound identity passes.
      The agent-completion route keeps its own binding in `lifecycleRejection`
      (it reads the persisted attempt after payload validation), so the new
      parameter is currently the reusable path for other callers rather than a
      second enforcement point
      ([comment](https://github.com/iMelki/mission-control-kanban/pull/137#discussion_r3744190622)).
    - DONE — remote `$ref`: the published v2 schema now defines the envelope at
      `#/$defs/factory_task_envelope` with the stable `$id`
      `https://mission-control-kanban.local/schemas/factory-task-envelope.v1.json`,
      carrying the same work-contract bounds. A test asserts every `$ref` in the
      published document is a local JSON Pointer and that
      `raw.githubusercontent.com` no longer appears
      ([comment](https://github.com/iMelki/mission-control-kanban/pull/137#discussion_r3744190626)).


- [#47 - Build the signed MCK ↔ Paperclip software-factory bridge](https://github.com/iMelki/mission-control-kanban/issues/47)
  - Status: implementation PR #119 merged into `dev` on 2026-08-04 at merge
    commit `246cd82ad95a23347bf50087f8ed5299bdc63a89`. PR #137 follow-ups are
    present on remote `dev` at `893918e95e98dc61147c8cea1483d2757a8d9255`;
    issue #46 is closed with natural Runtime Regression and cleanup receipts,
    so it is no longer a scheduler gate for this bridge.
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
  - Independent review is conditional for source/CI, not release acceptance.
    MCK #135 tracks partial host-SHA attestation; MCK #136 tracks v2-authority,
    canonical-envelope validation, recursive redaction, and byte-preserving
    callback verification. Remaining closure evidence: install into the owned
    Paperclip runtime, prove a signed health ping and real dispatch, reconcile
    the returned receipt across control surfaces, and read back the resulting
    Paperclip/MCK receipts. The #127 owner-map gate is resolved with hash parity;
    do not replace the canonical checkout unless topology regresses.
  - Host compatibility is now fail-closed on the exact `testedCommit` even
    when a partial `testedFiles` attestation is present; the mismatch case is
    covered by `tests/host-compatibility.spec.ts`. The package metadata and
    focused migration proof now match clean, owned Paperclip `dev` commit
    `aeff5ddaf25e861f2bbff5d5840be417866cae3a`. This clears the source
    compatibility gate only. Live acceptance remains blocked by Paperclip's
    unmerged reproducible-lock review, unintegrated Job Object custody for both
    local launch paths, absent governed signing-secret bindings and configured
    webhook agents, stopped local services, plugin installation, signed health
    ping, one real dispatch, and the reconciled end-to-end receipt.
  - Post-runtime UI acceptance: add a `Factory custody & signed-bridge
    readiness` section only after the runtime gates clear. Reuse MCK's existing
    Radix/TanStack/Card composition and `ActionReviewDialog` with zero new
    packages; show secret-safe booleans and freshness, link to
    `/runtime-regression`, and route consequential actions through the review
    dialog. Require desktop/mobile, keyboard, axe, RTL, and reduced-motion
    proof before acceptance.

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
  - PR #137 review follow-up publishes a reachable public Doctor v1 schema
    mirror, restores TypeScript component-barrel coverage, and renders clean
    warning/unknown n8n runs as amber `Review needed` states with their message
    visible instead of presenting them as green success.
  - Validation: `npm run lint`, `npm test`, `npm run build`, `npm run doctor:react`, `npm run smoke:runtime-ui`, and `npm run comment:runtime-artifacts -- --dry-run`.
  - Research basis: local MCK primitives, Component Marketplace, MemSys/Paperclip UI patterns, shadcn/ReUI/TanStack/Radix dashboard/form/table patterns, Tremor/Recharts chart guidance, React Flow/Dagre dependency graph guidance, GitHub Actions artifact REST API guidance, GitHub Security Lab `workflow_run` cautions, and Next.js output-file-tracing guidance.

## Recently Completed

- [#140 - Cockpit misses GitHub Project #15 (Frontend Revenue Program)](https://github.com/iMelki/mission-control-kanban/issues/140)
  - Decision: project #15 belongs in MCK. Migration `021`
    (`add_frontend_revenue_project_workspace`) seeds the `frontend-revenue`
    workspace through the sanctioned `008`/`012` path, and the mapping is
    declared in `GITHUB_PROJECT_WORKSPACE_MAPPINGS`.
  - Auto-refresh starts off (Asimtop precedent) so the scheduled n8n cadence
    only picks the workspace up after an operator flips the flag. The n8n
    workflow keeps its own slug list inside the n8n instance, so adding it
    there stays a separate operator-approved change.
  - Proof: dry-run and applied sync both report 266 scanned / 231 imported /
    35 skipped / 0 errors against `iMelki` project #15;
    `/workspace/frontend-revenue` renders 231 tasks; `_migrations` records
    `021` applied.
  - A new persistence regression test fails when a declared workspace mapping
    is missing from - or drifts from - its migration seed, and the two
    partial-database migration tests in `tests/factory-webhooks.test.ts` now
    isolate themselves from every later migration instead of only `020`.
  - Empty-legacy-project cleanup (nine 0-item projects) stays out of scope and
    unswept, as recommended in the issue.

- [#138 - Upgrade GitHub Actions to native Node 24 runtimes](https://github.com/iMelki/mission-control-kanban/issues/138)
  - Replaced every direct Node-20-backed `actions/checkout@v4`,
    `actions/setup-node@v4`, `actions/cache@v4`, and
    `actions/upload-artifact@v4` reference across CI, Runtime Regression, and
    secret scan with an official native-Node-24 release pinned to its reviewed
    commit SHA.
  - Fresh annotation readback then exposed `pre-commit/action@v3.0.1`'s nested
    `actions/cache@v4`. CI now reproduces that maintenance-only composite's
    install/cache/run steps explicitly with pinned native-Node-24
    `setup-python@v6.3.0` and `cache@v5.1.0`, preserving the upstream cache key
    and `pre-commit --all-files` behavior without the hidden Node 20 action.
  - Preserved application Node versions, workflow permissions, dependency
    caching, artifact names/retention, and runtime failure behavior. Official
    release/tag and commit-signature readback is recorded in #138; closure
    requires fresh PR and `dev` workflow proof without a forced Node 20
    annotation.
  - A focused regression test now rejects mutable external-action refs,
    pin drift for the reviewed native-Node-24 actions, and reintroduction of
    the maintenance-only pre-commit composite.

- [#46 - Make Runtime Regression JSON fixture reads deterministic](https://github.com/iMelki/mission-control-kanban/issues/46)
  - Closed on 2026-08-09 after the production standalone runner removed the
    Next.js development-manifest race and natural scheduled run `31243549448`
    passed on the exact PR #42 merge SHA.
  - Commit `546ae8c` added blocking `mck.runtime-smoke-cleanup.v1` receipts.
    Current-sha PR run `31296740445` and push run `31296738848` independently
    proved all three temporary tasks and the runtime agent deleted with HTTP
    `200`, then absent with exact-path GET `404`; each uploaded four screenshots.
  - Validation: focused cleanup tests `5/5`, complete `npm test`, lint,
    production build, normal commit/push hooks, deep secret scan, remote SHA
    readback, and exact closeout-comment/state readback all passed.

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

## Active GitHub Issues

- [#139 Expand UI/UX Awwwards report (2026-08-09) into practical tasks](https://github.com/iMelki/mission-control-kanban/issues/139)
  - Fleet-wide code-only audit scored this app 4.9/10 against the shared
    Awwwards rubric. Full report: `docs/uiux-awwwards-report-2026-08-09.md`.
    Scores are code-inspection estimates pending a Frontend Proof Bundle.
    Fleet rollup: iMelki/agent-settings#586.
  - **Not gauntlet-scored (2026-08-27).** The original audit was code-only.
    Later browser rounds either measured a dying `next dev` (#164) or a
    production build that still refused 5 of 18 units and wrote no
    frontend-sota scorecard. Capture probes now refuse 3021. See
    `docs/production-capture.md`.
  - **2026-08-28 closeout:** still **unscored**. Do not GET or steal
    `3021`. Production `next start` on `3121` only; no worktree. Note:
    `S:\source\CCAI\Assistants\agent-settings\shared\catalog\frontend-sota-fleet-uiux-closeout-2026-08-28.md`.
  - **2026-09-01 first production gauntlet: 14/21** on `127.0.0.1:3121`
    `next start`, SHA `74f671740019e26a540405bcfe52f1e6a83d900e`,
    BUILD_ID `S8HgxCEJWRAGRBloUGmn1`. Receipt:
    `docs/frontend-sota-gauntlet-2026-09-01/scorecard.md`. The
    2026-08-31 14/21 card was `next dev` on `:3021` and is not this row.
    This SHA predates Wave 2 (`5dff835`). Goal stays open. Wave 3 not
    started. Do not close this issue.
  - DONE 2026-08-11 — dialog semantics: all six hand-rolled `fixed inset-0`
    overlays moved onto primitives this repo already owned. `AgentModal`,
    `TaskModal`, `GitHubImportModal`, and `WorkspaceDashboard`'s
    create-workspace form now use the vendored shadcn/Radix `Dialog`
    (`DialogTitle` names each one, `DialogClose` owns the header X);
    `WorkspaceDashboard`'s delete-workspace confirm and
    `GitHubIssueDraftPanel`'s live-mutation confirm now use
    `ActionReviewDialog` (destructive tone, and typed confirmation preserving
    the exact server-issued phrase). `grep "fixed inset-0" src` returns only
    `src/components/ui/dialog.tsx`; no new component file was created, and the
    five migrated files left `docs/preflight/component-baseline.json` for the
    record `docs/preflight/records/2026-08-11-dialog-overlay-migration.md`.
  - Delete-workspace refusal is now explained rather than silently disabled:
    a workspace holding tasks or agents states the count and refuses in the
    dialog instead of greying out the confirm button.
  - `npm run smoke:runtime-ui` now asserts `role="dialog"` on the primitive's
    own slot and closes the agent and task modals with Escape. Radix
    deliberately does not emit `aria-modal`; modality comes from its focus
    scope plus `aria-hidden` on siblings. Live readback on 127.0.0.1:3021:
    `role="dialog"`, `aria-labelledby` bound to the title, focus inside the
    dialog, Escape closes, desktop and mobile screenshots captured, no
    non-whitelisted console errors.
  - Still open from the report: the rest of the 156 raw emerald/amber/rose
    usages, the bespoke n8n-sync-history table, and a11y follow-ups
    #150 / #151 / #152. next/font (JetBrains Mono), heading role, reduced
    motion, one-accent board CTAs, skip link, and instant sidebar width
    are landed; see the 2026-08-27 note below.
  - **UI lift 2026-08-27 (not gauntlet-scored).** One-accent CTAs
    (`New Task` filled `mc-accent`, `Import GitHub` outline), skip link
    (WCAG 2.4.1), instant sidebar width toggle, `mc-success`/`mc-warn`/
    `mc-danger` on the worst pill maps, dashboard skeleton instead of a
    spinner wall. Reduced-motion contract was already in `globals.css`.
    JetBrains Mono remains the only typeface. Evidence:
    `docs/uiux-awwwards-lift-2026-08-27.md`. Composite **UNMEASURED / 5.7
    carried** — no production-build capture this pass.
