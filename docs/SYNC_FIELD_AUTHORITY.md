# GitHub to MCK sync: field-authority contract

Status: contract, CTO-owned. Step 2 of the 2026-11-12 Kanban sync plan.
Dev builds the remaining behaviour (tombstones and the TODOs below) in a
follow-up PR. Sections marked **Current code** describe what `dev` does today.
Sections marked **Required** describe what the follow-up must make true.

Code references are to `dev` at `43820e9`. #212 merged to `dev` as
`f7b43eff` and reached `main` in the dev-to-main rollup merge commit
`9763159` (`9763159613cad68e8a5d229e8fe3584d1c441b2f`, the merge of #224,
2026-11-17), whose second parent is `dev` `43820e9`. Line numbers are at
`43820e9` and will drift.

## 1. Scope and code paths

- Scheduled and manual Project sync:
  `POST /api/workspaces/:id/github-sync` (`src/app/api/workspaces/[id]/github-sync/route.ts`)
  calls `syncLoadedGitHubProjectWorkspace` in `src/lib/github-project-sync.ts`.
  n8n runs reach the same path (see `docs/N8N_SCHEDULED_SYNC.md`). Existing
  cards are written by the sync `UPDATE tasks` (about L773-805). New cards are
  written by the sync `INSERT INTO tasks` (about L856-880).
- In-app refresh: `src/components/GitHubWritebackPanel.tsx` (L224-232) builds
  a patch with `buildTaskRefreshUpdateFromGitHubPreview` and saves it through
  `PATCH /api/tasks/[id]` (`src/app/api/tasks/[id]/route.ts`).
- Preview: `buildGitHubImportPreview` in `src/lib/github-task-import.ts`
  derives title, description, priority, `dispatch_metadata` and
  `github_source` from the issue, its labels and its Project fields.
- Patch: `buildTaskRefreshUpdateFromGitHubPreview` in
  `src/lib/github-task-import.ts`.
- Contract merge: `mergeDispatchMetadataFromUpstream` in
  `src/lib/dispatch-contract.ts`.
- Source identity helper: `mergeGitHubSourceFromUpstream` in
  `src/lib/github-task-import.ts`. It merges per subfield, but the scheduled
  sync does not use its result today (see section 2 and TODO G1).
- Status: `reconcileGitHubProjectStatus` and `normalizeGitHubProjectStatus`
  in `src/lib/github-project-sync.ts`.
- Dispatch gate: `validateDispatchMetadata` in `src/lib/dispatch-contract.ts`.

## 2. Who owns which field

| Field | Owner | MCK storage | Rule |
| --- | --- | --- | --- |
| Title | GitHub issue | `tasks.title` | Refreshed from the issue. A default title (`'Untitled GitHub issue'` in the sync, `'Untitled GitHub issue import'` in the preview) is a placeholder and never replaces a real title (section 5, rule 7). |
| Body | GitHub issue | `tasks.description` | Refreshed from the issue. An empty body keeps the local value (`description: issueBody \|\| undefined`, then `preview.description ?? currentTask.description`). A placeholder-only body is treated like an empty one (section 5, rule 7). |
| State (open or closed) | GitHub issue | Not stored as a field. Feeds status reconciliation only. | See section 6. |
| Labels | GitHub issue | Not stored as a field. `priority:`, `readiness:` and `risk:` labels feed `priority`, `dispatch_metadata.readiness` and `dispatch_metadata.risk_level` as a fallback after Project fields and body sections. | MCK never writes labels. |
| Status | GitHub Project (`Status` field) | `tasks.status` (the MCK column) | The column follows Project Status, except Done and Review, which need evidence. See section 6. |
| Dispatch contract (`dispatch_metadata.*`) | Merged per field, owner per key in section 7 | `tasks.dispatch_metadata` (JSON) | See sections 3 to 5 and 7. |
| Source identity (`github_source.*`) | GitHub | `tasks.source_repo_owner`, `source_repo_name`, `source_issue_number`, `source_issue_url`, `source_project_item_id` | **Gap.** See below. |
| `business_id` | Mapped workspace (intended) | `tasks.business_id` | **Gap.** Hard-coded `'default'`. See below. |
| `dispatch_ready` | Derived, never stored | Recomputed by `validateDispatchMetadata` | Never synced in either direction. |

