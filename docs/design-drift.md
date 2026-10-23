# Design drift check

`npm run design:drift` answers "did this change alter the look?". It runs
[Dembrandt](https://github.com/dembrandt/dembrandt) (MIT) against a few key
routes of a running MCK. Dembrandt renders each page in Chromium, reads the
computed styles and extracts design tokens: colors, typography, spacing, radii,
shadows. The check compares those tokens with the committed baseline in
`docs/design-drift/baseline/`.

It measures what is rendered, not what is declared. Changing a CSS variable
that no element uses is not drift. Changing a Tailwind color that the board
paints with is drift.

## Commands

```bash
# Check a server that is already running (default http://127.0.0.1:3021)
npm run design:drift -- --base-url http://127.0.0.1:3021

# Build and start an isolated production server first, the way Runtime Regression does
npm run design:drift -- --start

# Accept the current look as the new baseline (after an intended visual change)
npm run design:drift -- --start --update-baseline
git add docs/design-drift/baseline/
```

Options:

- `--threshold <n>`: the highest per-route drift score that still passes.
  The default is `10`, the same as Dembrandt's own gate. The score runs from
  0 (identical) to 100.
- `--routes /,/settings`: the routes to check. The defaults are `/`,
  `/workspace/default` and `/settings`. Each route has one baseline file,
  for example `root.json` or `workspace-default.json`.
- `--no-build`: use with `--start` to reuse an existing `npm run build` output.
- `--report-dir <dir>`: where the report goes. The default is
  `artifacts/design-drift/`.

`--start` serves the app from a throwaway SQLite database, so local board data
does not change the result.

## Output and exit codes

The check writes `report.md`, `report.json` and one `<route>.candidate.json`
per route to `artifacts/design-drift/`. In GitHub Actions it also adds the
Markdown report to the job summary.

| Exit | Meaning |
| --- | --- |
| 0 | Every route is at or below the threshold. |
| 1 | At least one route drifted above the threshold. |
| 2 | The check could not evaluate: no baseline, Dembrandt failed, or the result was inconclusive. |

The verdict logic is in `scripts/lib/design-drift.mjs` and is tested by
`npm run test:design-drift`.

## Browser and version

Dembrandt is pinned to an exact version (`DEMBRANDT_VERSION` in
`scripts/lib/design-drift.mjs`) and runs through `npx`. It is not a
`package.json` dependency, so `npm ci` and the Docker image do not install it
or its optional 280 MB ML runtime. Dembrandt does not download a browser
either. The script launches Chromium from this repo's own Playwright install
and connects Dembrandt to it over CDP (`BROWSER_CDP_ENDPOINT`). Set
`DESIGN_DRIFT_CHROMIUM_PATH` to use a different Chromium binary.

To upgrade Dembrandt, change the version constant, run `--update-baseline`
and review the baseline diff in the same pull request.

## CI

The `Design drift (non-blocking)` job in
`.github/workflows/runtime-regression.yml` runs `npm run design:drift -- --start`
with `continue-on-error: true`. Drift shows as a failed job and an
`mck-design-drift` artifact, but it does not block the merge.

The first baseline was captured on Chromium 141 (Playwright build 1194). CI
installs the Chromium build that the locked Playwright version expects.
Computed styles rarely differ between Chromium versions. If CI reports drift
on a pull request that does not touch the UI, refresh the baseline from a CI
run's candidate files or with `--update-baseline`.
