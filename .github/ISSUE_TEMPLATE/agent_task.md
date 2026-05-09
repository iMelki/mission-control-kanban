---
name: Agent Task
about: Create a scoped task for an AI or human agent
title: "[TASK] <brief summary>"
labels: []
assignees: []
---

# Agent Task

## Goal

Describe the intended outcome.

## Context

Explain the repo/project background and link relevant docs, issues, PRs, or plans.

## Scope

Allowed files/directories:

- <path/glob>

Forbidden files/directories:

- <path/glob or none>

## Acceptance Criteria

- [ ] <criterion>
- [ ] <criterion>
- [ ] <criterion>

## Test Requirements

Commands the agent must run:

```
<command>
<expected result or output summary>
```

## Risk Level

Choose one:

- Low
- Medium
- High
- Critical

## Agent Suitability

Choose one:

- Human Only
- Agent Draft Allowed
- Agent Implementation Allowed
- Agent Review Allowed
- Agent Research Only
- Agent Docs Only
- Agent Refactor Only
- Unsafe for Agent

## Safety Rules

- Do not push to protected branches.
- Do not modify secrets, credentials, billing, production config, or destructive automation unless explicitly approved.
- Stay within the allowed file scope.
- Open a pull request for reviewable work.
- Explain every risky change in the PR.

## Definition of Done

- <done condition>
