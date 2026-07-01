# Multi-Agent Runtime Dispatch

Last updated: 2026-07-01

Mission Control Kanban (MCK) can represent many kinds of agents on the board,
but the current automatic dispatch implementation is **OpenClaw-specific**.

## Current Rule

> Do not rely on the `ASSIGNED` auto-dispatch path unless the assigned agent is
> actually OpenClaw-backed.

In plain English: putting a task in `ASSIGNED` means the board knows who owns the
work. It does **not** mean MCK can launch Hermes, Codex, Copilot, Claude Code, or
another runtime by itself today.

The current `POST /api/tasks/:id/dispatch` route sends work through the OpenClaw
gateway. The dispatch-contract fields still matter for every task, but a complete
contract only proves that a task is safe to hand off; it does not prove that the
assigned runtime can be started automatically.

## What Works Today

### OpenClaw agents

OpenClaw-backed agents can use the existing MCK dispatch path:

1. The task has an assigned OpenClaw agent.
2. Required dispatch metadata is complete.
3. The OpenClaw gateway/session link is available.
4. MCK dispatches the task to OpenClaw and can move the task into active work.

### Non-OpenClaw agents

For Hermes, Codex, Copilot, Claude Code, or other external agents, use MCK as
the board of record and launch the worker in its native surface.

Recommended handoff prompt contents:

- MCK task ID and title
- task description and priority
- target repo / allowed file scope
- acceptance criteria
- required tests or verification commands
- safety rules and rollback/fallback notes
- output directory or deliverable expectations
- MCK callback URLs

Callback pattern for a local MCK task:

```text
When you start, POST:
http://127.0.0.1:3021/api/tasks/<TASK_ID>/activities
Body: {"activity_type":"started","message":"Started work in <agent/runtime>"}

When you create an artifact, POST:
http://127.0.0.1:3021/api/tasks/<TASK_ID>/deliverables
Body: {"deliverable_type":"file","title":"summary.md","path":"S:/source/..."}

When done, PATCH:
http://127.0.0.1:3021/api/tasks/<TASK_ID>
Body: {"status":"review"}
```

## Planned Runtime Model

The intended first-class model is a runtime/provider layer instead of another
hardcoded dispatch path.

Suggested runtime types:

- `manual` — MCK generates/carries a copyable handoff prompt and callback URLs;
  the operator launches the worker manually.
- `openclaw` — existing gateway behavior, routed through an OpenClaw adapter.
- `webhook` — MCK posts a canonical dispatch payload to an approved endpoint.
- `local_command` — deferred; must require explicit enablement, a command
  allowlist, and a dry-run preview before any local shell execution.

Until that adapter layer exists, non-OpenClaw agents should default to manual
handoff/tracker behavior.

## Operator Checklist

Before trusting automatic dispatch, confirm:

1. The assigned agent is OpenClaw-backed.
2. The task's dispatch metadata is complete.
3. The OpenClaw session/gateway is healthy.
4. The operator actually wants MCK to start that runtime now.

If any answer is no, keep the task tracked in MCK and launch the worker manually
with the callback instructions above.
