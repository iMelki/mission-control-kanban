# Scheduled n8n GitHub Project Sync

This is the operator guide for the twice-daily n8n schedule that refreshes
MCK's GitHub Project workspaces, and for keeping both MCK and n8n on localhost
only.

## How The Schedule Is Supposed To Work

Two independent sync paths exist (see also
[GITHUB_PROJECT_WORKSPACES.md](GITHUB_PROJECT_WORKSPACES.md)):

- **In-app, including Sync now.** `POST /api/workspaces/{workspaceId}/github-sync`
  runs inside MCK. The workspace banner **Sync now** control uses this path.
  It does not need n8n, and it is the path that actually applies local-mirror
  updates when an operator presses the button.
- **Scheduled n8n sync.** The workflow `Projects Ops - MCK Project Workspace
  Sync` (`PrjOpsMckSync001`) lives in the local n8n instance (versioned in the
  projects-ops workflow pack, not in this repo). A `scheduleTrigger` fires at
  `09:00` and `17:00` `Asia/Jerusalem`. For each workspace slug it calls
  `POST {mckBaseUrl}/api/workspaces/{slug}/github-sync`, then records the
  result with `POST {mckBaseUrl}/api/n8n/mck-sync-status`. MCK's drawer reads
  `/api/n8n/mck-sync-status` and treats a last report older than twice the
  longest schedule gap as stale (32 hours for the 09:00/17:00 cadence; see
  `src/lib/n8n-sync-freshness.ts`).

Default `mckBaseUrl` is `MCK_N8N_BASE_URL`, then `MCK_BASE_URL`, then
`http://mck.host:3021`. Manual webhook calls default to dry-run. Scheduled
runs are also dry-run until the projects-ops schedule artifact sets
`scheduledNonDryRunApproved` to `true`. While that flag is false, a healthy
schedule still *reports* (the drawer "Last run" updates) but does not apply
local-mirror writes; **Sync now** remains the applying path.

## Localhost Bind

`npm run dev:n8n` starts MCK on `127.0.0.1:3021` only. It must not pass
`--hostname 0.0.0.0`. `tests/env-example-port.test.mjs` asserts this.

The n8n UI and webhooks belong on `http://127.0.0.1:5678`. When n8n is
Docker-backed, restrict the *host* publish to loopback, for example
`127.0.0.1:5678:5678` and `127.0.0.1:5030:3000`. Do not set
`N8N_LISTEN_ADDRESS=127.0.0.1` *inside* the container: Docker's port publish
forwards to the container's `0.0.0.0:5678`, and a container-only loopback
bind would make the published host port miss. The host-side bind is what
keeps n8n off the LAN.

Because MCK itself listens on `127.0.0.1` only, Docker n8n cannot reach it
through a Tailscale or LAN address mapped onto `mck.host` (that path fails
with `ECONNREFUSED` on the Tailscale IP:3021). Docker Desktop on Windows
often also cannot reach a `127.0.0.1`-only host port via `host-gateway`.
The reliable pairing is: MCK on `127.0.0.1:3021`, and n8n on the host
(not only in Docker) calling `http://127.0.0.1:3021`. If n8n stays in
Docker, prove reachability with the projects-ops endpoint-alignment script
and require `status=aligned` before treating the schedule as healthy.

## When The Drawer Says The Schedule Is Dead

Typical causes, in the order to check them (all read-only until an operator
approves a start or config change):

1. **n8n is not running.** Nothing listens on `127.0.0.1:5678`. Docker Desktop
   may be stopped, and there may be no Task Scheduler entry that starts the
   n8n stack (MCK's LocalNext watchdog starts MCK only).
2. **The workflow is inactive.** A workflow-pack sync from the repo-owned JSON
   (which stores `active: false`) can deactivate `PrjOpsMckSync001`. Confirm
   it is active in the n8n UI before waiting for 09:00/17:00.
3. **n8n cannot reach MCK.** Look at n8n execution history for
   `Call MCK Workspace Sync` errors such as `ECONNREFUSED` on `mck.host`.
   Failed runs never reach `POST /api/n8n/mck-sync-status`, so the MCK
   drawer keeps the last *successful report* (which can be months old) and
   does not show the failures.
4. **Scheduled non-dry-run is still paused.** The schedule may be reporting
   dry-runs only. That is a policy flag, not a crash; do not flip it without
   explicit operator approval.

Do not start, stop, or restart Docker or n8n from this document alone; see
the pull-request "Operator steps after merge" (or the operator) for the
exact local steps.

## Related Surfaces

- Sync history UI: `/n8n-sync-history`
- Status API: `/api/n8n/mck-sync-status`
- n8n alert webhook name (value stays in `.env.local`):
  `MCK_N8N_ALERT_WEBHOOK_URL`, documented in
  [FIRST_RUN_OPERATOR_GUIDE.md](FIRST_RUN_OPERATOR_GUIDE.md)
- Local Control n8n card: `http://127.0.0.1:5678`
