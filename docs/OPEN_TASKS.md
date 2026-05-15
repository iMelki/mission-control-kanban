# mission-control-kanban Open Tasks

Last updated: 2026-05-15

GitHub Issues are enabled for `iMelki/mission-control-kanban`. Use GitHub issues as the canonical task records and keep this file as the local index.

## Active Issues

- [#7 - Use relevant skills for market research, competitor analysis, and monetization planning](https://github.com/iMelki/mission-control-kanban/issues/7)
  - Goal: map competitors, ICPs, monetization options, and positioning for mission-control-kanban.
- [#8 - Design and build a landing page](https://github.com/iMelki/mission-control-kanban/issues/8)
  - Goal: define and implement a landing page with clear audience, value proposition, proof, and CTA.
- [#3 - Fix build-time dynamic route and OpenClaw side-effect logs](https://github.com/iMelki/mission-control-kanban/issues/3)
  - Goal: make `npm run build` complete without dynamic-route or OpenClaw connection error logs.
- [#4 - Resolve baseline validation lint warnings](https://github.com/iMelki/mission-control-kanban/issues/4)
  - Goal: clear existing Next.js lint warnings while preserving runtime behavior.
## Recently Completed

- [projects-ops#9 - Track mission-control-kanban bootstrap baseline adoption](https://github.com/iMelki/projects-ops/issues/9)
  - Completed via [mission-control-kanban#2](https://github.com/iMelki/mission-control-kanban/pull/2).
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
