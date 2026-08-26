# A11y and captured-surface recovery — 2026-08-26

## Outcome

The deferred proof from local checkpoint `217c31203db651b17450bef123d695672929b388`
was recovered against the isolated local server on `http://127.0.0.1:5391`.
The caller-faithful exhaustive accessibility harness exited `0`, all 18
route/viewport rows completed, and the five stale cockpit capture records were
re-probed and brought back to a green source-digest gate.

This recovery does not claim that the product has zero accessibility findings.
The harness is an evidence-validity and coverage gate: the report still names
the remaining product work in #150, #151, and #152.

## Server recovery

The prior listener served `/` but returned HTTP 500 for all five cockpit routes.
Only its recorded process tree was stopped (`41212`, `61296`, and `60284`). A
fresh Next 16.2.9 development server was started from the isolated feature
checkout; `/`, `/api/runtime/health`, and all five cockpit routes returned HTTP
200 before browser proof began.

Evidence:

- `artifacts/recovery-217c312-20260826/stale-server-processes-before-stop.json`
- `artifacts/recovery-217c312-20260826/server-route-smoke.json`
- `artifacts/recovery-217c312-20260826/dev-server-5391-exhaustive.log`

## Why the self-proof was repaired

Issue #157 recorded that two legs compared whole-page axe node counts across
separate scans of a live dashboard. The injected selectors were present, but a
live row appearing or disappearing could move the page's own count and kill a
healthy run. The repair counts only the authored `#__sp_contrast` and
`#__sp_img` targets: baseline `0`, injected `1`, restored `0`. Whole-page app
content is no longer part of this fixture contract.