**Gap G1, source identity (TODO for Step 2).** The scheduled sync does not
merge `github_source` per subfield. The sync `UPDATE` (about L794-798) and
`INSERT` (about L869-873) write `source.*` straight from the preview and ignore
`patch.github_source`. In particular `source_project_item_id = source.project_item_id ?? null`
can blank a local value, because the Project field map sets
`'Project Item ID': item.id ?? ''` (`normalizeProjectFields`, L316). The test
`partial upstream github_source keeps local subfields`
(`tests/github-sync.test.ts` L968) covers only the helper, not the sync write.
Required: the sync `UPDATE` uses `patch.github_source`, and a missing or empty
upstream `project_item_id` never blanks the local one. Test T13 below.

**Gap G2, business_id (TODO).** The sync passes `business_id: 'default'` into
the preview request (L689), and the `UPDATE` (L793) and `INSERT` (L868) write
`preview.business_id`. So every synced card gets `business_id = 'default'`,
not a value from the mapped workspace. Dev decides whether the mapping should
carry a business id; until then this field is not authoritative.

MCK does not write title, body, state or labels back to GitHub. The write-back
path (`src/lib/github-writeback.ts`) posts an issue comment and updates the
Project fields in `ALLOWED_PROJECT_FIELDS` (`status`, `agent`, `readiness`,
`reviewmode`). Section 6 limits writing Status.

## 3. Per-field merge

**Current code (holds for `dispatch_metadata`, keep it).**
`mergeDispatchMetadataFromUpstream` starts from the local record and, for each
upstream key, strips placeholders with `stripGenericSyncPlaceholders`, then
overwrites the local key only when what is left is non-empty
(`isNonEmptyDispatchValue`).

Rules:

