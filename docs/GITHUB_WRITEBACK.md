# GitHub Write-Back

Last updated: 2026-05-15

`mission-control-kanban#13` adds the bounded GitHub write-back slice for tasks
that already carry persisted GitHub source identity.

## What This Slice Does

- plans a bounded GitHub write-back from local Kanban workflow state
- writes a reviewable issue comment
- updates only an allowlisted set of GitHub Project fields:
  - `Status`
  - `Agent`
  - `Readiness`
  - `Review Mode`
- records each dry run or apply attempt in `github_writeback_logs`
- records an activity event so the operator can audit what happened locally

## API

### `POST /api/tasks/{id}/github-writeback`

Default behavior is dry-run mode.

Request body:

```json
{
  "dry_run": true
}
```

Response highlights:

- `mode`
- `status`
- `signature`
- `issue_comment_body`
- `project_updates`
- `warnings`
- `response_payload`
- `error_message`

### `GET /api/tasks/{id}/github-writeback`

Returns the latest local write-back log rows for the task.

## Safety Boundaries

- GitHub issue bodies are never rewritten here.
- Acceptance criteria, rollback plans, and file-scope rules remain owned by
  GitHub issue definition, not by Kanban.
- `apply` mode requires `GH_GENERAL_TOKEN` or `GITHUB_TOKEN`.
- If no GitHub Project item ID is linked, the route still plans/comments safely
  but skips project-field mutation.
- Duplicate apply requests with the same signature are skipped instead of being
  replayed blindly.

## Recommended Operator Flow

1. Use `POST /api/github/import-preview` to confirm source identity and dispatch
   metadata mapping first.
2. Create or update the local task only after the preview looks correct.
3. Use `POST /api/tasks/{id}/github-writeback` in dry-run mode to inspect the
   exact comment body and allowed field updates.
4. Only then run `apply` mode with valid GitHub credentials.

## Repo-Owned Validation

Run the GitHub sync test file:

```powershell
npm run test:github-sync
```

This covers:

- import-preview mapping from GitHub issue/project metadata
- duplicate-import blocking
- bounded write-back planning without live GitHub credentials
- activity-message wording for dry-run versus apply flows

## Related

- `docs/GITHUB_IMPORT_PREVIEW.md`
- `projects-ops/docs/operations/github-native-sync-contract.md`
- `projects-ops/docs/operations/github-native-pipeline-slices.md`
