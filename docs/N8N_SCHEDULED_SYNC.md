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
`http://mck.host:3021`. When n8n runs on the host, it **must** set
`MCK_N8N_BASE_URL=http://127.0.0.1:3021`. The default still falls back to
`http://mck.host:3021`, which cannot reach a loopback-only MCK.

Manual webhook calls default to dry-run. Scheduled runs are also dry-run
until the projects-ops schedule artifact sets `scheduledNonDryRunApproved`
to `true`. While that flag is false, a healthy schedule still *reports*
(the drawer "Last run" updates) but does not apply local-mirror writes;
**Sync now** remains the applying path.

## Localhost Bind

`npm run dev:n8n` starts MCK on `127.0.0.1:3021` only. It must not pass
`--hostname 0.0.0.0`. `tests/env-example-port.test.mjs` asserts this.

The n8n UI and webhooks belong on `http://127.0.0.1:5678`. Because MCK itself
listens on `127.0.0.1` only, n8n must not rely on `host.docker.internal` or
Docker `host-gateway` to reach it: those paths cannot reach a loopback-only
MCK. A Tailscale or LAN address mapped onto `mck.host` also fails, typically
with `ECONNREFUSED` on the Tailscale IP:3021.

The reliable pairing is: MCK on `127.0.0.1:3021`, and n8n running **on the
host** (not in Docker) with `MCK_N8N_BASE_URL=http://127.0.0.1:3021`.

If Docker stays for anything (n8n or other services), its publishes go only
on `127.0.0.1` for ports `5678` and `5030`, for example `127.0.0.1:5678:5678`
and `127.0.0.1:5030:3000`. Do not set `N8N_LISTEN_ADDRESS=127.0.0.1` *inside*
the container: Docker's port publish forwards to the container's
`0.0.0.0:5678`, and a container-only loopback bind would make the published
host port miss. The host-side bind is what keeps the service off the LAN.

If n8n itself stays in Docker, `Test-MckEndpointAlignment.ps1 -Json` from
the projects-ops checkout is a **hard gate** before enabling the schedule:
require `status=aligned`. Do not enable the schedule until that gate passes.

## Operator Recipe After Merge

CTO decision: run n8n **on the host** with
`MCK_N8N_BASE_URL=http://127.0.0.1:3021`. Do not apply these steps from an
agent unless Ilan (or CTO for operational work) says yes.

1. **Run n8n on the host**, not in Docker. Set
   `MCK_N8N_BASE_URL=http://127.0.0.1:3021` in the host n8n environment.
   Never rely on `host.docker.internal` or `host-gateway`; they cannot
   reach a loopback-only MCK. Leave MCK on `127.0.0.1:3021`.

2. **If Docker stays for anything else**, restrict its host publishes to
   loopback only. At `C:\Dev\n8n\docker-compose.yml` (local overlay, not
   this repo), change `"5678:5678"` to `"127.0.0.1:5678:5678"` and
   `"5030:3000"` to `"127.0.0.1:5030:3000"`. Do **not** set
   `N8N_LISTEN_ADDRESS=127.0.0.1` inside a container. Remove any
   `extra_hosts: mck.host:<Tailscale or LAN IP>` mapping: that is the
   address that failed with `ECONNREFUSED` while MCK listened on
   `127.0.0.1` only.

3. **If n8n stays in Docker** (not the chosen path): the schedule stays
   disabled until the hard gate passes. From the projects-ops checkout,
   run `pwsh -NoProfile -File .\scripts\Test-MckEndpointAlignment.ps1 -Json`
   and require `status=aligned` before enabling the schedule.

4. **Logon autostart and health.** Add a logon scheduled task (or equivalent)
   that starts host n8n on login. MCK's LocalNext watchdog starts MCK only;
   it does not start n8n. Confirm `http://127.0.0.1:5678/healthz` is up and
   that **PrjOpsMckSync001** is Active. The repo-owned workflow JSON stores
   `active: false`, so re-activate the workflow after any workflow-pack
   sync.

5. **Keep `scheduledNonDryRunApproved` false** until one scheduled dry run
   succeeds. The flag lives in
   `n8n-workflows/workflow-pack-1/mck-project-workspace-sync.schedule.json`
   (projects-ops, not this repo). After n8n is up, the drawer "Last run"
   can update again, but scheduled runs stay **dry-run** for every
   workspace (the flag as implemented is not asimtop-only). **Sync now**
   remains the applying path. Do not flip the flag without an explicit
   operator yes.

6. **Confirm a fresh report.** After a successful dry run (the next 09:00
   or 17:00 Asia/Jerusalem, or a visible n8n trigger execution), confirm
   `/api/n8n/mck-sync-status` shows a fresh `received_at`. That, together
   with a successful n8n execution, is what proves the installed scheduler
   fired and reached MCK.

## When The Drawer Says The Schedule Is Dead

Typical causes, in the order to check them (all read-only until an operator
approves a start or config change):

1. **n8n is not running.** Nothing listens on `127.0.0.1:5678`. There may be
   no Task Scheduler entry that starts n8n (MCK's LocalNext watchdog starts
   MCK only).
2. **The workflow is inactive.** A workflow-pack sync from the repo-owned JSON
   (which stores `active: false`) can deactivate `PrjOpsMckSync001`. Confirm
   it is active in the n8n UI before waiting for 09:00/17:00.
3. **n8n cannot reach MCK.** Look at n8n execution history for
   `Call MCK Workspace Sync` errors such as `ECONNREFUSED` on `mck.host`.
   Failed runs never reach `POST /api/n8n/mck-sync-status`, so the MCK
   drawer keeps the last *successful report* (which can be months old) and
   does not show the failures. Host n8n must set
   `MCK_N8N_BASE_URL=http://127.0.0.1:3021`; the default still falls back
   to `http://mck.host:3021`.
4. **Scheduled non-dry-run is still paused.** The schedule may be reporting
   dry-runs only. That is a policy flag, not a crash; do not flip it without
   explicit operator approval. Keep it false until a dry run succeeds.

For the exact local steps, see [Operator Recipe After Merge](#operator-recipe-after-merge)
above. Do not start, stop, or restart n8n or Docker from this document
alone without operator approval.

## Related Surfaces

- Sync history UI: `/n8n-sync-history`
- Status API: `/api/n8n/mck-sync-status`
- n8n alert webhook name (value stays in `.env.local`):
  `MCK_N8N_ALERT_WEBHOOK_URL`, documented in
  [FIRST_RUN_OPERATOR_GUIDE.md](FIRST_RUN_OPERATOR_GUIDE.md)
- Local Control n8n card: `http://127.0.0.1:5678`
