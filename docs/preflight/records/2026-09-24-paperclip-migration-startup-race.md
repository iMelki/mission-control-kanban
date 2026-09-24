# Paperclip migration CI startup race — 2026-09-24

## Plain-English Summary

The `validate-migrations.mjs` script can run its `createdb` command between the
PostgreSQL image's temporary initialization server stopping and its final server
starting. The observed hosted test failed before any migration ran. This blocks
PR #170's green-check gate. Current use is not blocked: no installed bridge or
production database is affected. We will not run local Docker or merge a PR
with a red required check.

## Current State

- PR [#170](https://github.com/iMelki/mission-control-kanban/pull/170) at
  `6a65beddca98bec21a187c975bcd22eeb1b596db` has one failed check:
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

## Fix / Action Status

- Change the migration harness to probe `127.0.0.1` inside the container.
  The temporary image server does not listen on TCP, while the final server
  does. Keep the existing bounded 60-attempt wait and fail-closed cleanup.
- Local syntax and bridge tests can run without Docker. The migration scenario
  must run in hosted CI; no local Docker operation is part of this repair.
- Do not merge PR #170 until the fresh required checks pass and review is
  complete. Live Paperclip installation and dispatch remain separate #47 gates.

## Acceptance Criteria

1. The new PR head's Paperclip bridge check passes its real migration scenarios.
2. Other required PR checks are green; no known-red required check is merged.
3. The issue, `OPEN_TASKS.md`, and this record point to the tested commit and
   hosted run. Any recurrence is recorded before further changes.

## Related Evidence

- [PostgreSQL `pg_isready` reference](https://www.postgresql.org/docs/current/app-pg-isready.html): a zero exit means that the server accepts connections at the moment probed.
- Bridge harness: `integrations/paperclip-bridge/scripts/validate-migrations.mjs`.
- Bridge release/install scope: [#47](https://github.com/iMelki/mission-control-kanban/issues/47).