This matches axe-core's result contract: each rule result contains a `nodes`
array and each node exposes a target selector. See the upstream
[axe-core API documentation](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)
and [context documentation](https://github.com/dequelabs/axe-core/blob/develop/doc/context.md).

## Gate-negative proof

The three committed cases are in
`tests/fixtures/a11y-selfproof-negative-inputs.json`, and the observed run is
recorded in `.gate-evidence.json`.

| Broken input | Caller result | Intended reason |
| --- | --- | --- |
| Rename the authored contrast target | exit 2 | both selector-bound axe legs were `DEAD`, with the contrast target reading `0 -> 0` |
| Restore the old whole-shadow transparent-regex parser | exit 2 | contracted shadows were accepted and the intact-ring roving fixture reported `visible=0`, `failures=2` |
| Bypass shadow geometry with `return true` | exit 2 | the contracted outer/inset shadow leg was `DEAD`, with both controls falsely visible |

After the last mutation, the intended source diff SHA-256 returned to
`cf7a4dc6d80fa714a4dbbd27b29522e9791d6eee250f0ca1849401787ce29c40`.
The final restored self-proof passed 18/18 legs and exited `0`.

Evidence:

- `artifacts/recovery-217c312-20260826/negative-selector.log`
- `artifacts/recovery-217c312-20260826/negative-whole-shadow-regex.log`
- `artifacts/recovery-217c312-20260826/negative-shadow-geometry.log`
- `artifacts/recovery-217c312-20260826/final-self-proof.log`
- `artifacts/recovery-217c312-20260826/final-self-proof/self-proof.json`

The repository had no root negative-proof ledger before this change. The final
ledger has zero exclusions and one entry for every discovered gate. The a11y,
Markdown-link, and component-sourcing callers have direct broken/restored
proof. The three workflow entries and the runtime wrapper record bounded local
caller-command evidence and state the boundary explicitly: GitHub-hosted
negative canaries remain tracked in #161. The local production-mode runtime
caller now passes after the #148 correction, but its negative fixture was run
in development mode on Windows rather than the hosted Ubuntu workflow. No
local diagnostic is described as a hosted Actions run. Numeric broken and
restored exit-code fields in `.gate-evidence.json` are the durable sidecar to
the raw logs, which did not all include a top-level exit sentinel.

Legacy proof added during recovery:

| Gate | Deliberate break | Observed red | Restored result |
| --- | --- | --- | --- |
| CI pre-commit step | tracked README trailing whitespace | exact workflow command exited 1 and named only `trailing-whitespace` / `README.md` | exact command passed all hooks |
| Runtime workflow step / wrapper | owned non-MCK server on port 5392 | React Doctor green; runtime smoke red; cleanup refused HTTP 200 readback | 16 smoke checks passed; 4/4 entities absent; port released |
| Secret-scan action equivalent | synthetic generic API key in ignored isolated Git history | detect-mode caller exited 2; log and SARIF redacted the value | clean isolated history exited 0 |
| Markdown link checker | missing local README target | direct caller exited 1 and named the exact path | direct caller exited 0 |
| Component sourcing preflight | uncovered temporary component | direct caller exited 1 and named the exact component | 39-component caller exited 0 |

The fixture contracts are retained in
`tests/fixtures/repository-gate-negative-inputs.json` and
`tests/fixtures/runtime-regression-wrong-server.mjs`; raw receipts remain under
`artifacts/recovery-217c312-20260826/`.

With all seven discovered paths declared, the repository-health caller exits
`0`: 31 checks, 29 pass, two warn, zero fail, grade `OK`. The warnings are the
pre-existing missing pre-commit time-budget declaration and the nine-site
ephemeral-scratch consolidation opportunity; neither was hidden or widened
inside this recovery.

## Exhaustive accessibility proof

Caller:

```powershell
$env:MCK_BASE_URL = 'http://127.0.0.1:5391'
$env:MCK_A11Y_FOCUS_BUDGET_MS = '0'
node scripts/probe-surface-a11y.mjs artifacts/recovery-217c312-20260826/a11y-after-final-exhaustive
```

Result: exit `0`, status `complete`, 2026-08-26T04:24:38.185Z through
2026-08-26T04:43:37.047Z (1,138.9 seconds).

| Metric | Result |
| --- | ---: |
| Self-proof | 18/18 alive |
| Route/viewport rows | 18/18 complete |
| Partial rows | 0 |
| Samples destroyed while measuring | 0 |
| Tab-reachable coverage | 4,372/4,376 (99.9%) |
| Focus observations with visible indicator | 4,354/4,362 |
| Unobscured focus observations | 4,362/4,362 |
| Roving controls | 40/40 measured, visible, and unobscured |
| Keyboard traps | 0 |

The eight missing visible-focus observations are the four known `/settings`
inputs at two viewports. The report also retains 37 axe violations, two
blocking-incomplete axe findings, and six contrast failures (minimum 4.04:1).
Those are product findings, not hidden or reclassified passes.

Evidence:

- `artifacts/recovery-217c312-20260826/a11y-after-final-exhaustive.log`
- `artifacts/recovery-217c312-20260826/a11y-after-final-exhaustive/a11y-report.json`

## Captured surfaces

The clipping probe's positive control moved from zero clipped elements to one
after injecting a 1,200px element, while document overflow stayed zero. It then
captured all nine required routes at mobile and desktop: 18 measurements, every
route HTTP 200, and zero clipped elements.

Exactly five stale manifest records were updated:

- `/workspace/assistants`
- `/workspace/memsys`
- `/workspace/content-factory`
- `/workspace/asimtop`
- `/workspace/frontend-revenue`

Each now records checkpoint `217c31203db651b17450bef123d695672929b388`,
date `2026-08-26`, both viewports, source digest `57c47aa411d855f3`, and 53
rendering files. The capture directory contains ten cockpit PNGs (five records
times two viewports) and eight unchanged-route PNGs required by the probe's
caller contract.

Evidence:

- `artifacts/recovery-217c312-20260826/surface-captures-final.log`
- `artifacts/recovery-217c312-20260826/surface-captures-final/probe.json`
- `artifacts/recovery-217c312-20260826/surface-captures-final/*.png`

Post-update gates:

- `npm run surfaces:check`: exit 0, 9 derived / 9 declared, every digest current.
- `npm run test:captured-surfaces`: exit 0, 25/25 tests.
- `npm run surfaces:canonical`: exit 0, 9/9.
- `npm run test:captured-surfaces-canonical`: exit 0, 38/38 tests.

## Maintainability and validation boundaries

Independent review approved the seven-line scoped-count growth as a narrow
recovery exception. The file moves from 2,343 to 2,350 nonblank source lines;
`selfProof` moves from 483 to 490 nonblank lines (Acorn span 496 to 503), its
decision proxy moves from 77 to 81, maximum nesting stays 6, maximum line length
is 115, and zero lines exceed 120 characters. Splitting out only the two-line,
zero-decision helper would hide rather than reduce the baseline/injected/restored
contract. Refactoring capture, pure leg evaluation, and cleanup before the next
feature growth is tracked in #160 with a 2026-09-15 target.

The first local production build and PR #162's first hosted Runtime Regression
run both compiled successfully, then exited `1` at the already-tracked #148
type error in `scripts/derive-captured-surfaces.ts:426` (`record.viewports` is
`unknown`) before browser smoke. The bounded correction binds the parsed
property once to `capturedViewports`, narrows that stable local with
`Array.isArray`, and reuses it for the unknown-label and uncovered-label checks.
Root `tsc --noEmit --incremental false`, the 25-case focused suite, and the full
Next 16.2.9 production build now exit `0`. The full local production-mode
Runtime Regression caller on port 5393 also exits `0`: the build completes, all
16 browser checks pass, four screenshots are captured, cleanup proves all four
temporary entities absent, and the owned server is stopped with the port
released. The existing Runtime Regression workflow remains the hosted caller;
no new gate was added.

That correction grows `scripts/derive-captured-surfaces.ts` from 687 to 688
physical lines and 641 to 642 nonblank lines. Its cohesive
`validateManifestShape` function moves from 177 to 178 physical lines and 167
to 168 nonblank lines; its decision proxy stays at 33 and maximum decision
nesting stays at 3. The file's maximum line length (136) and four pre-existing
lines over 120 characters are unchanged; the function's maximum is 123 with one
pre-existing line over 120. Changed lines are at most 110 characters. The new
line is the narrowing boundary the whole validation block consumes; extracting
it would add indirection without reducing the oversized validator. Independent
review approved this narrow cohesion exception; broader validator decomposition
is required before substantive future growth and is tracked separately in #163
with a 2026-09-30 target.

No new UI control or component decision was made here. The checkpoint's visual
change remains the existing Radix/shadcn `TabsTrigger` primitive with Tailwind
focus-ring tokens; no bespoke replacement component was introduced.
