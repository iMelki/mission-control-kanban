# Webhook Dispatch Payload Schema

Last updated: 2026-07-01

Mission Control Kanban webhook runtimes receive one canonical outbound payload from `/api/tasks/:id/dispatch`.

## Contract

- Event: `mck.task.dispatch`
- Version: `1`
- Schema source: `src/lib/webhook-dispatch-schema.ts`
- Runtime docs: `docs/MULTI_AGENT_RUNTIMES.md`

The route builds the payload with `buildWebhookDispatchPayload`, validates it locally before sending, then records the outcome in `task_dispatch_attempts`.

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

## Secret handling

Webhook agent config should store references, not secrets:

```json
{
  "webhook_url": "https://example.test/mck-dispatch",
  "bearer_token_env": "MCK_WEBHOOK_TOKEN",
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

The Task modal renders these rows in the Dispatch timeline and only enables **Retry webhook** when the latest attempt is a failed/timeout webhook dispatch.


## Published schema endpoint

Bridge authors can fetch the exact schema that MCK uses for outbound dispatch validation:

- Inline: `GET /api/schemas/webhook-dispatch-payload`
- Download: `GET /api/schemas/webhook-dispatch-payload?download=1`

The route returns `application/schema+json` and includes `X-Schema-Id` so bridge code can cache or pin the contract version.

## Optional HMAC signatures

Webhook runtimes can ask MCK to sign outbound dispatch requests without storing raw secrets in `runtime_config`:

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

The signature base string is:

```text
v1.<timestamp>.<raw-json-body>
```

The signature value is `v1=<hex-hmac-sha256>`. Consumers should reject stale timestamps, verify with a timing-safe comparison, and store delivery IDs briefly if replay protection is needed.

Inbound agent-completion callbacks can be verified with `MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET`. When that env var is configured, `/api/webhooks/agent-completion` rejects missing, stale, or invalid `X-MCK-Signature` headers before parsing JSON.

## Retention, retry, and health

- Dispatch attempts are retained by policy via `POST /api/dispatch-attempts/retention`; dry-run is the default.
- Defaults: success/manual 30 days, failed/timeout 90 days, batch size 500.
- Repeated webhook retries require explicit operator confirmation and are rate-limited per task/runtime.
- Runtime health is available at `GET /api/runtime/health` and reports counts/reason codes without exposing tokens, secrets, raw callback URLs, or full payload bodies.
- Low-cardinality Prometheus text metrics are available at `/metrics` and `/api/metrics`.
