# Accessibility remediation - 2026-08-30

## Current state

Issues [#150](https://github.com/iMelki/mission-control-kanban/issues/150),
[#151](https://github.com/iMelki/mission-control-kanban/issues/151), and
[#152](https://github.com/iMelki/mission-control-kanban/issues/152) are
implemented on local `dev` in an isolated full clone. GitHub was not mutated;
the issues remain open until this change is reviewed, pushed, and promoted.

The scoreable target is the local standalone Next 16.2.9 build from source
commit `c55fbaef790faca6dceabc44a072a74fb6eb6806`, BUILD_ID
`lj3Gy33tTHXsP7MdiIFhZ`, served on `127.0.0.1:5401`. No Railway or external
runtime was used.

## What changed

- **#150 focus:** the four settings fields share `src/components/ui/input.tsx`.
  Its focus ring is immediate (`transition-colors` does not animate the ring
  from transparent), and the Radix tab trigger uses the full `mc-accent` ring.
- **#151 contrast:** task timestamps and the n8n status line use the full
  secondary token; the offline badge uses `text-rose-200` on its dark red
  surface.
- **#152 semantics:** each Radix trigger owns a real `Tabs.Content` panel;
  inactive panels stay mounted and hidden while their expensive children are
  not rendered. Task-card open and drag actions are sibling buttons instead of
  descendants of a `role=button` card. The home link has an accessible name.
  Horizontal table, Mission Queue, and Live Feed scrollers are focusable named
  `region`s. Runtime diagnostics use `role=group`.
- **Harness recovery:** axe self-proof scans are scoped to the authored fixture.
  This avoids axe classifying the whole `color-contrast` rule as incomplete
  because of an unrelated app node and thereby hiding the known-bad control.
  The injected elements are repaired in place and the same scoped scan must
  return clean. The established 18-leg contract stays stable.
- **Contrast ownership:** app-wide axe scans explicitly delegate
  `color-contrast` to the proven computed-style pass because axe 4.11.1 throws
  `Element midpoint exceeds the grid bounds` on legitimate offscreen Kanban
  columns. The scoped self-proof keeps axe's rule enabled as an independent
  injected-node canary; this is recorded as delegation, not silently skipped.

## Component source and licence

The only adopted component source is shadcn Input from `shadcn-ui/ui` commit
`b4a618b97e35f5dadf3a00d51f410c84a2567d4d`, path
`apps/v4/registry/new-york-v4/ui/input.tsx`, checked 2026-08-30. It is covered by
the repository's [MIT licence](https://github.com/shadcn-ui/ui/blob/b4a618b97e35f5dadf3a00d51f410c84a2567d4d/LICENSE.md).
The exact [source](https://github.com/shadcn-ui/ui/blob/b4a618b97e35f5dadf3a00d51f410c84a2567d4d/apps/v4/registry/new-york-v4/ui/input.tsx)
was manually adapted to Tailwind 3 and the existing `mc-*` tokens. No registry
installer, dependency, framework, or private Component Marketplace code was
copied.

## Production evidence

- `npm run build`: pass, all 19 app pages generated.
- `npm run surfaces:probe -- artifacts/accessibility-remediation-20260830/clipping-stable-c55fbae`:
  pass; the injected 1200px control moved clipping 0 -> 1, then all 18 real
  route/viewport measurements reported 0 clipped elements.
- `npm run surfaces:check`: pass; 9 derived routes, 9 declared routes, and every
  current `sourceDigest` matches.
- `node scripts/probe-surface-a11y.mjs
  artifacts/accessibility-remediation-20260830/a11y-sweep-stable-c55fbae`: final
  report safely exited partial (`3`) rather than overstating coverage. It
  measured 2,457/2,462 Tab-reachable controls (99.8%) across all 18 units;
  `/workspace/content-factory` desktop mounted one late control and measured
  68/69 (98.6%). All measured results were clean: 0 axe violations, 0 blocking
  incomplete, 0/513 contrast failures (minimum 4.53:1), 2,447/2,447 scored
  focus indicators visible and unobscured, 40/40 roving controls visible and
  unobscured, and 0 keyboard traps. This is useful diagnostic evidence, not a
  complete baseline.
- A clean-data rerun with a 5-second population-settle interval is in progress
  at `artifacts/accessibility-remediation-20260830/a11y-sweep-final-c55fbae`.
  Its durable console log is the sibling `.log` file. Do not call the recovery
  fully green unless its report says `status: complete` and 18/18 surfaces are
  full.
- `node --test tests/assert-production-capture-target.test.mjs`: 13/13 pass,
  including exact exit-2 refusal for missing URL and the supervised port.

The ignored evidence root is
`artifacts/accessibility-remediation-20260830/`. Recreate it; do not treat chat
or screenshots as the source of truth.

## Encountered capture collision

An earlier attempt started `npm run check:runtime-regressions` while the
standalone capture server still owned `.next/standalone/mission-control.db`.
Its staging step failed with `EBUSY` and left the served standalone directory
in a partial state. A resulting accessibility sweep showed collapsed surface
populations and is deliberately excluded from evidence. The directory was
rebuilt, its BUILD_ID read back, and final capture and runtime-regression work
were serialized. This is additional evidence for #159's fail-closed population
work; a separate runtime-staging/active-server collision guard should be filed
when GitHub mutation is authorized.

## Gate negative proof

The exact self-proof caller was run against each committed mutation contract:

1. Renaming `#__sp_contrast` made both authored axe target legs `DEAD` and
   exited 2.
2. Repairing the injected computed-contrast sample too early made its measured
   ratio 18.88:1 and the computed-style detector leg `DEAD`; the caller exited 2.
3. Restoring the old whole-shadow regex made the contracted-shadow leg `DEAD`
   and exited 2.
4. Replacing the painted-geometry predicate with `return true` made both
   contracted controls read visible; the named leg went `DEAD` and exited 2.
5. Restoring SHA-256
   `e22572ac108a37970a6f1cad836cf0cec0af0470139d1a79b662d909937a7406`
   made all 18 legs pass and the caller exit 0.

`.gate-evidence.json` records these runs and reconciles the seven useful gate
records from PR #162 plus the later production-capture preflight. Repo Health
Audit reports 8/8 gates declared; its remaining four warnings concern hook
installation/time-budget and the existing scratch-helper ratchet, not this
accessibility implementation.

## Source maintainability

Counts are physical / nonblank lines, compared with `origin/dev`:

| File | Before | After | Decision |
| --- | ---: | ---: | --- |
| `scripts/probe-surface-a11y.mjs` | 2366 / 2285 | 2444 / 2363 | Existing oversized harness; correction stays inside the authored self-proof lifecycle. #160 owns decomposition before feature expansion. |
| `src/app/workspace/[slug]/page.tsx` | 539 / 481 | 544 / 487 | Existing cohesive page orchestration; five lines of net growth preserve its one render-state owner. |
| `src/components/MissionQueue.tsx` | 593 / 536 | 606 / 549 | Existing queue/card owner; sibling-button and board-scroll semantics stay local to the same owner. |
| `src/components/LiveFeed.tsx` | 227 / 209 | 232 / 214 | Five-line semantic addition to the existing feed-scroll owner. |
| `src/components/workspace/WorkspaceSectionTabs.tsx` | 36 / 31 | 77 / 68 | Two focused components; largest function is 35 physical lines. |
| `src/components/ui/input.tsx` | 0 / 0 | 23 / 20 | Small copy-owned UI primitive. |
| `src/components/ui/DataTable.tsx` | 422 / 393 | 427 / 398 | Five-line semantic addition to its existing scroll owner. |
| `tests/accessibility-remediation-contract.test.mjs` | 0 / 0 | 77 / 66 | Five focused contract tests. |

Largest pre-existing functions remain `selfProof` (about 512 physical lines),
`WorkspacePage` (about 422), and `MissionQueue` (about 248). No new function
crosses 80 lines. This recovery does not pretend those existing shapes are
ideal: #160 remains the independently reviewed harness-decomposition owner, and
promotion should include an independent diff review of the two UI files above
the 500-line target.

## PR #162 disposition

Do not merge or rebase PR #162. It conflicts with current `dev` and omits the
later production-capture preflight work. This recovery selectively carries its
useful composite-shadow parser, contracted-shadow canaries, and gate records,
then completes #150-#152 on the current source. Its stale screenshots, older
capture manifest, and branch topology should remain unmerged. After these local
commits are pushed through the normal `dev` path, close #162 as superseded and
link the replacement review while preserving its historical evidence links.

## Remaining gates

- Independent review is still required before promotion; no push or PR was
  authorized for this lane.
- The clean-data all-surface rerun is still active at this checkpoint. If it is
  partial again, keep the honest exit and resume #159 rather than weakening or
  capping the caller.
- #160 remains open and blocks feature expansion inside `selfProof`.
- #159 must reject severe population collapse instead of calling an empty or
  implausibly small surface complete. The discarded collision run demonstrated
  that this remains an active acceptance risk.
- `MCK_CAPTURE_COMMIT` is report metadata, not verified build provenance. The
  preflight proves production mode and BUILD_ID, but a wrong 40-hex commit label
  is accepted. Extend #164 before treating that field as an identity gate.
- The modal/dialog code paths are not opened by this surface sweep. Their focus
  behavior remains unmeasured rather than implicitly clean.
