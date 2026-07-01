import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

process.env.MISSION_CONTROL_URL = 'http://127.0.0.1:3021';
process.env.PROJECTS_PATH = 'S:/source/CCAI/Assistants/projects';
process.env.MCK_TEST_WEBHOOK_TOKEN = 'test-token';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-dispatch-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'mission-control-test.db');

let closeDb: typeof import('../src/lib/db').closeDb;
let queryAll: typeof import('../src/lib/db').queryAll;
let queryOne: typeof import('../src/lib/db').queryOne;
let run: typeof import('../src/lib/db').run;
let dispatchTaskToAssignedAgent: typeof import('../src/lib/dispatch-adapters').dispatchTaskToAssignedAgent;
let getDispatchAttempts: typeof import('../src/lib/dispatch-adapters').getDispatchAttempts;
let OpenClawClient: typeof import('../src/lib/openclaw/client').OpenClawClient;
let routeModule: typeof import('../src/app/api/tasks/[id]/dispatch/route');

test.before(async () => {
  const dbModule = await import('../src/lib/db');
  const dispatchModule = await import('../src/lib/dispatch-adapters');
  const openclawModule = await import('../src/lib/openclaw/client');
  routeModule = await import('../src/app/api/tasks/[id]/dispatch/route');
  closeDb = dbModule.closeDb;
  queryAll = dbModule.queryAll;
  queryOne = dbModule.queryOne;
  run = dbModule.run;
  dispatchTaskToAssignedAgent = dispatchModule.dispatchTaskToAssignedAgent;
  getDispatchAttempts = dispatchModule.getDispatchAttempts;
  OpenClawClient = openclawModule.OpenClawClient;
});

const requiredMetadata = {
  target_repo: 'iMelki/mission-control-kanban',
  project_workstream: 'runtime dispatch tests',
  allowed_file_scope: ['src/lib/**'],
  acceptance_criteria: ['dispatch side effects are recorded'],
  test_requirements: ['node --import tsx --test tests/dispatch-adapters.test.ts'],
  risk_level: 'low',
  readiness: 'ready_for_agent',
  review_mode: 'human_required',
  impact: 'test only',
  rollback_plan: 'delete temp db',
  safety_rules: ['do not call real external runtimes'],
};