1. Fields are merged one at a time. There is no whole-object replace on sync.
   (The pre-#212 bug was `preview.dispatch_metadata ?? currentTask.dispatch_metadata`.)
2. An empty upstream value never clears a local value. Empty means missing,
   `null`, a whitespace-only string, an empty array, or an array with only
   empty or placeholder items.
3. A non-empty, non-placeholder upstream value refreshes the local value,
   subject to section 7 for the three security-sensitive keys.
4. The only way a local value becomes empty is a tombstone (section 4).
5. **Project field beats body.** When a GitHub Project field and a parsed
   issue-body section both give a value for the same key, the explicit Project
   field wins. A body-parsed value only fills a key whose Project field is
   empty. **Current code differs:** `buildGitHubImportPreview` lets body
   sections win over Project fields for `allowed_file_scope`,
   `acceptance_criteria`, `test_requirements`, `rollback_plan` and
   `safety_rules`, while Project fields already win for repo, readiness, review
   mode, risk, workstream and impact. TODO for Step 2 (test T19).

### 3.1 Concurrent edits and ordering

1. The winner of a conflict is decided per field by the owner in this contract,
   never by timestamp alone.
2. For a local-owned field (section 7), a local edit made after the last sync
   read always wins. Sync never writes local-owned fields in any case.
3. For a GitHub-owned field, the upstream value from a complete read wins. A
   local edit to a GitHub-owned field is shown as drift until GitHub matches.
4. Sync writes are idempotent (running the same read twice gives the same
   card) and ordered per card (one sync write per card at a time, applied in
   read order; an older read never overwrites a newer one for the same card).
5. **Current code** compares no timestamps or row versions. TODO for Step 2
   (test T16).

### 3.2 Failed or partial reads

1. A failed or partial read never blanks, clears or tombstones anything. This
   covers HTTP 403 or permission-redacted items, a truncated or failed page in
   pagination, a missing Project field set, and items removed from or archived
   on the Project.
2. On such a read, sync skips the affected card, logs the skip with the reason,
   and marks Sync STALE for that repo. The run is not complete for that repo
   and does not stamp its freshness (section 8.3).
3. An item that disappears from the Project is tombstoned only after two
   consecutive complete reads that both lack it.
4. **Current code:** a redacted item is counted as `skipped` ("not a GitHub
   issue", L634-636) and the run still reports complete. TODO for Step 2
   (test T17, T18).

## 4. Clears are tombstones, never silent deletes

**Current code.** No tombstone exists. Sync cannot clear a contract field
(empty upstream never clears), but other writers can blank or replace fields
with no record:

- `PATCH /api/tasks/[id]` (`src/app/api/tasks/[id]/route.ts` L165-167)
  replaces the whole `dispatch_metadata` object with whatever the body sends.
  The in-app refresh (`GitHubWritebackPanel.tsx` L224-232) uses this route.
- The sync `UPDATE tasks` (about L773-805) writes source columns directly
  (gap G1).

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
   shown on the card (and in the task API read) so an operator can see what was
   cleared, by whom and when.
4. Only a tombstone can clear a local value. Enforcement points: the sync
   `UPDATE tasks` in `syncLoadedGitHubProjectWorkspace` and
   `PATCH /api/tasks/[id]`. A write that would blank a field without writing a
   tombstone in the same transaction must refuse (or keep the old value).
5. An upstream clear must be explicit. An empty or missing upstream section is
   never a clear (section 3, rule 2). Dev proposes the explicit upstream clear
   signal in the Step 2 PR; it must not be the empty string, a placeholder, or
   a missing heading.
6. Restoring a value after a tombstone is a normal write. The tombstone stays.

## 5. Placeholders

**Current code (holds, keep it).** `GENERIC_SYNC_PLACEHOLDER_STRINGS` in
`src/lib/dispatch-contract.ts` (L108) is the trimmed denylist from the
projects-ops scripts `scripts/Ensure-RepoIssueProjectVisibility.ps1` and
`scripts/Invoke-GitHubProjectMutation.ps1`, plus the comma-split pieces of the
Allowed File Scope default. Every entry, including the Safety Rules strings, is
cited to those projects-ops scripts. MemSys's live variants did **not** land in
#212: the code comment says "MemSys-sourced strings, if they differ, are a
follow-up", and the 44 MemSys placeholder cards wait on that follow-up.
`isGenericSyncPlaceholder` matches each item exactly after trim,
case-sensitive, and also matches any `;`, LF or CRLF join or subset of items.
Commas are not separators for matching. Only `dispatch_metadata` goes through
this check today; the title and body do not.

Rules:

1. A placeholder upstream value counts as empty. It never overwrites a local
   value (`stripGenericSyncPlaceholders` runs before the non-empty check).
2. A mixed upstream value keeps only its non-placeholder parts.
3. A field that holds only placeholder text counts as missing in
   `validateDispatchMetadata`, so `canDispatch` is false and the card is not
   dispatchable, whatever its Readiness, Review Mode or Risk say.
4. A placeholder is never a clear and never produces a tombstone.
5. New placeholder strings are added to the exported list only, with a source
   citation, and a test. The MemSys variants are a follow-up PR on that list.
6. **Matching rule (Required).** Both the candidate value (and each token
   after the `;`, LF or CRLF split) and every denylist entry are normalized the
   same way before comparing: Unicode NFKC, then casefold, then trim and
   collapse internal whitespace to one space, then strip leading and trailing
   punctuation (including bullets and a trailing period or comma). Equal after
   normalization means placeholder. Current code is exact and case-sensitive.
   TODO for Step 2 (test T15).
7. **Title and body get the same check (Required).** A title or body that is
   empty or placeholder-only after the rule 6 normalization never replaces the
   local value. The default titles `'Untitled GitHub issue'` (sync, L677) and
   `'Untitled GitHub issue import'` (preview) count as placeholders. Current
   code writes both defaults and a placeholder-only body straight through
   `buildTaskRefreshUpdateFromGitHubPreview`. TODO for Step 2 (test T20).

**Note on bare `docs` and `scripts`.** These two are exact denylist entries
(L115-116, the comma-split pieces of the scope default). So a real scope that
lists them as items is narrowed: an upstream `allowed_file_scope` of
`docs; src/x` is stripped to `[src/x]`, and `docs` alone counts as empty.
Interaction with section 7: `allowed_file_scope` is local-owned, so sync never
writes it and the strip only affects what is shown as drift and what a new card
would have shown. Stripping can only narrow a scope, never widen it. Under the
rule 6 normalization the same applies to `Docs` or `scripts.`. An operator who
really means the whole `docs/` tree should write `docs/` or `docs/**`.

## 6. Status, Done and Review

**Current code.**

- `normalizeGitHubProjectStatus` maps Project Status text to
  `ready | review | blocked | done | other`.
- `reconcileGitHubProjectStatus` (L490-548; Done and Review at L497-509 and
  L524-529): a closed issue, or Project Status Done, sets the local column to
  `done`, and Project Status Review sets `review`, with no evidence check.
  Ready moves `planning` to `inbox`. A local `done` against a non-Done Project
  Status stays `done` and raises a drift warning.
- Blocked: MCK has no Blocked column today
  ([#214](https://github.com/iMelki/mission-control-kanban/issues/214), open).
  Project `Blocked` items keep their local column and show a drift warning
  until #214 lands. That drift is expected, not a sync fault.
- `skipped_closed` (L661-672) counts both a closed issue with no card and a
  Project Done item with no card. Neither is imported.
- MCK has no merge-event code path. No PR merge moves a card today.
- Write-back: `buildDesiredProjectUpdates` (`src/lib/github-writeback.ts`
  L219-222) always sends `Status = STATUS_LABELS[task.status]`, Done and
  Review included, with no evidence check. No code path closes an issue
  (write-back only comments and sets Project fields).

**Gap, fixed by Step 2.** The current code moves cards to Done and Review
without evidence: on Project Status Done, on Project Status Review, and on a
closed issue. The rules below are what Dev's Step 2 PR must make true; until it
merges, a Done or Review column on MCK is not proof that anything shipped.

**Required rules (CTO ruling).**

1. **Project Status sets the column, except Done and Review.** For every other
   Status value the MCK column follows the Project on each refresh.
2. **Done and Review need evidence.** Evidence is one of:
   - a merge to `main` (or the repo's production branch) from a PR linked to
     the issue, or
   - a closed issue with a linked `main` merge or explicit closing evidence (a
     closing comment or close reason that names what shipped).
3. **No evidence, no move, never silent.** When Project Status is Done or
   Review (or the issue is closed) without evidence, the card stays in its
   current column, gets a visible `needs evidence` flag on the card, and the
   sync writes a reconcile log entry (`status_reconcile` detail and activity)
   naming the issue, the upstream Status or close, and the missing evidence.
   This applies to closed issues too.
4. **A dev-only merge is never evidence.** A merge into `dev` (or any non-main
   branch) never moves a card to Done or Review, in MCK or on the Project.
5. **A local Done never closes a GitHub issue.** No MCK code path may call the
   issue close or state-change API.
6. **Write-back never promotes without evidence.** Write-back of
   `Status = Done` or `Status = Review` is refused or skipped (with a reason in
   the plan) unless rule 2 evidence exists for that issue.

## 7. Local-only fields and the #212 Security decision

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
- Task columns the sync `UPDATE` does not write, for example
  `assigned_agent_id`. (`status` changes only through section 6.
  `workspace_id` is set from the mapped workspace and `business_id` to
  `'default'` on every refresh, see G2.)

**Decided: owner per key (Required).**

| Key | Owner | Sync behaviour |
| --- | --- | --- |
| `allowed_file_scope`, `safety_rules`, `review_mode` | Local: the card owner or CTO | Sync never writes them, on update or on import. An upstream value that differs is shown on the card as drift and logged, and changes nothing. |
| `target_repo`, `project_workstream` | Local once set | Upstream fills them only when the local value is empty. A non-empty local value is never replaced. |
| `source_issue_url` | GitHub | Refreshed from a complete read (subject to G1). |
| `acceptance_criteria`, `test_requirements`, `rollback_plan`, `impact`, `risk_level`, `readiness` | GitHub, merged per field | Sections 3 and 5 apply. Sync may also set `readiness = needs_grooming` under section 8.1. |

Why: the #212 Security Reviewer raised a Medium finding on
`src/lib/dispatch-contract.ts`. With a per-key merge, anyone who can edit the
issue body or Project fields could replace `allowed_file_scope` (which becomes
the factory `allowedPaths`), `safety_rules` or `review_mode` and keep the card
dispatch-ready. Making those keys local-owned removes that path. This
supersedes the earlier "accept but reset readiness" option.

**Current code differs on `target_repo` and `project_workstream`:**
`normalizeProjectFields` (L308-316) always injects `Repo` (the issue repo) and
`Project` (the Project title), so upstream is never empty for these two and a
local value is replaced on every refresh, `project_workstream` by the Project
title. TODO for Step 2 (tests T12, T21).

## 8. Coverage, PRs, freshness and alerts

### 8.1 Every open Project item gets a card

**Current code.** Sync imports Project items whose content is an `Issue`
(L634-636). New cards are inserted at `status = 'inbox'` with the preview's
`dispatch_metadata`, so readiness can come straight from upstream. A Fleet
inventory on 2026-11-19 found 89 open issues on mapped Projects with no card.

**Required.**

1. Every open issue that is an item on a mapped GitHub Project gets a card on
   sync.
2. A newly created card always gets `readiness = needs_grooming`, whatever
   upstream says, so it is not dispatchable until groomed.
3. Closed issues and Project Done items with no card are still not imported
   (`skipped_closed`).

### 8.2 Pull requests are evidence, not cards

1. PRs are not cards. Sync skips Project items that are not issues on purpose
   (`item.content?.__typename !== 'Issue'`, L634-636).
2. A PR attaches to its linked issue's card only as evidence.
3. A `main` merge counts as Done or Review evidence (section 6, rule 2). A
   `dev` merge does not (section 6, rule 4).
4. Scope: linking PR evidence to cards (reading linked PRs, their base branch
   and merge state, and showing them on the card) is Step 2 scope where it
   gates Done and Review, and Step 7 scope for coverage reporting.

### 8.3 Freshness, per-repo coverage and alerts (Step 7)

**Current code.** `presentMckN8nSyncFreshness` in
`src/lib/n8n-sync-freshness.ts` marks the last report stale after twice the
longest schedule gap (32 hours for the 09:00 and 17:00 cadence). It uses the
`received_at` of the latest report, including failed ones. There is no
per-repo coverage.

**Required.**

1. Freshness is stamped only by a run that completed. A failed, partial or
   timed-out run never updates the freshness stamp.
2. Coverage is per repo: cards divided by open Project items for that repo. A
   missing card for an open Project item counts as a coverage gap. A
   whole-workspace stamp does not prove any one repo.
3. An alert fires when any repo's last completed sync is older than 32 hours.
   The watchdog that raises it runs independently of n8n.
4. A mapped repo that has never completed a sync shows Coverage UNKNOWN and
   raises a warning on every check until its first completed sync. It never
   shows as covered or fresh.
5. Freshness uses the MCK server's receive time, not a producer timestamp. A
   report dated in the future is not fresh, and a late old report never becomes
   the latest. Today `received_at` comes from the payload and `latest` is chosen
   by arrival order (`src/lib/n8n-sync-status.ts`).
6. A run whose summary carries any errors (a count or a non-empty `errors`
   array) is not complete. Today `asNumber(summary.errors)` turns an array into
   0 (`src/lib/n8n-sync-status.ts` L177).

## 9. Dry run versus apply

1. Manual webhook calls and scheduled runs are dry-run by default
   (`docs/N8N_SCHEDULED_SYNC.md`).
2. Switching scheduled sync to apply (`scheduledNonDryRunApproved = true` in
   the projects-ops schedule artifact) requires the repo owner's explicit yes, and
   only after a clean scheduled dry run is recorded.
3. Dry-run and apply results are reported separately.
4. A dry run never writes tombstones, flags or cards. It reports what it would
   write.

## 10. Test matrix for Dev's Step 2 PR

Existing tests that already cover parts of this contract (keep them):
`tests/github-sync.test.ts` - `placeholder upstream overwrite refused`,
`empty upstream keeps local value`, `placeholder-only field is not
dispatchable`, `partial upstream github_source keeps local subfields` (helper
only, see G1), `#114 first-item-only shape is not dispatchable`,
`#561 full join is not dispatchable`;
`tests/github-project-sync-persistence.test.ts` - `GitHub Project sync
preserves locally authored dispatch contract fields when the issue body omits
them`.

New tests run under `npm run test:github-sync` (the `github-sync` CI job in
`.github/workflows/ci.yml`). Required = must be in the Step 2 PR. The others
may follow in a named follow-up PR.

| # | Required | Test | Must prove |
| --- | --- | --- | --- |
| T1 | Yes | clear writes a tombstone | Clearing a non-empty field writes one tombstone with `field`, `old_value`, `source` and a UTC `cleared_at`, in the same transaction as the clear. |
| T2 | No | clear without tombstone is refused | A write through the sync `UPDATE` or `PATCH /api/tasks/[id]` that would blank a field without a tombstone fails or keeps the value. |
| T3 | No | tombstone is kept and shown | The tombstone survives later refreshes and history pruning and is returned on the task read. |
| T4 | Yes | empty upstream leaves local alone | Missing, `null`, whitespace, `[]` and all-empty arrays leave the local value and write no tombstone, through `syncLoadedGitHubProjectWorkspace` (persisted, not just the helper). |
| T5 | Yes | placeholder never overwrites | Every placeholder shape (single item, `;` join, LF and CRLF joins, first-item-only, comma pieces) leaves the local value and writes no tombstone. |
| T6 | No | placeholder-only is not dispatchable | Persisted card with a placeholder-only required field has `canDispatch = false`. |
| T7 | Yes | local Done never closes an issue | Moving a card to Done and running write-back makes no issue close call and no issue state change. (Passes today because no path closes issues; it guards against regressions.) |
| T8 | No | dev-only merge is not evidence | Fixture: a Project item at Status Done whose only evidence is a merged PR into `dev`. Sync leaves the card in its current column, sets `needs evidence`, and logs a reconcile entry. |
| T9 | No | dry run writes nothing | A dry-run sync reports would-be tombstones, flags and new cards and persists none. |
| T10 | Yes | Done or Review write-back without evidence is refused | A card in `done` or `review` with no rule 2 evidence produces a write-back plan where the `Status` update is refused or skipped with a reason (`buildDesiredProjectUpdates` today always sends it). |
| T11 | Yes | Done or Review without evidence never moves the card | Project Status Done, Project Status Review, and a closed issue, each without evidence: the card keeps its column, gets `needs evidence`, and a reconcile log entry is written. With a linked `main` merge the card moves. |
| T12 | Yes | sync never writes local-owned security keys | An upstream value for `allowed_file_scope`, `safety_rules` or `review_mode` that differs from local leaves the local value, keeps `canDispatch` unchanged, and logs drift; on import the keys are not taken from upstream. |
| T13 | Yes | missing upstream project_item_id never blanks local | A sync where the Project item id is missing or empty keeps `source_project_item_id`, through the persisted sync `UPDATE`. |
| T14 | Yes | open Project item with no card is imported as needs_grooming | An open issue on a mapped Project with no card is created on sync with `readiness = needs_grooming` and `canDispatch = false`, even when upstream says Ready for Agent. |
| T15 | Yes | normalized placeholder variants | Case, extra or Unicode-compatible whitespace, NFKC-equivalent characters, bullets and trailing punctuation around a denylisted string are all treated as placeholders and never overwrite. |
| T16 | Yes | concurrent edit and ordering | A local edit to a local-owned field after the last sync read survives the sync; an older upstream read applied after a newer one for the same card changes nothing; running the same read twice is idempotent. |
| T17 | Yes | failed or partial read changes nothing | A 403 or redacted item, a truncated page set, and a failed page each leave every card unchanged, write no tombstone, log the skip, and mark that repo Sync STALE. |
| T18 | No | removed item needs two complete reads | An item missing from one complete read is not tombstoned; missing from two consecutive complete reads, it is. |
| T19 | No | Project field beats body | When a Project field and a body section disagree, the Project field wins; the body only fills an empty key. |
| T20 | Yes | placeholder title or body never replaces local | `'Untitled GitHub issue'`, `'Untitled GitHub issue import'`, an empty title, and a placeholder-only body each leave the local title or description unchanged. |
| T21 | Yes | target_repo and project_workstream fill only when empty | A non-empty local `target_repo` or `project_workstream` survives a sync where the injected `Repo` or `Project` value differs; an empty local value is filled. |

Step 7 adds: failed run does not stamp freshness, per-repo coverage (cards
over open Project items), the 32 hour alert, the never-synced Coverage UNKNOWN
warning, server receive time, and error-array counting. Restart and retry
fault cases are covered by the S4 fault-injection plan.

## 11. Open TODOs for Dev

- [ ] Tombstone storage, UI and API, enforced in the sync `UPDATE` and
      `PATCH /api/tasks/[id]` (section 4) with T1 to T4 and T9.
- [ ] Explicit upstream clear signal (section 4, rule 5).
- [ ] Owner per key: sync never writes `allowed_file_scope`, `safety_rules`,
      `review_mode`; `target_repo` and `project_workstream` fill only when empty
      (section 7) with T12 and T21.
- [ ] Placeholder normalization and title and body check (section 5, rules 6
      and 7) with T15 and T20. MemSys variants as a follow-up on the list.
- [ ] Concurrency and ordering (section 3.1) with T16.
- [ ] Failed or partial reads and two-read removal (section 3.2) with T17 and
      T18.
- [ ] Project field beats body (section 3, rule 5) with T19.
- [ ] Done and Review evidence rule, `needs evidence` flag and reconcile log,
      closed issues included (section 6, rules 1 to 4) with T8 and T11.
- [ ] Refuse write-back of Status Done or Review without evidence (section 6,
      rule 6) with T7 and T10.
- [ ] G1: sync `UPDATE` uses `patch.github_source`; missing upstream
      `project_item_id` never blanks the local one (T13).
- [ ] G2: decide `business_id` source; today it is hard-coded `'default'`.
- [ ] Import every open Project item as a `needs_grooming` card (section 8.1)
      with T14.
- [ ] Link PR evidence to cards (section 8.2), Step 2 for the Done and Review
      gate, Step 7 for coverage.
- [ ] Completion-only freshness, per-repo coverage, 32 hour alert, never-synced
      warning, server receive time, error counting (section 8.3).
