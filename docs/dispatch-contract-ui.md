# Dispatch Contract UI

Last updated: 2026-05-12

Mission Control Kanban now stores and surfaces the operator-facing dispatch contract directly on tasks.

## What Changed

- Tasks persist `dispatch_metadata` in SQLite.
- The task modal includes fields for:
  - source issue URL
  - target repo
  - project/workstream
  - readiness
  - review mode
  - risk level
  - impact
  - allowed file scope
  - acceptance criteria
  - test requirements
  - safety rules
  - rollback/fallback plan
- Task cards show readiness, review mode, risk level, and the first live dispatch blocker.
- Auto-dispatch now stops when the contract is incomplete and logs a system event instead of silently guessing.

## Dispatch Readiness Rule

Auto-dispatch only proceeds when:

1. The required dispatch metadata is present.
2. Readiness is `Ready for Agent`.
3. High-risk or critical work does not use `Auto Checks Only` review mode.
4. The assigned agent is backed by a runtime MCK can actually dispatch today.

Today, that automatic runtime path is OpenClaw-specific. For Hermes, Codex,
Copilot, Claude Code, or other non-OpenClaw agents, a complete dispatch contract
means the task is safe for **manual handoff**; it does not mean `ASSIGNED` will
launch that runtime. See [MULTI_AGENT_RUNTIMES.md](MULTI_AGENT_RUNTIMES.md).

## Operator Flow

1. Fill in the dispatch contract in the task modal.
2. Move or assign the task as usual.
3. If blockers remain, the board will show them and auto-dispatch will be held.
4. Once the blockers are cleared, assignment can trigger Mission Control dispatch safely for OpenClaw-backed agents. For non-OpenClaw agents, copy the ready contract into a manual/native-runtime handoff.
