# GitHub Write-Back

Last updated: 2026-05-21

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

## Visible Operator UI

The write-back flow is no longer API-only.

For any task that has `github_source`, the task modal now shows a
**GitHub Write-Back** panel with:

- `Refresh`
- `Dry Run`
- `Apply`
- the latest planned issue comment body
- the current project-field update plan
- warnings and recent write-back activity

## Safety Boundaries

- GitHub issue bodies are never rewritten here.
- Acceptance criteria, rollback plans, and file-scope rules remain owned by
  GitHub issue definition, not by Kanban.
- `apply` mode requires `GH_GENERAL_TOKEN` or `GITHUB_TOKEN`.
- Project field updates require a token with GitHub Project read/write scope.
  The readiness card reports `limited` when issue comments can work but Project
  field reads are unavailable.
- If no GitHub Project item ID is linked, the route still plans/comments safely
  but skips project-field mutation.
- Duplicate apply requests with the same signature are skipped instead of being
  replayed blindly.

## Recommended Operator Flow

1. Use the **Import GitHub** flow to confirm source identity and dispatch
   metadata mapping first.
2. Create or update the local task only after the preview looks correct.
3. Open the task modal and use the **GitHub Write-Back** panel in dry-run mode
   to inspect the exact comment body and allowed field updates.
4. Only then run `Apply` with valid GitHub credentials.

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
- project-field-backed dispatch metadata, including safety and rollback fields

## Related

- `docs/GITHUB_IMPORT_PREVIEW.md`
- `projects-ops/docs/operations/github-native-sync-contract.md`
- `projects-ops/docs/operations/github-native-pipeline-slices.md`
