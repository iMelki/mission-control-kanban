# GitHub Import Preview

Last updated: 2026-05-21

`mission-control-kanban#12` adds the first GitHub-native import slice without
making Kanban the source of truth.

## What This Slice Does

- persists GitHub source identity on local tasks:
  - `repo_owner`
  - `repo_name`
  - `issue_number`
  - `issue_url`
  - `project_item_id`
- rejects duplicate imports for the same GitHub issue
- exposes a dry-run preview endpoint before any local task is created
- maps GitHub issue body sections and Project fields into the existing
  dispatch contract

## API

`POST /api/github/import-preview`

## First-Run Operator Flow

The app now exposes a workspace-level **Import GitHub** button.

1. Open a workspace, not just the dashboard home.
2. Click **Import GitHub** in the Mission Queue header.
3. Paste a GitHub issue URL such as
   `https://github.com/iMelki/projects-ops/issues/6`.
4. Click **Load from GitHub**.
5. If the issue is linked to one or more GitHub Project items, pick the correct
   project item from the dropdown.
6. Review the preview:
   - proposed local task title
   - GitHub Project fields captured by MCK
   - allowed file scope
   - acceptance criteria
   - test requirements
   - rollback / fallback plan
   - import blockers and dispatch blockers
7. Click **Create Local Task** only when the preview looks correct.

This UI flow uses the same dry-run API described below; GitHub remains the
source of truth and MCK only creates the linked local task after the preview is
accepted.

After the task exists locally, the Mission Queue card itself now explains why
an imported task can remain in `Inbox`:

- scope is still incomplete
- tests are still unspecified
- rollback/fallback is still missing

That means the operator no longer has to guess whether the board is broken or
whether the task contract is simply incomplete.

Request shape:

```json
{
  "issue": {
    "number": 25,
    "title": "Implement dry-run GitHub issue classification workflow",
    "body": "## Goal\n...",
    "html_url": "https://github.com/iMelki/projects-ops/issues/25",
    "labels": ["type:automation", "area:workflow"]
  },
  "repository": {
    "full_name": "iMelki/projects-ops",
    "name": "projects-ops",
    "owner": { "login": "iMelki" }
  },
  "project_fields": {
    "Repo": "iMelki/projects-ops",
    "Project": "GitHub-native pipeline",
    "Readiness": "Ready for Agent",
    "Review Mode": "Human Required",
    "Risk": "Medium",
    "Priority": "High",
    "Impact": "workflow automation",
    "Project Item ID": "PVTI_mock_25"
  }
}
```

Response shape:

- `source_identity`: normalized GitHub identity
- `preview`: proposed local task payload
- `blockers`: import blockers, including duplicate-import protection
- `warnings`: non-blocking safety warnings
- `dispatch_ready`: whether the dispatch contract is green
- `dispatch_blockers`: dispatch-specific blockers
- `existing_task`: populated when the issue was already imported

## Body Section Mapping

The preview mapper currently extracts these sections when present:

- `Target Repo`
- `Project / Workstream`
- `Allowed File Scope`
- `Acceptance Criteria`
- `Test Requirements`
- `Safety Rules`
- `Rollback / Fallback Plan`

The mapper also reads Project fields for `Repo`, `Project`, `Readiness`,
`Review Mode`, `Risk`, `Priority`, `Impact`, and `Project Item ID`.

## Current Limits

- this slice does not write back to GitHub
- this slice does not create the task automatically
- this slice does not mutate issue bodies or scope fields
- actual GitHub write-back remains `mission-control-kanban#13`

## Related

- `docs/FIRST_RUN_OPERATOR_GUIDE.md`
- `projects-ops/docs/operations/github-native-sync-contract.md`
- `projects-ops/docs/operations/github-native-pipeline-slices.md`
- `docs/GITHUB_WRITEBACK.md`

## Repo-Owned Validation

Run:

```powershell
npm run test:github-sync
```

The shared GitHub sync test file covers both the import-preview mapper and the
bounded write-back planner so the two slices stay aligned.
