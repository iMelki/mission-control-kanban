# React Doctor Pre-commit Gate

## Decision

The commit gate scans only matching frontend files in the staged Git index. It uses React Doctor's local warning-level exit status and deliberately disables the remote score request:

```text
react-doctor@latest . --verbose --scope files --staged --blocking warning --no-score --no-color
```

This is a commit-boundary check, not a replacement for an explicit full-project audit.

## Research Basis

- [pre-commit custom hook documentation](https://pre-commit.com/#new-hooks): custom hooks receive matching staged filenames by default, while `pass_filenames: false` disables that boundary.
- [React Doctor changelog](https://react.doctor/docs/community/changelog): `--staged` is a source selector, composes with file scope, and `--no-score` disables scoring and telemetry.
- [React Doctor GitHub Action reference](https://www.react.doctor/docs/reference/github-action-reference): score output can be absent when the score service is unavailable, so a score is not a reliable local gate primitive.

The design therefore uses pre-commit's filename filter for fast routing, React Doctor's staged-index selector as the authoritative source set, and the CLI exit code from `--blocking warning` as the deterministic decision.

## Failure Model

| Condition | Result | Reason |
| --- | --- | --- |
| No staged frontend files | Pass/skip | Nothing relevant is entering the commit. |
| Staged warning or error | Fail | `--blocking warning` makes the local CLI nonzero. |
| Unrelated diagnostic elsewhere on `dev` | Ignored | Branch-delta scope is not used. |
| Remote score service unavailable | Unaffected | `--no-score` prevents the request. |
| Git index cannot be read | Fail closed | The wrapper cannot prove its input boundary. |
| React Doctor cannot start or terminates unexpectedly | Fail closed | No trustworthy diagnostic result exists. |

On Windows, `.cmd` files are shell scripts and cannot be passed portably to
Node's `spawnSync` with `shell: false`. The wrapper resolves npm's
`node_modules/npm/bin/npx-cli.js` beside `process.execPath` and launches it with
that same Node executable. Missing launcher evidence fails closed; the hook does
not enable `shell: true` or interpolate staged filenames into a command string.

## Validation

`npm run test:react-doctor-hook` covers path filtering, a real temporary Git
index, clean and blocking results, score-outage text, no-source behavior,
index-read failure, process failure, and Windows npx entrypoint resolution.

For an explicit full-project closeout, run `npx -y react-doctor@latest . --score` separately and record whether the remote score was available. Do not treat that remote result as the commit gate.

## Emergency Bypass

`SKIP=react-doctor git commit ...` is reserved for a documented hook infrastructure failure. Record the reason in the linked issue or PR, then run the staged gate and focused tests before promotion. A diagnostic in the staged change is not an infrastructure failure.
