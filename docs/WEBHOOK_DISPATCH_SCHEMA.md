# Webhook Dispatch Payload Schema

Last updated: 2026-07-29

Mission Control Kanban webhook runtimes receive one canonical outbound payload from `/api/tasks/:id/dispatch`.

## Contract

- Event: `mck.task.dispatch`
- Version `1`: backward-compatible default
- Version `2`: opt-in Paperclip software-factory envelope
- Schema source: `src/lib/webhook-dispatch-schema.ts`
- Runtime docs: `docs/MULTI_AGENT_RUNTIMES.md`

The route selects v2 only when the assigned webhook agent has
`"dispatch_version": 2`. It creates the v2 attempt row before network I/O,
signs the exact serialized bytes, and updates that same attempt after the
bridge responds.

## Required payload shape

```json
{
  "event": "mck.task.dispatch",
  "version": 1,
  "task": {
    "id": "task-id",
    "title": "Task title",
    "description": "Optional details",
    "priority": "low | normal | high | urgent",
    "due_date": null,
    "github_source": {},
    "dispatch_metadata": {}
  },
  "agent": {
    "id": "agent-id",
    "name": "Agent name",
    "role": "Agent role",
    "runtime_type": "webhook"
  },
  "callbacks": {
    "activity": "http://mck/api/tasks/task-id/activities",
    "deliverable": "http://mck/api/tasks/task-id/deliverables",
    "status": "http://mck/api/tasks/task-id",
    "dispatch": "http://mck/api/tasks/task-id/dispatch"
  },
  "callback_urls": {
    "activity": "http://mck/api/tasks/task-id/activities",
    "deliverable": "http://mck/api/tasks/task-id/deliverables",
    "status": "http://mck/api/tasks/task-id",
    "dispatch": "http://mck/api/tasks/task-id/dispatch"
  },
  "mission_control_url": "http://127.0.0.1:3021",
  "output_directory": "S:/source/CCAI/Assistants/projects/task-title",
  "prompt_markdown": "# Mission Control handoff\n...",
  "issued_at": "2026-07-01T00:00:00.000Z"
}
```

`callbacks` and `callback_urls` intentionally contain the same object for compatibility with simpler webhook consumers and future schema evolution.

## Opt-in factory dispatch v2

Factory dispatch adds stable delivery identity, a task-revision hash, a
lifecycle callback, and the reviewed task contract. The complete schema is
published by the application; this shortened example highlights the added
fields:

```json
{
  "event": "mck.task.dispatch",
  "version": 2,
  "dispatch": {
    "attempt_id": "596c0f76-3a87-42fc-b5b3-95cd38f540c8",
    "delivery_id": "dispatch-596c0f76-3a87-42fc-b5b3-95cd38f540c8",
    "correlation_id": "mck:assistants:task-id",
    "task_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "task": {
    "id": "task-id",
    "title": "Implement the bridge",
    "priority": "high",
    "github_source": {
      "repo_owner": "iMelki",
      "repo_name": "mission-control-kanban",
      "issue_number": 47,
      "issue_url": "https://github.com/iMelki/mission-control-kanban/issues/47"
    }
  },
  "agent": {
    "id": "paperclip-factory",
    "name": "Paperclip Factory",
    "role": "Execution control plane",
    "runtime_type": "webhook"
  },
  "callbacks": {
    "activity": "http://127.0.0.1:3021/api/tasks/task-id/activities",
    "deliverable": "http://127.0.0.1:3021/api/tasks/task-id/deliverables",
    "status": "http://127.0.0.1:3021/api/tasks/task-id",
    "dispatch": "http://127.0.0.1:3021/api/tasks/task-id/dispatch",
    "lifecycle": "http://127.0.0.1:3021/api/webhooks/agent-completion"
  },
  "callback_urls": {
    "activity": "http://127.0.0.1:3021/api/tasks/task-id/activities",
    "deliverable": "http://127.0.0.1:3021/api/tasks/task-id/deliverables",
    "status": "http://127.0.0.1:3021/api/tasks/task-id",
    "dispatch": "http://127.0.0.1:3021/api/tasks/task-id/dispatch",
    "lifecycle": "http://127.0.0.1:3021/api/webhooks/agent-completion"
  },
  "mission_control_url": "http://127.0.0.1:3021",
  "output_directory": "S:/source/CCAI/Assistants/tools/mission-control-kanban",
  "prompt_markdown": "# Mission Control handoff\n...",
  "issued_at": "2026-07-29T00:00:00.000Z",
  "factory_contract": {
    "schema_version": "factory-task-envelope.v1",
    "envelope_id": "factory:596c0f76-3a87-42fc-b5b3-95cd38f540c8",
    "repository": {
      "slug": "iMelki/mission-control-kanban",
      "owner": "iMelki",
      "name": "mission-control-kanban",
      "active_branch": "dev",
      "base_sha": "5b4d1b2d7eb6fa193cffee9255794c5eea8d3a77",
      "allowed_file_scope": ["src/**", "tests/**", "integrations/paperclip-bridge/**"]
    },
    "acceptance_criteria": ["Signed dispatch is replay safe"],
    "test_requirements": ["npm run test:factory-webhooks"],
    "risk_level": "high",
    "review_mode": "pair_review",
    "impact": "Enables governed Paperclip execution.",
    "rollback_plan": "Set dispatch_version to 1.",
    "safety_rules": ["Only mutate iMelki repositories."],
    "limits": {
      "max_repair_attempts": 2,
      "concurrent_mutating_builders": 1
    }
  }
}
```

