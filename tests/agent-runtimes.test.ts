import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCallbackUrls,
  buildManualHandoffPrompt,
  buildWebhookDispatchPayload,
  buildWebhookHeaders,
  getWebhookUrl,
  normalizeAgentRuntimeType,
  parseAgentRuntimeConfig,
  resolveAgentRuntime,
  serializeAgentRuntimeConfig,
  shouldAutoDispatchAgent,
} from '../src/lib/agent-runtimes';
import type { Agent, Task } from '../src/lib/types';

const baseAgent: Agent = {
  id: 'agent-1',
  name: 'Hermes Worker',
  role: 'Code Agent',
  avatar_emoji: '🤖',
  status: 'standby',
  is_master: false,
  runtime_type: 'manual',
  runtime_config: {},
  dispatch_enabled: false,
  workspace_id: 'assistants',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

const baseTask: Task = {
  id: 'task-1',
  title: 'Implement runtime adapters',
  description: 'Route dispatch through runtime adapters.',
  status: 'assigned',
  priority: 'high',
  workspace_id: 'assistants',
  business_id: 'default',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  dispatch_metadata: {
    source_issue_url: 'https://github.com/iMelki/mission-control-kanban/issues/32',
    target_repo: 'iMelki/mission-control-kanban',
    project_workstream: 'MCK runtime adapters',
    allowed_file_scope: ['src/lib/**', 'src/app/api/tasks/[id]/dispatch/route.ts'],
    acceptance_criteria: ['Manual dispatch returns a handoff prompt', 'Webhook dispatch uses callbacks'],
    test_requirements: ['npm run test:github-sync'],
    risk_level: 'medium',
    readiness: 'ready_for_agent',
    review_mode: 'human_required',
    impact: 'Dispatch behavior changes',
    rollback_plan: 'Revert adapter commit',
    safety_rules: ['Do not store raw webhook secrets'],
  },
  github_source: {
    repo_owner: 'iMelki',
    repo_name: 'mission-control-kanban',
    issue_number: 32,
    issue_url: 'https://github.com/iMelki/mission-control-kanban/issues/32',
  },
};

test('runtime fallback defaults unknown values to manual handoff', () => {
  assert.equal(normalizeAgentRuntimeType('codex'), 'manual');
  assert.equal(resolveAgentRuntime(null).effective_type, 'manual');
  assert.equal(shouldAutoDispatchAgent({ runtime_type: 'manual', dispatch_enabled: true }), false);
});

test('OpenClaw and webhook only auto-dispatch when dispatch is explicitly enabled', () => {
  assert.equal(shouldAutoDispatchAgent({ runtime_type: 'openclaw', dispatch_enabled: false }), false);
  assert.equal(shouldAutoDispatchAgent({ runtime_type: 'openclaw', dispatch_enabled: true }), true);
  assert.equal(shouldAutoDispatchAgent({ runtime_type: 'webhook', dispatch_enabled: 1 }), true);
  assert.equal(resolveAgentRuntime({ runtime_type: 'webhook', dispatch_enabled: 0 }).effective_type, 'manual');
});

test('runtime config parsing and serialization are safe for raw notes and JSON', () => {
  assert.deepEqual(parseAgentRuntimeConfig('plain instructions'), { notes: 'plain instructions' });
  assert.equal(serializeAgentRuntimeConfig('plain instructions'), '{"notes":"plain instructions"}');
  assert.deepEqual(parseAgentRuntimeConfig('{"webhook_url":"https://example.test/hook"}'), {
    webhook_url: 'https://example.test/hook',
  });
});

test('manual dispatch returns a copyable prompt and callback URLs without external launch semantics', () => {
  const prompt = buildManualHandoffPrompt({
    task: baseTask,
    agent: baseAgent,
    missionControlUrl: 'http://mck.host:3021',
    projectsPath: 'S:/source/CCAI/Assistants/projects',
  });

  assert.match(prompt, /Mission Control handoff/);
  assert.match(prompt, /did not launch your runtime automatically/);
  assert.match(prompt, /POST http:\/\/mck.host:3021\/api\/tasks\/task-1\/activities/);
  assert.match(prompt, /Allowed file scope/);
  assert.deepEqual(buildCallbackUrls('task-1', 'http://mck.host:3021/'), {
    activity: 'http://mck.host:3021/api/tasks/task-1/activities',
    deliverable: 'http://mck.host:3021/api/tasks/task-1/deliverables',
    status: 'http://mck.host:3021/api/tasks/task-1',
    dispatch: 'http://mck.host:3021/api/tasks/task-1/dispatch',
  });
});

test('webhook adapter payload is canonical and headers use env indirection for secrets', () => {
  const agent: Agent = {
    ...baseAgent,
    runtime_type: 'webhook',
    runtime_config: {
      webhook_url: 'https://example.test/mck-dispatch',
      bearer_token_env: 'MCK_TEST_TOKEN',
      headers: {
        'X-MCK-Bridge': 'test',
        Authorization: 'raw-secret-that-must-not-pass-through',
      },
    },
    dispatch_enabled: true,
  };

  const config = parseAgentRuntimeConfig(agent.runtime_config);
  assert.equal(getWebhookUrl(config), 'https://example.test/mck-dispatch');
  assert.deepEqual(buildWebhookHeaders(config, { MCK_TEST_TOKEN: 'secret-token' }), {
    'Content-Type': 'application/json',
    'X-MCK-Bridge': 'test',
    Authorization: 'Bearer secret-token',
  });

  const payload = buildWebhookDispatchPayload(
    baseTask,
    agent,
    'http://mck.host:3021',
    '2026-07-01T00:00:00.000Z',
    'S:/source/CCAI/Assistants/projects',
  );

  assert.equal(payload.event, 'mck.task.dispatch');
  assert.equal(payload.version, 1);
  assert.equal(payload.agent.runtime_type, 'webhook');
  assert.equal(payload.task.id, baseTask.id);
  assert.equal(payload.callbacks.status, 'http://mck.host:3021/api/tasks/task-1');
  assert.match(payload.prompt_markdown, /Mission Control is launching this task through the configured runtime adapter/);
});
