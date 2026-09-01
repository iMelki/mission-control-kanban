# Production-build capture (current rule)

Measure this app with `next start`, not `next dev`.

The supervised LocalNext checkout serves `next dev` on port **3021**. Consecutive
on-demand compiles have killed that process, and its watchdog then failed
recovery against a 300-second ceiling. That is
[#164](https://github.com/iMelki/mission-control-kanban/issues/164). A GET `/` on
3021 is itself the compile that starts the death sequence, so the capture
probes refuse that port **without fetching it**.

A leftover `.next/BUILD_ID` next to `next dev` is not provenance. Production
evidence is a non-3021 target plus a BUILD_ID that belongs to that serve.

**First production gauntlet (2026-09-01): 14/21** on `127.0.0.1:3121`
`next start`, SHA `74f6717`, BUILD_ID `S8HgxCEJWRAGRBloUGmn1`. Scorecard:
`docs/frontend-sota-gauntlet-2026-09-01/scorecard.md`. Do not claim that
number from `next dev`, and do not reuse the 2026-08-31 `:3021` card as
this row. Do not GET 3021.

## How to serve a capture target

Do not build or start inside the supervised checkout. That races the 3021
`.next` directory. Use a detached worktree, same volume as `node_modules`:

```text
git worktree add --detach <scratch>/mck-prod HEAD
mklink /J <scratch>/mck-prod/node_modules <repo>/node_modules
copy .env .env.local mission-control.db* into the worktree
npx next build --webpack
npx next start -H 127.0.0.1 -p 3121
```

`next build` still needs the `capturedViewports` narrowing in
`scripts/derive-captured-surfaces.ts` (the #148 type error). Confirm
`<scratch>/mck-prod/.next/BUILD_ID` exists before measuring.

## How to run the probes

```powershell
$env:MCK_BASE_URL = 'http://127.0.0.1:3121'
$env:MCK_NEXT_DIR = '<scratch>\mck-prod\.next'   # or $env:MCK_BUILD_ID = Get-Content ...
$env:MCK_CAPTURE_COMMIT = (git rev-parse HEAD)
node scripts/assert-production-capture-target.mjs --json
npm run surfaces:probe
# optional, long: node scripts/probe-surface-a11y.mjs
```

Preflight exit 2 means the target is not scoreable. Typical codes:

| code | meaning |
| --- | --- |
| `base_url_required` | `MCK_BASE_URL` unset. There is no 3021 default. |
| `supervised_next_dev` | Target is 127.0.0.1/localhost:3021. No fetch was sent. |
| `next_dev_html` | HTML has next-dev markers. BUILD_ID is ignored. |
| `build_id_required` | No production BUILD_ID from env, `MCK_NEXT_DIR`, or HTML. |
| `build_id_mismatch` | Served HTML BUILD_ID disagrees with the declared id. |
| `target_unreachable` | Capture port did not answer. |

`MCK_ALLOW_DEV_CAPTURE` does not override 3021.

## Evidence already on disk

The 2026-08-26 production-build run is `docs/production-capture-2026-08-26.md`.
It answered 200 on 11 of 11 routes in 18–161 ms and stayed up. It is a
measurement record, not a gauntlet scorecard.
