# Production-build capture - 2026-08-26

Current operator rule: `docs/production-capture.md`. This file is the dated
evidence for the first production-build measurement. Capture probes now refuse
port 3021 before navigating.

The first time this app has been measured off `next dev`.

Every UI/UX round before this one measured Mission Control Kanban against a
development server, and the development server does not survive being measured:
it died while compiling the 4th consecutive on-demand route, and its supervisor
then failed to bring it back twice in a row. That is recorded as
[#164](https://github.com/iMelki/mission-control-kanban/issues/164). This
document is the run that removed the cause instead of working around it.

Commit measured: `c3bfc6fd0adca1040736ee0721eac0de70769935` (`dev`).

## How to reproduce this run

The supervised checkout serves `next dev` on port 3021 and is owned by the
LocalNext scheduled task. Nothing here touches it. The build happens in a
throwaway detached worktree, on the same drive as `node_modules` (a junction
across drive letters makes webpack emit an unresolvable `./S:/...` request), and
is served on a port this run owns.

    git worktree add --detach <scratch>/mck-prod c3bfc6f
    mklink /J <scratch>/mck-prod/node_modules <repo>/node_modules      # same volume
    copy .env .env.local mission-control.db* into the worktree
    npx next build --webpack
    npx next start -H 127.0.0.1 -p 3121

`next build` does not currently succeed on `dev`: it fails type-checking at
`scripts/derive-captured-surfaces.ts:426` (`'record.viewports' is of type
'unknown'`). That is [#148](https://github.com/iMelki/mission-control-kanban/issues/148),
and the fix already exists off `dev` as commit `8a3b2c7` on
`origin/feature/a11y-focus-proof-150`. That single hunk was applied to the
scratch worktree to produce this build and was deliberately **not** committed
here, so the branch that authored it keeps it.

**`.next/BUILD_ID` = `LhwzqpkXyePprPbNMSBmo`.** An absent BUILD_ID made a build
unverifiable elsewhere in this fleet; this one is verified present before any
number below was taken.

## Dev-mode compile cost versus production

Sequential first-hit warm, same order, one process, nothing pre-warmed. Dev
figures are the earlier lane's measurement on 3021; production figures are this
run on 3121.

| route | `next dev` first hit | `next start` first hit |
| --- | --- | --- |
| `/` | 824 ms | 54 ms |
| `/n8n-sync-history` | 22,898 ms | 20 ms |
| `/runtime-regression` | 53,880 ms | 18 ms |
| `/settings` | 15,045 ms | 23 ms |
| `/workspace/assistants` | **process died** | 161 ms |
| `/workspace/memsys` | not reached | 28 ms |
| `/workspace/content-factory` | not reached | 32 ms |
| `/workspace/asimtop` | not reached | 29 ms |
| `/workspace/frontend-revenue` | not reached | 38 ms |
| `/workspace/default` (undeclared) | not reached | 23 ms |
| `/workspace/mck-sync-test-assistants` (undeclared) | not reached | 26 ms |

11 of 11 answered 200 and the server stayed up. Worst route improves ~3,000x.

## Measurement rules this run applied

- Overflow signal is `body.scrollWidth - body.clientWidth`.
  `document.scrollingElement` is a dead detector on this app and is recorded but
  decides nothing. **Proven in this run, on this app:** injecting a 2000px
  element on `/` at 390px moved `bodyOverflow` 0 -> 3450px while the
  `documentElement` detector stayed at 0.
- Element count is retired as a loaded-content discriminator. Rendered text
  length plus a content assertion is the discriminator; element count is
  recorded and judges nothing.
- Positive control ran **on the actual page in this actual run**, before any
  zero was trusted: baseline `clipped=0`, after injection `clipped=1`. The
  probe's own 19-leg self-test also passed 19/19 immediately before the sweep.
- `sr-only focus:not-sr-only` skip links are a WCAG feature. They are excluded
  from target-size scoring and counted, never reported as 2.5.8 failures.
- WCAG 2.5.8 is the 24x24 AA criterion (with the spacing and inline
  exceptions); 2.5.5 is the 44x44 AAA criterion. Both are reported separately
  below and it is stated which was met.
- Contrast coverage is stated as a percentage of the population. Absence of
  measurement is not a pass.
- A surface that redirected onto another attempted surface would be excluded as
  a duplicate redirect. **None did:** every recorded capture has
  `finalPath == requestedPath`, so the denominator is 9 distinct rendered views.

## Capture result: 13 of 18 route x viewport units verified, 5 refused

Canonical probe (`shared/assets/captured-surface-manifest/probe-captured-surfaces.mjs`),
4 runs at one commit, both declared viewports, against the production build.

Accepted - identical rendered text length on all four runs, zero clipped
elements at both viewports, `finalPath == requestedPath`, no skeleton markers:

| surface | elements | text | settle | 4-run text lengths | clipped |
| --- | --- | --- | --- | --- | --- |
| `/` | 577 | 2,115 | 833 ms quiescent | 2115 / 2115 / 2115 / 2115 | 0 |
| `/runtime-regression` | 52 | 696 | 851 ms quiescent | 696 x4 | 0 |
| `/settings` | 280 | 3,790 | 864 ms quiescent | 3790 x4 | 0 |
| `/workspace/assistants` | 13,886 | 103,943 | 1,988 ms quiescent | 103943 x4 | 0 |
| `/workspace/memsys` | 5,210 | 42,242 | 1,408 ms signature-stable | 42242 x4 | 0 |
| `/workspace/content-factory` | 1,449 | 8,355 | 1,238 ms quiescent | 8355 x4 | 0 |

Refused - the probe would not vouch for these, so no capture record was emitted:

| unit | refusal | text length across the 4 runs |
| --- | --- | --- |
| `/n8n-sync-history` @ mobile | `liveness_unstable_across_runs` | 270 / 6961 / 270 / 6961 |
| `/n8n-sync-history` @ desktop | `liveness_unstable_across_runs` | 303 / 6994 / 6994 / 6994 |
| `/workspace/asimtop` @ mobile | `liveness_unstable_across_runs` | 7544 / 7514 / 858 / 876 |
| `/workspace/frontend-revenue` @ mobile | `liveness_skeleton` | 59240 / 59240 / 867 / 1065 |
| `/workspace/frontend-revenue` @ desktop | `liveness_unstable_across_runs` | 933 / 59174 / 58868 / 933 |

For comparison, the same probe on the **dev** server at an earlier commit
disagreed on 6 of 18 units and, on one of them, passed a 98.5% content loss as
healthy. Production removes most of that. It does not remove all of it.

### The 5 refusals are not the app failing to render

Re-measured with a fixed 7-second wait instead of the settle heuristic, 6 loads
per unit, same server:

| unit | 6 loads | verdict |
| --- | --- | --- |
| `/n8n-sync-history` @ mobile | 6961 x6 | full content every time |
| `/n8n-sync-history` @ desktop | 6994 x6 | full content every time |
| `/workspace/asimtop` @ mobile | 5298 x6 | stable |
| `/workspace/frontend-revenue` @ mobile | 56519 / 58847 / 56519 / 56519 / 56469 / 56519 | +-2% |
| `/workspace/frontend-revenue` @ desktop | 56587 / 56587 / 56587 / 58915 / 56587 / 56537 | +-2% |

Zero failing API responses and zero page errors in all 30 loads.

So the low readings are a **settle-detector false positive**, not a broken
surface. These pages have a quiet window before their data arrives, and the
content signature holds still through it, so "stable" fires on the pre-data
state. Captured directly at t+400 ms, that state is legible:

- `/n8n-sync-history` at 270 chars renders `LATEST RESULT No runs / LAST RUN
  never / CADENCE configured schedule / ... Loading history...`, then jumps to
  `LATEST RESULT Review needed / LAST RUN Aug 14, 09:37 AM / CADENCE 09:00,
  17:00 Asia/Jerusalem`.
- The workspace cockpits show `n8n sync: waiting for first scheduled run / Last
  run never` before switching to the real run summary.

Two consequences, and they point in different directions:

1. **For the harness.** This is exactly the missing half of the liveness
   contract this repo declined to adopt. `docs/captured-surfaces.json` sets
   `livenessContract: "none"` and says to lift it "when agent-settings#691
   lands settle-until-stable **plus a per-surface content assertion**".
   Settle-until-stable is landed and is not sufficient on its own; the per-surface
   assertion is what would reject a 270-character `Loading history...`. The
   contract stays at `none` in this run - manufacturing a v2 record without the
   assertion would be the failure the contract exists to prevent.
2. **For the app.** A page that shows `No runs / never / configured schedule` as
   its first paint, and only later replaces it with real data, is showing the
   operator a confident wrong answer rather than a loading state. That is a
   real perceived-performance and content defect, and it is now measurable.

## Manifest / registry / runtime mismatch

The lane premise was that a workspace present in the runtime registry but absent
from `docs/captured-surfaces.config.json` raises `route_missing_from_manifest`.
Measured, that reading does not hold, in two ways. Full controls and disposition
are in [#165](https://github.com/iMelki/mission-control-kanban/issues/165).

- The runtime DB holds **7** workspaces; the source registry
  (`GITHUB_PROJECT_WORKSPACE_MAPPINGS`) and the gate config both hold the same
  **5**. Config and registry are in step; the DB is the odd one out.
- **Neither gate reads the DB.** With 7 rows present and an unmodified tree,
  both gates are green. `/workspace/default` and
  `/workspace/mck-sync-test-assistants` both serve HTTP 200 and are unmeasured
  with nothing raising.
- `mck-sync-test-assistants` is not test residue: **migration 011** creates it in
  committed source, so every install serves it.
- The config's own `$comment` names the wrong gate. Adding a 6th slug to the
  registry alone makes `scripts/derive-captured-surfaces.ts` raise
  `route_missing_from_manifest`; the canonical gate, which never reads the
  registry, stays green.

Nothing was added to the manifest. Adding the two slugs would green the gate
while deleting the only signal that a runtime-created workspace is unmeasured.

## Accessibility, measured on the production build

`scripts/probe-surface-a11y.mjs` against 3121, all 9 required surfaces, both
declared viewports. Its own self-proof passed both directions before the sweep
(injected 1.92:1 text was flagged, an unlabelled image was flagged by name under
its own rule, and both returned to baseline on removal).

| measure | result |
| --- | --- |
| axe (wcag2a/2aa/21a/21aa/22aa) violations | **47** across 18 units; every workspace cockpit carries 1 critical + 3 serious |
| axe blocking-incomplete | 4 (`/settings` and `/workspace/content-factory`, both viewports) |
| contrast colour decisions checked | 553, **14 failing** |
| worst contrast ratio | **2.87:1** against a 4.5:1 requirement - one repeated token, `text-[10px] text-mc-text-secondary/60`, `rgb(92,100,108)` on `rgb(22,27,34)` |
| focus indicator | 2,936 visible of 2,954 measured |
| keyboard traps | 0 of 675 checks |
| roving `tabindex="-1"` controls | 40 of 40 have **no** visible focus indicator |

**Focus coverage is 67.3%, and that is a ceiling on the focus claim, not a
footnote.** 2,964 of 4,402 Tab-reachable controls were measured; 6 of 18 units
were partial, worst `/workspace/assistants` @ desktop at 25.3% (289 of 1,141),
where 851 controls exhausted the probe's time budget. The 1,438 unmeasured
controls are unmeasured, not clean. The probe exits 3 for exactly this reason.

### Contrast coverage: 100%-covered, and proven so

The fleet caveat is that Tailwind v4 `oklch()` defeats an rgb-only parser and
silently skips ~92% of pairs. **That hazard does not apply to this app, and it
was checked rather than assumed:** Tailwind is 3.4.19 and `oklch` appears 0 times
in `src/`. Coverage was then measured directly rather than inferred - every
visible, text-bearing element was re-walked and its computed foreground colour
resolved twice, once through the regex parser and once by painting it to a 1x1
canvas and reading the pixel back:

    population 13,488 elements   measured 13,488   coverage 100.0%
    canvas readback: 13,488 agree, 0 disagree, 0 parser-only, 0 readback-only
    unparseable foreground colours: 0
    sr-only elements excluded and counted: 34

The parser and the UA rasteriser agree on every element in the app, so the
contrast numbers above are not resting on an unmeasured remainder.

### Target size: WCAG 2.5.8 AA is met; 2.5.5 AAA is not

Population is every Tab-reachable, rendered, non-disabled control. A positive
control - three crowded 8x8 buttons - was injected **on each page in this run**
and had to be caught; it was, on 18 of 18 units (`0 -> 3` failures every time),
so the zero below is a measured zero and not a dead detector.

| criterion | result |
| --- | --- |
| **2.5.8 (AA, 24x24)** | **0 failures of 4,394 controls.** 4,352 meet 24x24 outright, 40 pass under the spacing exception, 2 under the inline exception |
| **2.5.5 (AAA, 44x44)** | 2,345 of 4,394 fail (**53.4%**) - concentrated in the cockpit boards, e.g. 581 of 1,141 on `/workspace/assistants` |

`sr-only focus:not-sr-only` skip links are a WCAG feature and were excluded from
scoring by rule. The rule applied to nothing here: this app has **0** such
controls, which is worth its own look, since a bypass-blocks link is the usual
reason to have one.

## Score

Only two of the eight rubric dimensions were measured this round, and **no UI
code changed**, so the other six are held at their standing values rather than
re-guessed.

| dimension | before | after | basis |
| --- | --- | --- | --- |
| Accessibility | 4 | **5** | 2.5.8 AA clean with a live positive control on all 18 units; 0 keyboard traps; 99.4% of measured controls have a visible focus ring. Held down by a critical axe violation on every cockpit, a 2.87:1 contrast floor, 40/40 roving controls with no indicator, and 32.7% of the control population unmeasured |
| Perceived performance | 5 | **5** | 18-161 ms on 11 of 11 routes and 0 clipped elements at both viewports - but that is a property of the build, not of the code. The first-paint defect is unchanged and now measured: 5 of 18 units render a confident wrong answer (`No runs / never / configured schedule`, `waiting for first scheduled run`) before the real data replaces it |
| the other six | unchanged | unchanged | not measured this round |

**Composite 5.8 -> 5.9.** The move is +1 on one dimension at its 1/8 unweighted
share. It is a **measurement gain, not a product improvement** - the app is the
same app it was this morning; it is simply no longer being scored blind.

**This can go down.** 1,438 Tab-reachable controls were never reached. The one
population that was fully enumerated and audited - the 40 roving tab controls -
failed 40 of 40. If the unmeasured remainder behaves like the part that was
measured to the end, Accessibility drops below where it started.

## What this run did not do

- **It did not lift `livenessContract` off `none`.** The refusal analysis above
  shows why the per-surface content assertion is still needed; stamping a v2
  record without one would be the failure the contract exists to prevent.
- **It did not re-record `capturedAt` in `docs/captured-surfaces.json`.** The
  existing records were taken with `scripts/probe-surface-clipping.mjs`, and
  `origin/feature/a11y-focus-proof-150` is mid-flight in that same file.
- **It did not commit the `next build` fix.** That belongs to commit `8a3b2c7`
  on `origin/feature/a11y-focus-proof-150`.
- **It did not touch port 3021** or the LocalNext task that owns it.

## Follow-ups

- [#164](https://github.com/iMelki/mission-control-kanban/issues/164) - dev
  server dies under on-demand compile; watchdog recovery ceiling is shorter than
  the compile budget; post-boot recovery has no wait-for-volume.
- [#165](https://github.com/iMelki/mission-control-kanban/issues/165) - two
  served workspace routes are invisible to both captured-surface gates, and the
  config `$comment` names the wrong gate.
- [#148](https://github.com/iMelki/mission-control-kanban/issues/148) - the root
  type errors are not only ungated, they block `next build` outright.
- [#150](https://github.com/iMelki/mission-control-kanban/issues/150),
  [#151](https://github.com/iMelki/mission-control-kanban/issues/151),
  [#152](https://github.com/iMelki/mission-control-kanban/issues/152) - the
  focus, contrast and axe findings above all reproduce on the production build,
  so they are app defects rather than dev-mode artifacts.
