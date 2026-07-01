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
