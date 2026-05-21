# First-Run Operator Guide

Last updated: 2026-05-21

This guide explains how Mission Control Kanban (`MCK`), GitHub, and OpenClaw
fit together in this workspace.

## Local Endpoints In This Workspace

- MCK web app: `http://127.0.0.1:3002`
- OpenClaw gateway: `ws://127.0.0.1:28789`
- OpenClaw config: `C:\Users\Milky\.openclaw\openclaw.json`
- OpenClaw session store:
  `C:\Users\Milky\.openclaw\agents\main\sessions\sessions.json`

At the time of writing, MCK is connected to the local OpenClaw gateway and the
gateway is advertising two live sessions for the default `main` agent.

## What Each System Owns

### GitHub

GitHub is the durable source of truth for:

- the issue itself
- GitHub Project fields
- human review state
- write-back comments and Project status updates

### MCK

MCK is the local operator surface for:

- importing GitHub issues into a local queue
- previewing the dispatch contract before work starts
- tracking local task state, planning state, and assignment
- staging dry-run write-back plans before anything is applied upstream

### OpenClaw

OpenClaw is the runtime and session transport for agent activity:

- WebSocket gateway connectivity
- agent identity and session state
- chat/session replay
- runtime-side execution and presence

MCK talks to OpenClaw over WebSocket. MCK talks to GitHub through local API
routes that use `gh api` plus your local GitHub token.

## First Use: Import A GitHub Issue

1. Open `http://127.0.0.1:3002`.
2. In the Mission Queue header, click **Import GitHub**.
3. Paste a full GitHub issue URL such as
   `https://github.com/iMelki/projects-ops/issues/6`.
4. Click **Load from GitHub**.
5. If the issue belongs to one or more GitHub Project items, pick the correct
   item from the dropdown.
6. Read the preview before creating anything local.

The preview shows:

- the proposed local task title and description
- the linked GitHub repo and issue number
- GitHub Project fields that MCK could read
- dispatch blockers such as missing `Allowed File Scope`
- whether the task is ready to enter active work states

7. Click **Create Local Task** only when the preview looks right.
8. Open the new task card. If it is still in `Inbox`, read the inline blocker
   note on the card and the dispatch-blocker panel inside the task modal.
9. Fill the dispatch-contract fields until the blocker list is empty.
10. Open the **GitHub Write-Back** panel in the same modal and run
   **Dry Run** before you apply anything upstream.

## What “Import Preview” Actually Does

When you click **Load from GitHub**, MCK does not create a task yet.

Instead it:

1. Calls `POST /api/github/load-issue`.
2. Uses `gh api` with `GH_GENERAL_TOKEN` or `GITHUB_TOKEN`.
3. Reads the GitHub issue body and any linked GitHub Project item fields.
4. Maps those values into the local dispatch contract.
5. Shows you blockers before any local task is created.

That is why import preview exists: it is a dry read-and-map step, not a write.

## How MCK Maps GitHub Into Local Work

MCK stores two separate structures on the local task:

- `github_source`
  - `repo_owner`
  - `repo_name`
  - `issue_number`
  - `issue_url`
  - `project_item_id`
- `dispatch_metadata`
  - `target_repo`
  - `project_workstream`
  - `allowed_file_scope`
  - `acceptance_criteria`
  - `test_requirements`
  - `risk_level`
  - `readiness`
  - `review_mode`
  - `impact`
  - `rollback_plan`
  - `safety_rules`

MCK reads these values from:

- GitHub issue-body headings, when present
- GitHub Project fields, when present

The Project fields now act as a first-class fallback, which is important when
the issue body is short but the dispatch contract lives in the GitHub Project.

## Why A Task Can Be Blocked In MCK

Imported GitHub tasks are not allowed to move into active execution states
until the dispatch contract is complete.

The current enforced blockers are:

- `Allowed File Scope`
- `Acceptance Criteria`
- `Test Requirements`
- `Review Mode`
- `Impact`
- `Rollback / Fallback Plan`

If one of those is missing, MCK returns a `409` and keeps the task out of
`assigned`, `in_progress`, `testing`, `review`, and `done`.

This is deliberate. The point is to stop “start work now, figure out scope
later” drift.

The UI now exposes that rule in two places:

- the task card shows a short `Still in Inbox...` explainer
- the task modal lists the exact blocking fields before you try to move it

## How GitHub Write-Back Fits In

After a local task exists, MCK can prepare a GitHub write-back plan.

The first-class operator path is now inside the task modal itself under the
**GitHub Write-Back** panel.

### Dry run

Dry run does not change GitHub. It prepares:

- the issue comment body that would be posted
- the GitHub Project field updates that would be applied
- warnings if a required Project field or Project item ID is missing

### Apply

Apply is the real mutation step. It writes:

- the issue comment
- selected GitHub Project field changes

Use dry run first. Apply only after the preview looks correct.

## How To Verify The Connections

### GitHub issue read

Import a known issue URL. If the modal shows the real issue title and body,
GitHub issue read is working.

### GitHub Project read

If the modal shows Project-linked fields such as `Status`, `Priority`, `Risk`,
or `Readiness`, GitHub Project read is working.

### OpenClaw connectivity

Check:

- `http://127.0.0.1:3002/api/openclaw/status`
- `http://127.0.0.1:3002/api/openclaw/sessions`

If `connected: true` is returned, MCK can currently talk to OpenClaw.

## How To Access OpenClaw Directly

You do not normally talk to OpenClaw by typing raw WebSocket messages.

Practical ways to access it are:

- through MCK’s OpenClaw-backed UI and API routes
- through the local OpenClaw CLI
- by inspecting `C:\Users\Milky\.openclaw\openclaw.json`
- by inspecting session files under `C:\Users\Milky\.openclaw\agents\`

In this workspace, the active default agent is `main`. A second configured
agent, `railway-manager-claw-dev`, exists but is currently idle.

## Current Local Reality

As of 2026-05-21:

- MCK is running on port `3002`
- the local OpenClaw gateway is reachable on port `28789`
- GitHub reads are using `GH_GENERAL_TOKEN`
- GitHub issue import is working
- GitHub Project field reads are working
- dispatch-contract enforcement is working on imported tasks

## Related Docs

- `docs/GITHUB_IMPORT_PREVIEW.md`
- `docs/GITHUB_WRITEBACK.md`
