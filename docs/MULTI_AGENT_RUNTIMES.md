# Multi-Agent Runtime Dispatch

Last updated: 2026-07-29

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


## Workspace Default Runtime Policy

Migration `015_add_workspace_runtime_policy` adds workspace defaults for new agents:

| Field | Meaning |
| --- | --- |
| `default_runtime_type` | The runtime type new agents inherit when their create request does not specify one. |
| `default_runtime_config` | Optional JSON config template. Store env-var names only, not raw secrets. |
| `default_dispatch_enabled` | Whether new OpenClaw/webhook agents inherit auto-dispatch enabled. Manual defaults always remain handoff-only. |

The workspace page exposes these controls in **Workspace runtime defaults**. Existing agents keep their explicit runtime fields; the workspace policy is an inheritance default for future agents and a visible operator reference point.

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
- `version: 1` by default, or opt-in factory `version: 2`
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
  "dispatch_version": 2,
  "bearer_token_env": "MCK_WEBHOOK_TOKEN",
  "headers": {
    "X-MCK-Bridge": "hermes"
  }
}
```

Use `dispatch_version: 2` for the Paperclip bridge only after its signed health
ping is verified. V2 creates a pending attempt before network I/O and carries
stable attempt, delivery, correlation, task-revision, factory-contract, and
lifecycle-callback fields. Existing webhook agents remain on v1 unless
explicitly opted in.

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

The Agents panel now includes a compact post-migration runtime audit summary and per-agent runtime health labels:

- manual/off agents are clearly handoff-only;
- OpenClaw agents show whether a local OpenClaw session is currently linked;
- webhook agents show that their runtime is dispatch-capable when enabled.

Mission Queue includes runtime filter chips for `manual`, `OpenClaw`, `webhook`, and `dispatch off`, following shadcn/ReUI-style visible-filter patterns rather than hiding filter state inside a menu.

Task modal now includes a compact manual handoff prompt copy action for assigned tasks plus a Dispatch timeline panel that lists adapter outcome history and exposes safe webhook retry for failed/timeout webhook attempts only.

## Dispatch Attempt Timeline

Migration `014_add_task_dispatch_attempts` creates `task_dispatch_attempts` for runtime audit history. Every manual, OpenClaw, and webhook dispatch attempt records:

- adapter/runtime type;
- outcome status (`manual`, `success`, `failed`, `timeout`, `skipped`, `retrying`);
- attempt number;
- HTTP status and redacted webhook URL when available;
- bounded error/response text;
- request payload JSON for webhook audit context.

`GET /api/tasks/:id/dispatch` returns this timeline. `POST /api/tasks/:id/dispatch` accepts `{ "retry": true }` only when the effective runtime is webhook and the latest attempt failed or timed out. Repeated webhook retries require `{ "confirm": true }` and are rate-limited per task/runtime so operators get an explicit duplicate-work warning instead of accidental replay loops.


## Replay-Safe Callback Completion

Migration `016_add_webhook_callback_delivery_and_runtime_maintenance` adds callback delivery replay tracking and retention-audit rows:

- `webhook_callback_deliveries` stores signed callback `X-MCK-Delivery-ID` values with short retention so bridge redeliveries are idempotent and replay substitution is blocked.
- `runtime_maintenance_runs` records retention cleanup dry-runs/applies for metrics and operator audit.

Signed callbacks use `X-MCK-Delivery-ID`, `X-MCK-Timestamp`, and `X-MCK-Signature`. The HMAC base string is `<delivery-id>.<timestamp>.<raw-json-body>`. See [WEBHOOK_BRIDGE_CALLBACK_EXAMPLES.md](WEBHOOK_BRIDGE_CALLBACK_EXAMPLES.md) and `/api/schemas/webhook-callback-completion` for bridge-author examples.

Migration `018_add_factory_dispatch_lifecycle` extends this ledger and the
dispatch-attempt table with payload hashes, stable factory identity, lifecycle
stage, and receipt evidence. V2 callback replay uses delivery ID plus payload
hash: identical redeliveries are idempotent; changed bytes under the same ID
are rejected.

## Paperclip software-factory bridge

The installable plugin lives at
`integrations/paperclip-bridge`. It accepts signed health and v1/v2 dispatch
webhooks at:

```text
/api/plugins/imelki.mck-paperclip-bridge/webhooks/mck-dispatch
```

For v2 it creates one parent issue and a sequential
plan → build → deterministic validation → independent review → release graph.
Only the Builder is the mutating source stage. The plugin persists delivery
and cross-system mappings, wakes the plan stage, publishes signed lifecycle
callbacks, forwards normalized outcomes to Mission Control, and exposes
redacted dashboard/linkage/diagnostic UI surfaces.

Completion remains fail closed: MCK only advances to `done` after
`factory-run-receipt.v1` proves passed validation, an independent accepted
review, and a pushed `dev` commit. See
[PAPERCLIP_FACTORY_BRIDGE.md](PAPERCLIP_FACTORY_BRIDGE.md) for installation,
configuration, and recovery.

## Runtime Ops Admin Surfaces

The workspace UI now has route-level section tabs for Board, Agents, Dispatch, Settings, and Activity. This follows the community pattern from shadcn/ReUI-style dashboard shells: keep generic tabs/tables/panels conventional, and reserve MCK-specific logic for runtime semantics.

- Dispatch shows a global failure queue backed by `GET /api/dispatch-attempts`.
- Agents/Settings expose runtime audit and safe normalization preview/apply via `/api/agents/runtime-audit`.
- Settings exposes dispatch retention cleanup dry-run/apply controls, callback replay ledger rows, callback-delivery pruning, webhook runtime_config template copy, and dispatch/callback schema downloads.
- Header runtime health badges call `/api/runtime/health` and show readiness without exposing raw endpoint values.
- `/api/runtime/webhook-health-test` sends a non-task ping and reports
  `reachable` separately from `verified`. Only a signed 2xx result is verified
  and can enable webhook auto-dispatch; unsigned responses are reachability
  evidence only.

## Runtime Health, Metrics, and Retention

- `/metrics` and `/api/metrics` expose low-cardinality Prometheus text metrics for task counts, agent runtime counts, dispatch attempts, retry-budget buckets, callback delivery outcomes, retention cleanup runs/deleted rows, and secret-presence booleans without leaking values.
- `/api/runtime/health` exposes richer operator health counts and reason codes without tokens, raw webhook URLs, or full payload bodies.
- `/api/dispatch-attempts/retention` runs the dispatch-attempt retention policy. Dry-run is the default; configured defaults keep success/manual rows for 30 days and failed/timeout rows for 90 days.
- `/api/webhook-callback-deliveries` lists recent callback delivery IDs for replay audit and prunes expired delivery rows; dry-run is the default for pruning.
- A daily Hermes cron job named **MCK runtime regression check** runs `npm run check:runtime-regressions` and reports results to the origin chat.

## React Doctor Policy

MCK pins a repo-owned `doctor.config.mjs` policy for raw full-project React Doctor scoring. The config documents local-operator dashboard exceptions such as long-lived client effects, intentionally large workflow modals, API schema download anchors, and test/automation exports.

The pre-commit wrapper is intentionally narrower than a branch or full-project scan. Pre-commit passes matching staged frontend paths to `scripts/run-react-doctor.js`, and the wrapper invokes React Doctor with `--scope files --staged --blocking warning --no-score`. This keeps unrelated `dev -> main` diagnostics out of the commit boundary, fails on warnings introduced in the staged frontend set, and avoids score-service availability as a commit dependency. If the staged Git index cannot be read or React Doctor cannot complete, the wrapper fails closed.

Use `npm run doctor:react` to run the same staged gate manually. Use `npx -y react-doctor@latest . --score` only for explicit full-project closeout evidence; it is not the pre-commit decision source.

The research basis, failure model, validation cases, and emergency bypass are recorded in [REACT_DOCTOR_PRECOMMIT_GATE.md](REACT_DOCTOR_PRECOMMIT_GATE.md).

## Webhook JSON Schema

Webhook payload validation is documented in [WEBHOOK_DISPATCH_SCHEMA.md](WEBHOOK_DISPATCH_SCHEMA.md). The implementation keeps a source-controlled JSON Schema shape in `src/lib/webhook-dispatch-schema.ts` and validates the canonical outbound payload before posting.

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
