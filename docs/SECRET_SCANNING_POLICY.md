# Secret Scanning Policy

Mission Control Kanban uses explicit `scanning-only` enforcement. Git clean and
smudge filters are not a security boundary and are not configured for this
repository.

## Enforcement Layers

1. The local pre-commit configuration runs Gitleaks `v8.24.0` against staged
   Git content.
2. `.github/workflows/secret-scan.yml` runs the Gitleaks v3 action from the
   immutable commit `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` with full
   history on pull requests and `main` pushes.
3. GitHub secret scanning and push protection provide an additional server-side
   layer for this public repository.

Local hooks can be bypassed, so a local pass is never sufficient by itself.
The pull-request job is the required independent readback before promotion.

## Migration And Recovery

The 2026-07-21 migration used git-toolkit's plan-first operator. It copied the
legacy `.git-secrets.json` as opaque bytes to the current user's private
`~/.secrets/git-toolkit-migrations/mission-control-kanban/` tree, recorded size
and SHA-256 without reading or logging values, removed local `filter.secrets.*`
configuration and the six `filter=secrets` rules, then proved all other tracked
worktree bytes were unchanged.

The private backup is rollback material, not an active secret store. Restoring
it or the old filter is a separate reviewed recovery action. Do not commit,
upload, inspect, or paste the backup into an issue or log.

## Verification

```powershell
pwsh -File S:\source\CCAI\Assistants\tools\git-toolkit\secrets\Test-ScanningOnlyCanary.ps1 `
  -RepoPath S:\source\CCAI\Assistants\tools\mission-control-kanban -Json

pwsh -File S:\source\CCAI\Assistants\tools\git-toolkit\hooks\Invoke-RepoHealthAudit.ps1 `
  -RepoPath S:\source\CCAI\Assistants\tools\mission-control-kanban -Json
```

The canary must report that the generated positive fixture was blocked, the
harmless fixture passed, the canary was not printed, and both temporary index
and worktree entries were removed.
