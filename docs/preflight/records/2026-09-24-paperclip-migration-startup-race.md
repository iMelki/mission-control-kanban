# Paperclip migration CI startup race — 2026-09-24

## Plain-English Summary

Before the fix, `validate-migrations.mjs` could run its `createdb` command
between the PostgreSQL image's temporary initialization server stopping and
its final server starting. The hosted test failed before any migration ran.
The TCP-readiness fix subsequently passed hosted migration checks, and PR #170
merged with green checks; see [Final Outcome](#final-outcome). Current use was
not blocked: no installed bridge or production database was affected. No local
Docker was run, and no red required check was merged.

## Initial Failure (before fix)

- PR [#170](https://github.com/iMelki/mission-control-kanban/pull/170) at its
  earlier head `6a65beddca98bec21a187c975bcd22eeb1b596db` had one failed check:
  [Paperclip bridge job](https://github.com/iMelki/mission-control-kanban/actions/runs/35299840970/job/105459948340).
- The bridge typecheck and 42 tests passed. `npm run test:migrations` then failed
  at its first `createdb`: the Unix socket no longer existed.
- The [official Postgres image](https://hub.docker.com/_/postgres) uses a
  temporary initialization server. Its
  [entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh)
  starts that server with TCP listening disabled, stops it, and starts the final
  server. The existing socket-based `pg_isready` can therefore produce a false
  lifecycle-ready signal. This explanation is an inference from the image
  lifecycle and the job log; the hosted rerun is the confirmation gate.

## Remediation and Original Gate

- The migration harness was changed to probe `127.0.0.1` inside the container.
  The temporary image server does not listen on TCP, while the final server
  does. Keep the existing bounded 60-attempt wait and fail-closed cleanup.
- Local syntax and bridge tests ran without Docker. The migration scenarios
  ran in hosted CI; no local Docker operation was part of this repair.
- The original merge gate required fresh passing checks and completed review.
  Both conditions were met before PR #170 merged. Live Paperclip installation
  and dispatch remain separate #47 gates.

## Acceptance Criteria

1. The new PR head's Paperclip bridge check passes its real migration scenarios.
2. Other required PR checks are green; no known-red required check is merged.
3. The issue, `OPEN_TASKS.md`, and this record point to the tested commit and
   hosted run. Any recurrence is recorded before further changes.

## Related Evidence

- [PostgreSQL `pg_isready` reference](https://www.postgresql.org/docs/current/app-pg-isready.html): a zero exit means that the server accepts connections at the moment probed.
- Bridge harness: `integrations/paperclip-bridge/scripts/validate-migrations.mjs`.
- Bridge release/install scope: [#47](https://github.com/iMelki/mission-control-kanban/issues/47).

## Final Outcome

The TCP-readiness fix was pushed at `805420cca4df5b45735174d42ad5a255b287f56c`.
The hosted Paperclip bridge migration job passed twice on the repaired PR head;
one run reported 42 passing tests and all five migration scenarios. The
independent review found no remaining code blocker after the separate HTTP
capture guard fix. All required PR checks passed, and PR #170 merged normally
at `a79ce5fc1fd09f777f893af8427a165080c243db`. The post-merge
[CI](https://github.com/iMelki/mission-control-kanban/actions/runs/36018647743),
[secret scan](https://github.com/iMelki/mission-control-kanban/actions/runs/36018647531),
and [runtime regression](https://github.com/iMelki/mission-control-kanban/actions/runs/36018647434)
also passed. Remote `dev` and `main` were aligned to the merge commit. Issue
#172 was closed after exact readback. This does not constitute a live Paperclip
installation or dispatch receipt; those remain under #47.