function resetDb() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${process.env.DATABASE_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function seedAgent(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const agent = {
    id: String(overrides.id || 'agent-1'),
    name: String(overrides.name || 'Adapter Agent'),
    role: String(overrides.role || 'Runtime Test Agent'),
    description: 'dispatch adapter test agent',
    avatar_emoji: '🧪',
    status: 'standby',
    is_master: 0,
    runtime_type: String(overrides.runtime_type || 'manual'),
    runtime_config: overrides.runtime_config === undefined ? null : JSON.stringify(overrides.runtime_config),
    dispatch_enabled: overrides.dispatch_enabled ? 1 : 0,
    workspace_id: 'default',
    created_at: now,
    updated_at: now,
  };

  run(
    `INSERT INTO agents (id, name, role, description, avatar_emoji, status, is_master, runtime_type, runtime_config, dispatch_enabled, workspace_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agent.id,
      agent.name,
      agent.role,
      agent.description,
      agent.avatar_emoji,
      agent.status,
      agent.is_master,
      agent.runtime_type,
      agent.runtime_config,
      agent.dispatch_enabled,
      agent.workspace_id,
      agent.created_at,
      agent.updated_at,
    ]
  );
  return agent;
}

function seedTask(agentId = 'agent-1', overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const task = {
    id: String(overrides.id || 'task-1'),
    title: String(overrides.title || 'Dispatch integration task'),
    description: 'dispatch adapter integration test task',
    status: String(overrides.status || 'assigned'),
    priority: 'high',
    assigned_agent_id: agentId,
    workspace_id: 'default',
    business_id: 'default',
    dispatch_metadata: JSON.stringify(overrides.dispatch_metadata || requiredMetadata),
    created_at: now,
    updated_at: now,
  };

  run(
    `INSERT INTO tasks (id, title, description, status, priority, assigned_agent_id, workspace_id, business_id, dispatch_metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assigned_agent_id,
      task.workspace_id,
      task.business_id,
      task.dispatch_metadata,
      task.created_at,
      task.updated_at,
    ]
  );
  return task;
}

async function withMockWebhook(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  if (!address || typeof address !== 'object') throw new Error('mock webhook did not bind to a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}/dispatch?secret=redacted`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test.after(() => {
  resetDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('manual dispatch records a timeline attempt and does not move the task forward', async () => {
  resetDb();
  seedAgent({ runtime_type: 'manual', dispatch_enabled: false });
  seedTask();

  const result = await dispatchTaskToAssignedAgent('task-1');
  assert.equal(result.runtime_type, 'manual');
  assert.equal(result.dispatched, false);
  assert.match(result.handoff_prompt || '', /Mission Control handoff/);

  const task = queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['task-1']);
  assert.equal(task?.status, 'assigned');
  const attempts = getDispatchAttempts('task-1');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'manual');
});

test('webhook dry-run returns canonical preview without recording attempts or sending requests', async () => {
  resetDb();
  let calls = 0;
  const webhook = await withMockWebhook((_request, response) => {
    calls += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });

  try {
    seedAgent({ runtime_type: 'webhook', dispatch_enabled: true, runtime_config: { webhook_url: webhook.url, timeout_ms: 500 } });
    seedTask();

    const result = await dispatchTaskToAssignedAgent('task-1', { dryRun: true });
    assert.equal(result.dry_run, true);
    assert.equal(result.would_dispatch, true);
    assert.equal(result.dispatched, false);
    assert.equal(calls, 0);
    assert.equal(getDispatchAttempts('task-1').length, 0);
    assert.equal((result.request_payload as { event?: string }).event, 'mck.task.dispatch');
  } finally {
    await webhook.close();
  }
});

test('webhook dispatch posts canonical payload, records success, redacts URL, and moves task active', async () => {
  resetDb();
  let received: Record<string, unknown> | undefined;
  const webhook = await withMockWebhook((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += String(chunk); });
    request.on('end', () => {
      assert.equal(request.headers.authorization, 'Bearer test-token');
      received = JSON.parse(body);
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
  });

  try {
    seedAgent({
      runtime_type: 'webhook',
      dispatch_enabled: true,
      runtime_config: {
        webhook_url: webhook.url,
        bearer_token_env: 'MCK_TEST_WEBHOOK_TOKEN',
        timeout_ms: 500,
      },
    });
    seedTask();

    const result = await dispatchTaskToAssignedAgent('task-1');
    assert.equal(result.dispatched, true);
    assert.equal(result.webhook_status, 202);
    assert.equal(result.webhook_url, webhook.url.replace('?secret=redacted', ''));
    assert.equal(received?.event, 'mck.task.dispatch');
    assert.equal((received?.task as { id: string }).id, 'task-1');

    const task = queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['task-1']);
    assert.equal(task?.status, 'in_progress');
    const attempt = getDispatchAttempts('task-1')[0];
    assert.equal(attempt.status, 'success');
    assert.equal(attempt.http_status, 202);
    assert.equal(attempt.webhook_url, webhook.url.replace('?secret=redacted', ''));
  } finally {
    await webhook.close();
  }
});

