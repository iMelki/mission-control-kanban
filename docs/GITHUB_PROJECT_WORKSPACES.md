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

The mappings are seeded by database migration `008` and are also declared in
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
- moves an existing local task into the mapped workspace when its GitHub Project
  item belongs there
- skips archived items, draft items, pull requests, and closed issues that were
  never imported locally

The sync does not write to GitHub, dispatch agents, or rewrite issue bodies.
It preserves local workflow status so refreshes do not silently move work across
MCK columns.

Use the visible **Sync now** control in the workspace banner to run the same
workspace-level sync manually. Pass `{ "dry_run": true }` to the API route to preview
create/update/move counts without changing the local database.

## Required Token

The sync route needs `GH_GENERAL_TOKEN` or `GITHUB_TOKEN` with issue read and
GitHub Project read access. Write scope is not used by this route; write-back
remains bounded to the existing task-level GitHub write-back flow.