The revision is a SHA-256 digest of canonical task intent plus the frozen
lowercase 40-hex `origin/dev` base commit and excludes
operational fields such as current board status and `updated_at`. It changes
when the title, description, source identity, reviewed dispatch contract, or
assigned agent identity/runtime configuration changes. The bound runtime
identity includes the agent ID, name, role, runtime type, normalized runtime
config, and dispatch-enabled state. Bridges must reject a different revision
for an existing correlation instead of silently reusing the old execution
graph.

Factory v2 binds both `callbacks.lifecycle` and
`callback_urls.lifecycle` to the exact value
`http://127.0.0.1:3021/api/webhooks/agent-completion`; the aliases must be
identical. `mission_control_url` is exactly `http://127.0.0.1:3021`.
Alternate hostnames, userinfo, query strings, and fragments are invalid.
`allowed_file_scope` entries must be canonical repository-relative
forward-slash paths or globs: absolute, drive, UNC, empty-segment,
dot/dot-dot, encoded-separator, backslash, and non-NFC values are rejected.

## Secret handling

Webhook agent config should store references, not secrets:

```json
{
  "webhook_url": "https://example.test/mck-dispatch",
  "dispatch_version": 2,
  "bearer_token_env": "MCK_WEBHOOK_TOKEN",
  "signature_secret_env": "MCK_WEBHOOK_SIGNATURE_SECRET",
  "headers": {
    "X-MCK-Bridge": "hermes"
  },
  "timeout_ms": 30000
}
```

Rules:

- Do not use `NEXT_PUBLIC_` env vars for webhook credentials.
- Do not store raw `Authorization`, token, secret, or key headers in `runtime_config`.
- MCK reads `bearer_token_env` server-side at dispatch time.
- Logged/returned webhook URLs redact query strings and fragments.
- Timeout defaults to 30 seconds and caps at 120 seconds.

## Attempt timeline

Every dispatch creates a row in `task_dispatch_attempts` with:

- runtime and adapter name
- status: `manual`, `success`, `failed`, `timeout`, `skipped`, or `retrying`
- attempt number
- HTTP status when available
- redacted webhook URL
- bounded response/error text
- request payload JSON for audit/replay context

Factory v2 additionally records `attempt_id`, `delivery_id`,
`correlation_id`, `task_revision`, payload hash, lifecycle stage, receipt ID,
and an update timestamp. The initial `retrying` row exists before the POST is
made, so a process failure cannot create an untracked downstream execution.

The Task modal renders these rows in the Dispatch timeline and only enables **Retry webhook** when the latest attempt is a failed/timeout webhook dispatch.


## Published schema endpoint

Bridge authors can fetch the exact schema that MCK uses for outbound dispatch validation:

- Inline: `GET /api/schemas/webhook-dispatch-payload`
- Download: `GET /api/schemas/webhook-dispatch-payload?download=1`
- Factory v2 inline: `GET /api/schemas/webhook-dispatch-payload?version=2`
- Factory v2 download:
  `GET /api/schemas/webhook-dispatch-payload?version=2&download=1`

The route returns `application/schema+json` and includes `X-Schema-Id` so bridge code can cache or pin the contract version.

## Required HMAC signatures

Webhook auto-dispatch requires MCK to sign outbound requests without storing raw secrets in `runtime_config`:

```json
{
  "webhook_url": "https://example.test/mck-dispatch",
  "bearer_token_env": "MCK_WEBHOOK_TOKEN",
  "signature_secret_env": "MCK_WEBHOOK_SIGNATURE_SECRET"
}
```

When the referenced env var is configured, MCK adds:

- `X-MCK-Timestamp`
- `X-MCK-Signature`
- `X-MCK-Delivery`
- `X-MCK-Delivery-ID`

For current delivery-ID-aware requests, the signature base string is:

```text
<delivery-id>.<timestamp>.<raw-json-body>
```

The signature value is `sha256=<hex-hmac-sha256>`. Consumers should reject
stale timestamps, verify with a timing-safe comparison, and store delivery IDs
briefly for replay protection. The verifier retains the earlier
`v1.<timestamp>.<raw-json-body>` form only for dispatch/callback v1
compatibility. Lifecycle callback v2 requires the delivery-bound form and the
exact `X-MCK-Delivery-ID` header.

If the signing secret is absent, dry-run reports `would_dispatch=false`, live
dispatch records a failed attempt without making a network request, and the
runtime audit recommends `add_webhook_signature_secret`.

The validation wizard distinguishes endpoint reachability from trust:

- an unsigned HTTP response can set `reachable=true`, but never `verified=true`;
- only a signed 2xx response sets `verified=true` and can enable dispatch;
- config edits invalidate the in-memory validation evidence;
- timeout/request failures set both fields false.

Webhook URLs are operator-controlled server-side request destinations. Keep MCK
on its local/trusted control-plane boundary and configure only known bridge
hosts. If this route is ever exposed to untrusted users, add an explicit host/IP
allowlist and DNS-rebinding controls before accepting arbitrary destinations.
This follows OWASP SSRF guidance:
<https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html>.

Inbound agent-completion callbacks can be verified with `MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET`. When that env var is configured, `/api/webhooks/agent-completion` rejects missing, stale, or invalid `X-MCK-Signature` headers before parsing JSON.

## Retention, retry, and health

- Dispatch attempts are retained by policy via `POST /api/dispatch-attempts/retention`; dry-run is the default.
- Defaults: success/manual 30 days, failed/timeout 90 days, batch size 500.
- Repeated webhook retries require explicit operator confirmation and are rate-limited per task/runtime.
- Runtime health is available at `GET /api/runtime/health` and reports counts/reason codes without exposing tokens, secrets, raw callback URLs, or full payload bodies.
- Low-cardinality Prometheus text metrics are available at `/metrics` and `/api/metrics`.