test('webhook failure and retry record separate attempts without advancing until success', async () => {
  resetDb();
  let calls = 0;
  const webhook = await withMockWebhook((_request, response) => {
    calls += 1;
    if (calls === 1) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('not ready');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });

  try {
    seedAgent({ runtime_type: 'webhook', dispatch_enabled: true, runtime_config: { webhook_url: webhook.url, timeout_ms: 500 } });
    seedTask();

    await assert.rejects(() => dispatchTaskToAssignedAgent('task-1'), /Webhook dispatch returned HTTP 500/);
    assert.equal(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['task-1'])?.status, 'assigned');
    assert.equal(getDispatchAttempts('task-1')[0].status, 'failed');

    const retry = await dispatchTaskToAssignedAgent('task-1', { retry: true });
    assert.equal(retry.dispatched, true);
    const attempts = getDispatchAttempts('task-1');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].status, 'success');
    assert.equal(attempts[1].status, 'failed');
  } finally {
    await webhook.close();
  }
});

test('webhook timeout records timeout attempt', async () => {
  resetDb();
  const webhook = await withMockWebhook((_request, response) => {
    setTimeout(() => {
      response.writeHead(200);
      response.end('late');
    }, 350);
  });

  try {
    seedAgent({ runtime_type: 'webhook', dispatch_enabled: true, runtime_config: { webhook_url: webhook.url, timeout_ms: 100 } });
    seedTask();

    await assert.rejects(() => dispatchTaskToAssignedAgent('task-1'), /timed out/);
    assert.equal(getDispatchAttempts('task-1')[0].status, 'timeout');
  } finally {
    await webhook.close();
  }
});

test('OpenClaw adapter reuses existing session and records gateway failure', async () => {
  resetDb();
  seedAgent({ runtime_type: 'openclaw', dispatch_enabled: true, runtime_config: { session_id: 'existing-session' } });
  seedTask();
  const now = new Date().toISOString();
  run(
    `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['session-row-1', 'agent-1', 'existing-session', 'mission-control', 'active', now, now]
  );

  const originalIsConnected = OpenClawClient.prototype.isConnected;
  const originalCall = OpenClawClient.prototype.call;
  const originalConnect = OpenClawClient.prototype.connect;
  OpenClawClient.prototype.isConnected = function isConnected() { return true; };
  OpenClawClient.prototype.connect = async function connect() {};
  OpenClawClient.prototype.call = async function call(method: string, params?: Record<string, unknown>) {
    assert.equal(method, 'chat.send');
    assert.equal(params?.sessionKey, 'agent:main:existing-session');
    throw new Error('gateway refused dispatch');
  };

  try {
    await assert.rejects(() => dispatchTaskToAssignedAgent('task-1'), /gateway refused dispatch/);
    const sessionRows = queryAll<{ id: string }>('SELECT id FROM openclaw_sessions WHERE agent_id = ?', ['agent-1']);
    assert.equal(sessionRows.length, 1);
    assert.equal(getDispatchAttempts('task-1')[0].status, 'failed');
  } finally {
    OpenClawClient.prototype.isConnected = originalIsConnected;
    OpenClawClient.prototype.call = originalCall;
    OpenClawClient.prototype.connect = originalConnect;
  }
});

test('dispatch route exposes side effects and retry guard', async () => {
  resetDb();
  seedAgent({ runtime_type: 'manual', dispatch_enabled: false });
  seedTask();

  const postResponse = await routeModule.POST(new Request('http://mck.test/api/tasks/task-1/dispatch', { method: 'POST' }), {
    params: Promise.resolve({ id: 'task-1' }),
  });
  assert.equal(postResponse.status, 200);
  const body = await postResponse.json();
  assert.equal(body.runtime_type, 'manual');

  const getResponse = await routeModule.GET(new Request('http://mck.test/api/tasks/task-1/dispatch'), {
    params: Promise.resolve({ id: 'task-1' }),
  });
  const history = await getResponse.json();
  assert.equal(history.attempts.length, 1);

  const retryResponse = await routeModule.POST(new Request('http://mck.test/api/tasks/task-1/dispatch', {
    method: 'POST',
    body: JSON.stringify({ retry: true }),
  }), {
    params: Promise.resolve({ id: 'task-1' }),
  });
  assert.equal(retryResponse.status, 400);
});
