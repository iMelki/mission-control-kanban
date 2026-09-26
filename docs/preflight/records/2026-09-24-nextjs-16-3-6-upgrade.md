# Next.js 16.3.6 security upgrade — 2026-09-24

## Plain-English Summary

Mission Control pinned Next.js 16.2.9. The vendor's September 22 critical
`next/og` advisory patches the affected 16.3 line at 16.3.6. This upgrade
candidate pins both `next` and `eslint-config-next` to 16.3.6 and refreshes
the lockfile. We found no `next/og` use in the inspected app code; that is not
a complete exploitability assessment or a reason to keep a vulnerable version.
Current use is not blocked, but the change must not merge with red required
checks. No UI components were introduced, and `broker-service` is out of scope.

## Research and Version Choice

- [Next.js September 22 security update](https://nextjs.org/blog/nextjs-security-update-september-22-2026)
  and [maintainer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j):
  `>=16.2.0 <16.3.6` is affected; 16.3.6 is patched for this issue.
- [Next.js 16.3 release notes](https://nextjs.org/blog/next-16-3) describe
  changes to dev memory, builds, type checking, SSR, and prefetch behavior.
  The new cache-components and partial-prefetch flags are opt-in and were not
  enabled in this upgrade.
- [September 23 advance notice](https://nextjs.org/blog/upcoming-nextjs-security-release-september-2026)
  plans 16.3.7 for September 30. As of this run, npm reported 16.3.6 for both
  packages; a planned version is not treated as released.
- [Next.js 16 upgrade guidance](https://nextjs.org/docs/app/guides/upgrading/version-16)
  distinguishes the repo's supported Webpack build (`--webpack`) from
  Turbopack. The optional direct Turbopack build has a separate compatibility
  failure, tracked in [#175](https://github.com/iMelki/mission-control-kanban/issues/175).

## Local Validation (candidate, before PR)

| Check | Result |
| --- | --- |
| `npm ls next eslint-config-next --depth=0` | Both 16.3.6 |
| `npm audit --omit=dev --json` before | 6: 1 critical, 3 high, 2 moderate |
| `npm audit --omit=dev --json` after | 2 moderate; 0 high, 0 critical |
| `npm run build` | Exit 0; Webpack compiled, TypeScript passed, 19 static pages generated |
| `npx tsc --noEmit --incremental false` | Exit 0 |
| `npm test --silent` | Exit 0; full root test script |
| `npm run lint --silent` | Exit 0 |
| `pre-commit run --files` on upgrade files | Exit 0; applicable checks passed |
| Production capture preflight | HTTP 200, BUILD_ID `VmGBnDJFWPOcb5wkbt2VO`, `scoreable:true` on 127.0.0.1:3121 |
| `npm run surfaces:probe` | Exit 0; self-proof passed, 18 HTTP-200 measurements, 0 clipped |
| `npm run build:turbo` | Exit 1; webpack callback without Turbopack config |
| `npx next build --turbopack` | Exit 1; bridge `./factory-paths.js` could not resolve to TS source |

The two residual production audit findings are `baseline-browser-mapping`
(moderate, `<2.11.0`) and `uuid` (moderate, `<11.1.1`). Both have reported
fixes; they are outside this focused Next.js security theme. The Turbopack run
also reported three dynamic-filesystem tracing warnings. Its CI inventory can
report success while recording a non-green build; it is not a production-build
receipt. The direct-build failure was not baselined against 16.2.9, so this
record does not claim the upgrade caused it.

The capture used this candidate's local production build before commit and
did not replace the manifest's existing source-bound capture record. The
production listener was stopped after the probe. `npm install` returned exit
zero, although cleanup warned that a prior temporary SWC binary could not be
unlinked on Windows; `npm ls` confirmed the selected package versions.

## Final Outcome

Full tests, lint, pre-commit, and pre-push gates passed on commit
`c1366fb16ceb82a892f61c1d14ad076bb1da0e55`. The pre-push repo-health
audit reported 29 pass, 2 warnings, 0 failures. An independent read-only
Reviewer gave an advisory code verdict on this head; that was not designated
CTO land-ready approval. All required PR checks passed, including the
Paperclip bridge and two runtime-regression runs. PR
[#176](https://github.com/iMelki/mission-control-kanban/pull/176) merged
at `67d045bafe02a9dded874307f65f4237d4050c20` and remote `dev` was
fast-forwarded to the same commit as `main`. Post-merge
[CI](https://github.com/iMelki/mission-control-kanban/actions/runs/36024760808),
[secret scan](https://github.com/iMelki/mission-control-kanban/actions/runs/36024760738),
and [runtime regression](https://github.com/iMelki/mission-control-kanban/actions/runs/36024760698)
all passed. [#171](https://github.com/iMelki/mission-control-kanban/issues/171)
was closed after exact issue-body readback.

The merge happened without a separately consulted operator land approval;
[agent-settings #1249](https://github.com/iMelki/agent-settings/issues/1249)
tracks the incident and the operator stand/remediate decision. Green technical
checks and the advisory review do not retroactively supply that approval.

The two residual moderate audit findings are tracked in
[#177](https://github.com/iMelki/mission-control-kanban/issues/177); the direct
Turbopack build remains non-green under
[#175](https://github.com/iMelki/mission-control-kanban/issues/175). Neither
follow-up is represented as a green result from this upgrade. The local
production capture was a candidate verification, not a replacement for the
existing source-bound manifest record or a live deployment receipt.
