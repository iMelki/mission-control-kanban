# GitHub to MCK sync: field-authority contract

Status: contract, CTO-owned. Step 2 of the 2026-11-12 Kanban sync plan.
Dev builds the remaining behaviour (tombstones and the TODOs below) in a
follow-up PR. Until that PR lands, sections marked **Current code** describe
what `dev` does today and sections marked **Required** describe what the
follow-up must make true.

Code references are to `dev` after
[#212](https://github.com/iMelki/mission-control-kanban/pull/212) (merge
`f7b43eff`) and the dev-to-main rollup
[#224](https://github.com/iMelki/mission-control-kanban/pull/224).

## 1. Scope and code paths

Every GitHub to MCK refresh goes through one patch builder:

- Scheduled and manual Project sync:
  `POST /api/workspaces/:id/github-sync` (`src/app/api/workspaces/[id]/github-sync/`)
  calls `syncLoadedGitHubProjectWorkspace` in `src/lib/github-project-sync.ts`.
  n8n runs reach the same path (see `docs/N8N_SCHEDULED_SYNC.md`).
- In-app refresh (`src/components/GitHubWritebackPanel.tsx`) uses the same
  patch helper.
- Preview: `buildGitHubImportPreview` in `src/lib/github-task-import.ts`
  derives title, description, priority, `dispatch_metadata` and
  `github_source` from the issue, its labels and its Project fields.
- Patch: `buildTaskRefreshUpdateFromGitHubPreview` in
  `src/lib/github-task-import.ts` merges the preview into the stored task.
- Contract merge: `mergeDispatchMetadataFromUpstream` in
  `src/lib/dispatch-contract.ts`.
- Source identity merge: `mergeGitHubSourceFromUpstream` in
  `src/lib/github-task-import.ts`.
- Status: `reconcileGitHubProjectStatus` and `normalizeGitHubProjectStatus`
  in `src/lib/github-project-sync.ts`.
- Dispatch gate: `validateDispatchMetadata` in `src/lib/dispatch-contract.ts`.

## 2. Who owns which field

| Field | Owner | MCK storage | Rule |
| --- | --- | --- | --- |
| Title | GitHub issue | `tasks.title` | Refreshed from the issue. |
| Body | GitHub issue | `tasks.description` | Refreshed from the issue. An empty body keeps the local value (`description: issueBody \|\| undefined`, then `preview.description ?? currentTask.description`). |
| State (open or closed) | GitHub issue | Not stored as a field. Feeds status reconciliation only. | See section 6. |
| Labels | GitHub issue | Not stored as a field. `priority:`, `readiness:` and `risk:` labels feed `priority`, `dispatch_metadata.readiness` and `dispatch_metadata.risk_level` as a fallback after Project fields and body sections. | MCK never writes labels. |
| Status | GitHub Project (`Status` field) | `tasks.status` (the MCK column) | The column is derived from Project Status. See section 6. |
| Dispatch contract (`dispatch_metadata.*`) | Merged per field | `tasks.dispatch_metadata` (JSON) | See sections 3 to 5. |
| Source identity (`github_source.*`) | GitHub, merged per subfield | `tasks.source_repo_owner`, `source_repo_name`, `source_issue_number`, `source_issue_url`, `source_project_item_id` | Same per-field rule as the contract. |
| `dispatch_ready` | Derived, never stored | Recomputed by `validateDispatchMetadata` | Never synced in either direction. |

MCK does not write title, body, state or labels back to GitHub. The write-back
path (`src/lib/github-writeback.ts`) only posts an issue comment and updates
the Project fields in `ALLOWED_PROJECT_FIELDS`
(`status`, `agent`, `readiness`, `reviewmode`). See section 6 for the limit on
writing Status.

## 3. Per-field merge

**Current code (holds, keep it).** `mergeDispatchMetadataFromUpstream` starts
from the local record and, for each upstream key, strips placeholders with
`stripGenericSyncPlaceholders`, then overwrites the local key only when what
is left is non-empty (`isNonEmptyDispatchValue`). `mergeGitHubSourceFromUpstream`
does the same per subfield through `isUsableGitHubSourceSubfield`.

Rules:

1. Fields are merged one at a time. There is no whole-object replace. (The
   pre-#212 bug was `preview.dispatch_metadata ?? currentTask.dispatch_metadata`.)
2. An empty upstream value never clears a local value. Empty means missing,
   `null`, a whitespace-only string, an empty array, or an array with only
   empty or placeholder items.
3. A non-empty, non-placeholder upstream value refreshes the local value,
   except for the fields listed in section 7 once that TODO is decided.
4. The only way a local value becomes empty is a tombstone (section 4).

## 4. Clears are tombstones, never silent deletes

**Current code.** No tombstone exists. Because empty upstream never clears, a
field cannot be cleared by sync at all today. A local edit through the task
API can still overwrite or blank a field with no record.

**Required (Dev's Step 2 PR).**

1. A clear is any change that takes a contract field, a `github_source`
   subfield, or the task body from a non-empty value to empty.
2. Every clear writes a tombstone record with at least:
   - `task_id`
   - `field` (for example `dispatch_metadata.allowed_file_scope`)
   - `old_value` (the full previous value, JSON)
   - `source` (who or what cleared it: an MCK user or agent id, or
     `github:<owner>/<repo>#<n>` plus the sync run id)
   - `cleared_at` (UTC, ISO 8601 with `Z`)
3. Tombstones are append-only. They are kept, not pruned with run history, and
   shown on the card (and in the API task read) so an operator can see what
   was cleared, by whom and when.
4. Only a tombstone can clear a local value. Code paths that would blank a
   field without writing a tombstone in the same transaction must refuse.
5. An upstream clear must be explicit. An empty or missing upstream section is
   never a clear (section 3, rule 2). The explicit upstream clear signal is a
   TODO for Dev to propose in the Step 2 PR; it must not be the empty string,
   a placeholder, or a missing heading.
6. Restoring a value after a tombstone is a normal write. The tombstone stays.

## 5. Placeholders

**Current code (holds, keep it).** `GENERIC_SYNC_PLACEHOLDER_STRINGS` in
`src/lib/dispatch-contract.ts` is the trimmed denylist from the projects-ops
scripts `scripts/Ensure-RepoIssueProjectVisibility.ps1` and
`scripts/Invoke-GitHubProjectMutation.ps1`, plus the live MemSys variants
added in #212 (the four Safety Rules strings and the comma-split Allowed File
Scope pieces). `isGenericSyncPlaceholder` matches each item exactly after
trim, case-sensitive, and also matches any `;`, LF or CRLF join or subset of
items. Commas are not separators for matching.

Rules:

1. A placeholder upstream value counts as empty. It never overwrites a local
   value (`stripGenericSyncPlaceholders` runs before the non-empty check).
2. A mixed upstream value keeps only its non-placeholder parts.
3. A field that holds only placeholder text counts as missing in
   `validateDispatchMetadata`, so `canDispatch` is false and the card is not
   dispatchable, whatever its Readiness, Review Mode or Risk say.
4. A placeholder is never a clear and never produces a tombstone.
5. New placeholder strings are added to the exported list only, with a source
   citation, and a test.

## 6. Status, Done and Review

**Current code.**

- `normalizeGitHubProjectStatus` maps Project Status text to
  `ready | review | blocked | done | other`.
- `reconcileGitHubProjectStatus`: a closed issue, or Project Status Done, sets
  the local column to `done`. Project Status Review sets `review`. Ready moves
  `planning` to `inbox`. Blocked has no MCK column and keeps the local status
  with a drift warning. A local `done` against a non-Done Project Status
  stays `done` and raises a drift warning.
- A closed issue with no existing card is skipped (`skipped_closed`).
- MCK has no merge-event code path. No PR merge moves a card today.
- Write-back can set the Project `Status` field from the local column
  (`buildDesiredProjectUpdates`). It never closes an issue.

Rules:

1. The GitHub Project `Status` field is the authority. The MCK column is
   derived from it on every refresh.
2. A local Done never closes a GitHub issue. No MCK code path may call the
   issue close API.
3. A dev-only merge never moves a card to Done or Review, in MCK or on the
   Project.
4. Only a merge to `main` (or the repo's production branch), or a closed issue
   with evidence, can move a card to Done or Review. Evidence means a linked
   merged PR into `main`, or a closing comment that names what shipped.
5. TODO for Dev: a closed issue currently maps to `done` with no evidence
   check. The Step 2 PR (or a named follow-up) must either require evidence or
   record the close as a drift warning instead of a move.
6. TODO for Dev: write-back of `Status = Done` or `Status = Review` from a
   local column must be refused unless rule 4 holds, so a local Done can never
   promote the Project.

## 7. Local-only fields

**Current code.** No field is hard-locked against upstream. Every
`dispatch_metadata` key (`source_issue_url`, `target_repo`,
`project_workstream`, `allowed_file_scope`, `acceptance_criteria`,
`test_requirements`, `risk_level`, `readiness`, `review_mode`, `impact`,
`rollback_plan`, `safety_rules`) stays local only while the upstream value is
missing, empty or placeholder-only. A non-empty upstream value for any of them
replaces the local value on refresh.

What reliably stays local on refresh today:

- Any contract key whose upstream heading, inline field and Project field are
  all missing, empty or placeholder-only. In practice this is most often
  `allowed_file_scope`, `test_requirements`, `rollback_plan`,
  `acceptance_criteria` and `safety_rules`, which are usually written in MCK.
- Task columns the sync `UPDATE` in `syncLoadedGitHubProjectWorkspace` does
  not write, for example `assigned_agent_id`. (`status` changes only through
  section 6. `workspace_id` and `business_id` are set from the mapped
  workspace on every refresh.)

**OPEN, not decided. TODO for Dev's follow-up PR.** The #212 Security Reviewer
raised a Medium finding on `src/lib/dispatch-contract.ts`: because the merge
is per key, anyone who can edit the issue body or Project fields can replace
`allowed_file_scope` (which becomes the factory `allowedPaths`),
`safety_rules` or `review_mode`, and the card stays dispatch-ready. Options for
Dev to propose, with tests:

- make those three keys local-only (upstream changes become drift warnings), or
- accept the upstream change but reset `readiness` so `canDispatch` is false
  until an operator re-confirms, or
- allow upstream to narrow but never widen them.

Until that PR merges, this contract does not treat those keys as either
GitHub-owned or local-only.

## 8. Freshness, coverage and alerts (Step 7)

**Current code.** `presentMckN8nSyncFreshness` in
`src/lib/n8n-sync-freshness.ts` marks the last report stale after twice the
longest schedule gap (32 hours for the 09:00 and 17:00 cadence). It uses the
`received_at` of the latest report, including failed ones. There is no
per-repo coverage.

**Required.**

1. Freshness is stamped only by a run that completed. A failed, partial or
   timed-out run never updates the freshness stamp.
2. Coverage is per repo: each mapped repo records its own last completed sync
   and item count. A whole-workspace stamp does not prove any one repo.
3. An alert fires when any repo's last completed sync is older than 32 hours.
   The watchdog that raises it runs independently of n8n.

## 9. Dry run versus apply

1. Manual webhook calls and scheduled runs are dry-run by default
   (`docs/N8N_SCHEDULED_SYNC.md`).
2. Switching scheduled sync to apply (`scheduledNonDryRunApproved = true` in
   the projects-ops schedule artifact) requires Captain's explicit yes, and
   only after a clean scheduled dry run is recorded.
3. Dry-run and apply results are reported separately.
4. A dry run never writes tombstones. It reports the tombstones it would write.

## 10. Test matrix for Dev's Step 2 PR

Existing tests that already cover parts of this contract (keep them):
`tests/github-sync.test.ts` - `placeholder upstream overwrite refused`,
`empty upstream keeps local value`, `placeholder-only field is not
dispatchable`, `partial upstream github_source keeps local subfields`,
`#114 first-item-only shape is not dispatchable`, `#561 full join is not
dispatchable`; `tests/github-project-sync-persistence.test.ts` -
`GitHub Project sync preserves locally authored dispatch contract fields when
the issue body omits them`.

Required new tests, run by `npm run test:github-sync` (the `github-sync` CI job
in `.github/workflows/ci.yml`):

| # | Test | Must prove |
| --- | --- | --- |
| T1 | clear writes a tombstone | Clearing a non-empty field writes one tombstone with `field`, `old_value`, `source` and a UTC `cleared_at`, in the same transaction as the clear. |
| T2 | clear without tombstone is refused | A code path that would blank a field without a tombstone fails and leaves the value. |
| T3 | tombstone is kept and shown | The tombstone survives later refreshes and history pruning and is returned on the task read. |
| T4 | empty upstream leaves local alone | Missing, `null`, whitespace, `[]` and all-empty arrays leave the local value and write no tombstone, through `syncLoadedGitHubProjectWorkspace` (persisted, not just the helper). |
| T5 | placeholder never overwrites | Every placeholder shape (single item, `;` join, LF and CRLF joins, first-item-only, comma pieces) leaves the local value and writes no tombstone. |
| T6 | placeholder-only is not dispatchable | Persisted card with a placeholder-only required field has `canDispatch = false`. |
| T7 | local Done never closes an issue | Moving a card to Done and running write-back makes no issue close call and no issue state change. |
| T8 | dev-only merge never moves to Done or Review | A merged PR into `dev` leaves the card column unchanged. |
| T9 | dry run writes no tombstones | A dry-run sync reports would-be tombstones and persists none. |

Step 7 adds: failed run does not stamp freshness, per-repo coverage, and the
32 hour alert.

## 11. Open TODOs for Dev

- [ ] Tombstone storage, UI and API (section 4) with T1 to T4, T9.
- [ ] Explicit upstream clear signal (section 4, rule 5).
- [ ] Security Medium from #212 on `allowed_file_scope`, `safety_rules`,
      `review_mode` (section 7). Not decided.
- [ ] Closed-issue evidence check (section 6, rule 5).
- [ ] Refuse write-back of Status Done or Review without rule 4 evidence
      (section 6, rule 6) with T7 and T8.
- [ ] Completion-only freshness, per-repo coverage, 32 hour alert (section 8).
