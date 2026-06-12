# mission-control-kanban Open Tasks

Last updated: 2026-06-11

GitHub Issues are enabled for `iMelki/mission-control-kanban`. Use GitHub issues as the canonical task records and keep this file as the local index.

## Active Issues

- [#6 - Surface readiness, review mode, risk, and dispatch blockers in the Kanban UI](https://github.com/iMelki/mission-control-kanban/issues/6)
  - Goal: surface the repo and task dispatch signals operators need before they take write actions from the Kanban UI.
- [#7 - Use relevant skills for market research, competitor analysis, and monetization planning](https://github.com/iMelki/mission-control-kanban/issues/7)
  - Goal: map competitors, ICPs, monetization options, and positioning for mission-control-kanban.
- [#8 - Design and build a landing page](https://github.com/iMelki/mission-control-kanban/issues/8)
  - Goal: define and implement a landing page with clear audience, value proposition, proof, and CTA.

## Latest Progress

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

- Keep `dev` and `main` aligned after bootstrap PRs merge.
- Keep `.github/labels.yml` synced with GitHub labels when taxonomy changes.
