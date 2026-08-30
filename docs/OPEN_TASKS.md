# mission-control-kanban Open Tasks

Last updated: 2026-08-30

GitHub Issues are enabled for `iMelki/mission-control-kanban`. Use GitHub issues as the canonical task records and keep this file as the local index.

This index had drifted badly: it was stamped 2026-06-11 and named four "active"
issues while GitHub carried **57 open**. Treat the counts below as a pointer,
not an inventory — `gh issue list --repo iMelki/mission-control-kanban` is
authoritative.

## Active Issues

Open on GitHub: **57** (verified 2026-08-25). The a11y cluster (#150-#153,
#157-#159) and the ungated-typecheck item (#148) are the newest work; the
`[MC-0xx]` series (#56-#118) is the commercialization/hardening backlog.

- [#143 - Migrate hardcoded durations onto the adopted motion tokens](https://github.com/iMelki/mission-control-kanban/issues/143)
  - Goal: retire the app's dependence on Layer B of the reduced-motion contract. `362e448` adopted
    `fleet-motion-primitive` v1.0.0 and the tokens are proven, but 481 transitions still use
    Tailwind's hardcoded `transition` and the named `duration-*` utilities have zero call sites.
    Incremental; the proof recipe must stay `pass` after each batch.
- [#148 - Root type errors are ungated](https://github.com/iMelki/mission-control-kanban/issues/148)
  - Goal: add a `typecheck` script and stop `tsc --noEmit` failing unobserved.
- [#150 - Give the four settings inputs visible keyboard focus](https://github.com/iMelki/mission-control-kanban/issues/150)
  - Local `dev` implementation and production proof are complete in the
    isolated recovery clone; GitHub remains open until the reviewed change is
    pushed and promoted.
- [#151 - Repair the three WCAG AA contrast decisions](https://github.com/iMelki/mission-control-kanban/issues/151)
  - Local implementation removes the secondary-token opacity reductions and
    strengthens the offline badge text; the new production sweep is recorded
    in `docs/accessibility-remediation-2026-08-30.md`.
- [#152 - Remove axe interaction and semantics violations](https://github.com/iMelki/mission-control-kanban/issues/152)
  - Local implementation covers nested task-card actions, Radix tab panels,
    the home-link name, focusable table regions, and diagnostic semantics.
- [#160 - Decompose the accessibility self-proof lifecycle](https://github.com/iMelki/mission-control-kanban/issues/160)
  - Still open. The recovery keeps the 18-leg contract stable and makes a
    caller-faithful correction, but the oversized lifecycle remains the owner
    for a no-feature refactor before future expansion.
- [#159 - Fail closed when accessibility populations collapse](https://github.com/iMelki/mission-control-kanban/issues/159)
  - Still open. A discarded run against a partially staged standalone tree
    again produced collapsed surface populations; only the rebuilt stable run
    may be cited as evidence.
- [#7 - Use relevant skills for market research, competitor analysis, and monetization planning](https://github.com/iMelki/mission-control-kanban/issues/7)
  - Goal: map competitors, ICPs, monetization options, and positioning for mission-control-kanban.
- [#8 - Design and build a landing page](https://github.com/iMelki/mission-control-kanban/issues/8)
  - Goal: define and implement a landing page with clear audience, value proposition, proof, and CTA.

## Latest Progress

- 2026-08-30: selectively reconciled PR #162 onto current `dev` without
  merging its conflicting branch. Source fixes for #150-#152, the composite
  shadow parser, contracted-shadow canaries, gate ledger, and current capture
  evidence are retained. Stale screenshots and the branch's older capture
  manifest are not. See `docs/accessibility-remediation-2026-08-30.md`.
- 2026-08-25: verified the #149 commit-lock unlock end to end. The genome
  `$schema` pin, the byte-faithful local schema mirror, and the captured-surface
  adoption are all on `origin/dev`; `npm run test:doctor-genome` passes 4/4 and
  the canonical gate self-test passes **38/38** negative fixtures. Note the
  pinned `$schema` URI resolves only with credentials — `iMelki/projects-ops` is
  a private repo, so an anonymous GET of the raw URL returns 404 by design. That
  is a JSON Schema *identifier*, not a fetch target; do not "fix" the 404.
- 2026-05-31: continued the GitHub-native operator flow by adding a Mission
  Queue diagnostics pill and `/api/github/diagnostics`. The UI now shows
  whether MCK can see a GitHub token, authenticate the current viewer, and read
  GitHub Projects before an operator starts the import/write-back loop.

## Recently Completed

- [#18 - Choose and activate MCK n8n alert notification destination](https://github.com/iMelki/mission-control-kanban/issues/18)
  - Completed by selecting projects-ops Workflow Pack 1 alert intake as the
    local destination:
    `http://127.0.0.1:5678/webhook/projects-ops/mck-sync-alert`.
  - MCK still writes the ignored `.logs/mck-n8n-sync-alerts.jsonl` fallback log
    when failed/error sync runs occur.
- [#20 - Clarify workspace-level manual sync control](https://github.com/iMelki/mission-control-kanban/issues/20)
  - Completed via PR #21.
  - Result: the project-backed workspace banner now labels the manual refresh
    control as **Sync now** and reports workspace-level sync results explicitly.
- [projects-ops#9 - Track mission-control-kanban bootstrap baseline adoption](https://github.com/iMelki/projects-ops/issues/9)
  - Completed via [mission-control-kanban#2](https://github.com/iMelki/mission-control-kanban/pull/2).
- [#3 - Fix build-time dynamic route and OpenClaw side-effect logs](https://github.com/iMelki/mission-control-kanban/issues/3)
  - Completed on 2026-05-16.
  - Result: the build-only API routes now force dynamic execution, so `npm run build` finishes without OpenClaw connection side effects or static-route warnings.
- [#4 - Resolve baseline validation lint warnings](https://github.com/iMelki/mission-control-kanban/issues/4)
  - Completed on 2026-05-16.
  - Result: the remaining hook/dependency and custom-font lint warnings were removed without changing runtime behavior.
- [#12 - Add GitHub import preview and source identity mapping](https://github.com/iMelki/mission-control-kanban/issues/12)
  - Completed on 2026-05-15.
  - Result: local tasks now persist GitHub source identity, duplicate imports are blocked, and the preview endpoint is documented in [GITHUB_IMPORT_PREVIEW.md](GITHUB_IMPORT_PREVIEW.md).
- [#13 - Add bounded GitHub write-back for Kanban workflow state](https://github.com/iMelki/mission-control-kanban/issues/13)
  - Completed on 2026-05-15.
  - Result: bounded GitHub write-back planning and apply routes are documented in [GITHUB_WRITEBACK.md](GITHUB_WRITEBACK.md), and repo-owned validation now runs through `npm run test:github-sync`.
- [#11 - Sync GitHub issues/projects into Kanban and write workflow state back](https://github.com/iMelki/mission-control-kanban/issues/11)
  - Completed on 2026-05-15.
  - Result: the parent GitHub sync/write-back slice is now satisfied by the shipped import preview, persisted source identity, bounded write-back routes, and repo-owned validation/docs.
- [#14 - Close governance baseline drift from 2026-05-15 modernization audit wave 1](https://github.com/iMelki/mission-control-kanban/issues/14)
  - Completed on 2026-05-15.
  - Result: the repo audit is now fully clean (`22/22` pass, `0` warn, `0` fail).

## Local Follow-Ups

- Review and push the isolated local `dev` commits, then promote through the
  repo's normal `dev -> main` path; no GitHub state was mutated in this recovery.
- Close or supersede conflicting PR #162 only after the replacement changes are
  visible on GitHub and its useful evidence links have been preserved.
- Extend #164 so `MCK_CAPTURE_COMMIT` is checked against build provenance. The
  current preflight proves server mode and BUILD_ID, but accepts any 40-hex
  report label.
- File a runtime-staging collision issue when GitHub mutation is authorized.
  `check:runtime-regressions` hit `EBUSY` and partially replaced the served
  standalone tree when it was invoked before the capture server stopped.
- Keep `dev` and `main` aligned after bootstrap PRs merge.
- Keep `.github/labels.yml` synced with GitHub labels when taxonomy changes.
