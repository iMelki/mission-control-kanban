# Component sourcing preflight gate

This directory backs the mechanical component-sourcing gate (fleet pilot; see #139 and
iMelki/agent-settings#586). The gate enforces the Required Preflight Record rule from the
shared sourcing workflow before any new UI component lands in `src/components`.

## How it works

`scripts/verify-component-sourcing-preflight.mjs` (zero dependencies, <1s) runs from the
`component-sourcing-preflight` hook in `.pre-commit-config.yaml` whenever a file under
`src/components/**/*.{tsx,jsx}` changes (the CI pre-commit job runs it automatically):

1. It inventories every `.tsx`/`.jsx` file under `src/components`.
2. Files listed in `component-baseline.json` are grandfathered (`{file, reason}` entries).
   The baseline only ratchets down: an entry whose file no longer exists FAILS the gate
   until the entry is removed.
3. Every remaining file must be matched by a `Covers:` line (exact repo-relative path or
   glob) in at least one record under `records/*.md` that contains all 7 sourcing-record
   fields with non-placeholder values (TODO/TBD/n-a are rejected).

## Writing a record

Copy the 7-field record from the shared prompt
`agent-settings/shared/prompts/frontend-component-sourcing.md` (resolve your local
`agent-settings` checkout via the `AGENT_SETTINGS_ROOT` environment variable; on the
canonical operator machine that is `S:\source\CCAI\Assistants\agent-settings`)
into `records/<date>-<slug>.md`, fill every field, and add a `Covers:` line naming the
component file(s). Validate the record body with the shared PowerShell checker:

```powershell
# Set AGENT_SETTINGS_ROOT to your local agent-settings checkout first, e.g.
#   $env:AGENT_SETTINGS_ROOT = 'S:\source\CCAI\Assistants\agent-settings'
pwsh -File $env:AGENT_SETTINGS_ROOT\shared\tools\Test-FrontendComponentSourcingPreflight.ps1 `
  -BodyFile docs\preflight\records\<date>-<slug>.md -RequireKnownPoolMention -Json
```

Reviewed exceptions go into `component-baseline.json` as `{file, reason}` — a reviewed
decision, not a convenience escape hatch.

## Honesty gap (named on purpose)

The gate enforces record EXISTENCE, structure, and coverage only. Record QUALITY — whether
the sourcing ladder was genuinely walked, whether the chosen lane is right — stays a review
concern. A mechanically green gate is not proof the sourcing decision was good.
