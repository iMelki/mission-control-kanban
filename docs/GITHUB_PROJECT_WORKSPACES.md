# GitHub Project Workspaces

MCK keeps GitHub as the durable task source of truth. A project-backed MCK
workspace is a local cockpit view of a GitHub Project, not a replacement board.

## Built-In Mappings

| MCK workspace | GitHub Project | Purpose |
| --- | --- | --- |
| `default` | none | Scratch/operator workspace for ad hoc local tasks. |
| `assistants` | `iMelki` project `#13` | Cross-repo Assistants operator cockpit. |
| `memsys` | `iMelki` project `#12` | Memory-system cockpit. |
| `content-factory` | `iMelki` project `#14` | Content Factory cockpit. |
| `asimtop` | `iMelki` project `#8` | Asimtop Trading Automation cockpit; starts with auto-refresh off and requires manual sync proof before scheduled sync. |

The initial mappings are seeded by database migration `008`; Asimtop is added by migration `012`. They are also declared in
`src/lib/github-project-sync.ts` so tests can protect the expected project
numbers.

## Sync Behavior

When a project-backed workspace opens, MCK calls:

```http
POST /api/workspaces/{workspaceId}/github-sync
```

The route reads the linked GitHub Project with the local GitHub token and:

- imports open GitHub issue items that are not already local tasks
- refreshes local title, description, priority, GitHub source identity, and
  dispatch metadata for existing imported tasks
- reconciles existing imported tasks to local `done` when the GitHub issue is
  closed or the Project `Status` field is `Done`
- moves an existing local task into the mapped workspace when its GitHub Project
  item belongs there
- skips archived items, draft items, pull requests, closed issues, and Project
  `Done` items that were never imported locally

The sync does not write to GitHub, dispatch agents, or rewrite issue bodies.
It preserves local workflow status for ordinary metadata refreshes so active
work is not churned backward just because the Project item is still `Ready`.
Completion status is the exception: GitHub closed/Project `Done` is allowed to
move local imported work to `done`.

## Status Mapping

| GitHub Project or issue state | MCK behavior |
| --- | --- |
| Issue closed | Existing local task becomes `done`; fresh imports are skipped. |
| Project `Status = Done` | Existing local task becomes `done`; fresh imports are skipped. |
| Project `Status = Review` | Existing non-done local task moves to `review`. |
| Project `Status = Ready` | Planning imports can move into the local `inbox` gate; already-started local work is not pulled backward. |
| Project `Status = Blocked` | Local status is preserved and the sync returns an upstream drift warning because MCK does not yet have a first-class `blocked` column. |

The workspace banner shows status reconciliations and upstream drift warnings
after a manual or auto sync. n8n sync history and recurring projects-ops health
reports also carry `status_reconciled` and `upstream_drift_warnings` counts so
local/GitHub status mismatches are not hidden inside raw sync payloads.

Use the visible **Sync now** control in the workspace banner to run the same
workspace-level sync manually. Pass `{ "dry_run": true }` to the API route to preview
create/update/move/reconciliation counts without changing the local database.

## Required Token

The sync route needs `GH_GENERAL_TOKEN` or `GITHUB_TOKEN` with issue read and
GitHub Project read access. Write scope is not used by this route; write-back
remains bounded to the existing task-level GitHub write-back flow.
