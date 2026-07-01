# Multi-Agent Runtime Dispatch

Last updated: 2026-07-01

Mission Control Kanban (MCK) can represent many kinds of agents on the board. Runtime-aware dispatch now separates **ownership tracking** from **runtime launch** so operators can safely use OpenClaw, webhook bridges, and manual/native surfaces such as Hermes, Codex, Copilot, or Claude Code.

## Current Rule

> Do not rely on the `ASSIGNED` auto-dispatch path unless the assigned agent has a runtime adapter and `dispatch_enabled` is on.

In plain English: putting a task in `ASSIGNED` means the board knows who owns the work. MCK only launches work automatically for agents whose runtime supports auto-dispatch and whose agent record explicitly enables it. Manual agents remain tracker/handoff agents.

## Runtime Fields

Agents now carry three runtime fields:

| Field | Meaning |
| --- | --- |
| `runtime_type` | Which dispatch path to use: `manual`, `openclaw`, or `webhook`. Unknown values fall back to `manual`. |
| `runtime_config` | JSON configuration for that runtime, such as a webhook URL or OpenClaw session hint. Do not store raw secrets here. |
| `dispatch_enabled` | Explicit safety toggle. If false, even `openclaw` and `webhook` agents fall back to manual handoff. |

### SQLite migration for runtime fields

Migration `013_add_agent_runtime_fields` adds those columns and indexes to existing SQLite databases. Fresh databases get the same fields from `src/lib/db/schema.ts`.

Why this exists: old MCK agent rows did not know whether they were OpenClaw, manual, or webhook-backed. The migration gives existing and future rows a stable schema so dispatch code can make a safe runtime decision instead of guessing.

## Runtime Adapter Registry

Dispatch now routes through an adapter layer instead of calling OpenClaw directly from `/api/tasks/:id/dispatch`.

Adapters implemented:

- `manual` — generates a copyable handoff prompt and callback URLs. It does **not** move the task to `in_progress` automatically.
- `openclaw` — preserves the existing OpenClaw gateway/session behavior through an adapter.
- `webhook` — POSTs a canonical dispatch payload to the configured endpoint. It only moves the task forward after a successful 2xx response.

Deferred:

- `local_command` — intentionally not implemented. It would require explicit environment enablement, a command allowlist, and a dry-run preview because it can run local processes.

## `/api/tasks/:id/dispatch` Behavior

The dispatch route now:

1. Loads the task and assigned agent.
2. Resolves the effective runtime:
   - no agent, unknown runtime, manual runtime, or disabled dispatch → `manual`
   - enabled OpenClaw → `openclaw`
   - enabled webhook → `webhook`
3. Calls the matching adapter.
4. Returns adapter-specific evidence.

This means OpenClaw is no longer the implicit default. It is one adapter behind the same contract as the other runtimes.

## Manual Handoff Prompt

Manual dispatch returns:

- task ID, title, description, priority, due date
- GitHub source issue when available
- target repo / workstream
- allowed file scope
- acceptance criteria
- test requirements
- impact and rollback/fallback notes
- safety rules
- output directory expectation
- callback URLs for activity, deliverables, and status updates

The Task modal also exposes a compact **Copy handoff** action so an operator can paste the prompt into Hermes, Codex, Copilot, Claude Code, or another native agent surface.

## Webhook Payload and Secret Handling

Webhook agents use `runtime_config.webhook_url` or `runtime_config.url`.

The payload includes:

- `event: "mck.task.dispatch"`
- `version: 1`
- task summary and dispatch metadata
- assigned agent summary
- callback URLs
- output directory
- prompt markdown
- issued timestamp

Webhook auth uses environment indirection:

```json
{
  "webhook_url": "https://example.test/mck-dispatch",
  "bearer_token_env": "MCK_WEBHOOK_TOKEN",
  "headers": {
    "X-MCK-Bridge": "hermes"
  }
}
```

MCK reads the token from the named environment variable at dispatch time. Raw bearer tokens, API keys, and secrets should not be stored in `runtime_config`. Webhook calls are bounded by a default 30 second timeout (`timeout_ms` / `webhook_timeout_ms`, capped at 120 seconds), and API responses redact query strings/fragments from webhook URLs.

If the webhook call fails or returns non-2xx, MCK returns an error and does not move the task to `in_progress`. Direct dispatch calls also validate the dispatch contract before launching OpenClaw/webhook runtimes; manual handoff remains available even when a task still needs grooming.

## OpenClaw Compatibility

OpenClaw dispatch behavior is preserved through the `openclaw` adapter:

1. Connect to the OpenClaw gateway if needed.
2. Reuse or create an active `openclaw_sessions` row.
3. Send the runtime prompt via `chat.send`.
4. Move the task to `in_progress` only after the message is accepted.
5. Mark the agent `working` and write a `task_dispatched` event.

## Operator UI

Agent modal runtime controls now expose:

- runtime type selector
- auto-dispatch enable/disable toggle
- runtime config JSON field with secret-handling guidance

Task cards now show the assigned agent runtime badge so operators can see whether assignment means manual handoff, OpenClaw auto, webhook auto, or dispatch-off behavior.

Task modal now includes a compact manual handoff prompt copy action for assigned tasks.

## `.hermes/plans` Decision

The local `.hermes/plans/2026-06-30_085351-multi-agent-runtimes.md` file is a scratch implementation plan. Its durable lessons have been promoted into this source-controlled doc and the shared workflow `mck-runtime-adapter-implementation`. Keep `.hermes/` local unless a future plan contains unique canonical content not already represented in docs.

## Operator Checklist

Before trusting automatic dispatch, confirm:

1. The assigned agent has runtime type `openclaw` or `webhook`.
2. `dispatch_enabled` is true.
3. The task's dispatch metadata is complete.
4. The runtime target is healthy and configured.
5. The operator actually wants MCK to start that runtime now.

If any answer is no, keep the task tracked in MCK and use the handoff prompt/callback instructions instead.
