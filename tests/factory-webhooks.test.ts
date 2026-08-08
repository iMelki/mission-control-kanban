import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';

process.env.MISSION_CONTROL_URL = 'http://127.0.0.1:3021';
process.env.PROJECTS_PATH = 'S:/source/CCAI/Assistants';
process.env.MCK_WEBHOOK_SIGNATURE_SECRET = 'factory-dispatch-secret';
process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET = 'factory-callback-secret';
const FACTORY_BASE_SHA = execFileSync(
  'git',
  ['ls-remote', '--exit-code', 'origin', 'refs/heads/dev'],
  { cwd: process.cwd(), encoding: 'utf8', windowsHide: true }
).trim().split(/\s+/, 1)[0];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-factory-webhooks-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'mission-control-test.db');

let closeDb: typeof import('../src/lib/db').closeDb;
let queryOne: typeof import('../src/lib/db').queryOne;
let run: typeof import('../src/lib/db').run;
let runMigrations: typeof import('../src/lib/db').runMigrations;
let dispatchTaskToAssignedAgent: typeof import('../src/lib/dispatch-adapters').dispatchTaskToAssignedAgent;
let computeTaskRevision: typeof import('../src/lib/dispatch-adapters').computeTaskRevision;
let getDispatchAttempts: typeof import('../src/lib/dispatch-adapters').getDispatchAttempts;
let completionPost: typeof import('../src/app/api/webhooks/agent-completion/route').POST;
let readBoundedCallbackBody: typeof import('../src/lib/webhook-callback-operations').readBoundedCallbackBody;
let CallbackBodyReadError: typeof import('../src/lib/webhook-callback-operations').CallbackBodyReadError;
let signHeaders: typeof import('../src/lib/webhook-signatures').buildSignedWebhookHeaders;
let signPayload: typeof import('../src/lib/webhook-signatures').signWebhookPayload;
let validateDispatchV2: typeof import('../src/lib/webhook-dispatch-schema').validateWebhookDispatchPayloadV2;

test.before(async () => {
  const db = await import('../src/lib/db');
  const dispatch = await import('../src/lib/dispatch-adapters');
  const callback = await import('../src/app/api/webhooks/agent-completion/route');
  const callbackOperations = await import('../src/lib/webhook-callback-operations');
  const signatures = await import('../src/lib/webhook-signatures');
  const schema = await import('../src/lib/webhook-dispatch-schema');
  closeDb = db.closeDb;
  queryOne = db.queryOne;
  run = db.run;
  runMigrations = db.runMigrations;
  dispatchTaskToAssignedAgent = dispatch.dispatchTaskToAssignedAgent;
  computeTaskRevision = dispatch.computeTaskRevision;
  getDispatchAttempts = dispatch.getDispatchAttempts;
  completionPost = callback.POST;
  readBoundedCallbackBody = callbackOperations.readBoundedCallbackBody;
  CallbackBodyReadError = callbackOperations.CallbackBodyReadError;
  signHeaders = signatures.buildSignedWebhookHeaders;
  signPayload = signatures.signWebhookPayload;
  validateDispatchV2 = schema.validateWebhookDispatchPayloadV2;
});

function resetDb() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${process.env.DATABASE_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function seedFactoryTask(webhookUrl?: string) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO agents (
      id, name, role, description, avatar_emoji, status, runtime_type, runtime_config,
      dispatch_enabled, workspace_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'paperclip-agent',
      'Paperclip Factory',
      'Execution control plane',
      '',
      'factory',
      'standby',
      'webhook',
      JSON.stringify({
        webhook_url: webhookUrl ?? 'http://127.0.0.1:1/unused',
        dispatch_version: 2,
        timeout_ms: 1_000,
      }),
      1,
      'default',
      now,
      now,
    ]
  );
  run(
    `INSERT INTO tasks (
      id, title, description, status, priority, assigned_agent_id, workspace_id, business_id,
      dispatch_metadata, source_repo_owner, source_repo_name, source_issue_number,
      source_issue_url, source_project_item_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'task-factory-1',
      'Implement factory bridge',
      'Build and verify the Paperclip bridge.',
      'assigned',
      'high',
      'paperclip-agent',
      'default',
      'default',
      JSON.stringify({
        target_repo: 'iMelki/mission-control-kanban',
        project_workstream: 'Paperclip bridge',
        allowed_file_scope: ['src/**', 'tests/**', 'integrations/paperclip-bridge/**'],
        acceptance_criteria: ['The signed factory path is replay safe'],
        test_requirements: ['npm run test:factory-webhooks'],
        risk_level: 'high',
        readiness: 'ready_for_agent',
        review_mode: 'pair_review',
        impact: 'Enables governed MCK to Paperclip dispatch.',
        rollback_plan: 'Set dispatch_version back to 1.',
        safety_rules: ['Only mutate iMelki repositories.'],
      }),
      'iMelki',
      'mission-control-kanban',
      47,
      'https://github.com/iMelki/mission-control-kanban/issues/47',
      'PVTI_factory',
      now,
      now,
    ]
  );
}

async function withWebhook(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Mock webhook did not bind');
  return {
    url: `http://127.0.0.1:${address.port}/paperclip`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function seedAcceptedAttempt() {
  const task = queryOne<import('../src/lib/types').Task>('SELECT * FROM tasks WHERE id = ?', ['task-factory-1']);
  const agent = queryOne<import('../src/lib/types').Agent>('SELECT * FROM agents WHERE id = ?', ['paperclip-agent']);
  assert.ok(task);
  assert.ok(agent);
  const revision = computeTaskRevision(task, agent, FACTORY_BASE_SHA);
  const now = new Date().toISOString();
  run(
    `INSERT INTO task_dispatch_attempts (
      id, task_id, agent_id, runtime_type, adapter_name, status, attempt_number, message,
      delivery_id, correlation_id, task_revision, payload_hash, request_payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'attempt-factory-1',
      task.id,
      'paperclip-agent',
      'webhook',
      'paperclip-webhook-v2',
      'success',
      1,
      'accepted',
      'dispatch-attempt-factory-1',
      `mck:${task.workspace_id}:${task.id}`,
      revision,
      'b'.repeat(64),
      JSON.stringify({
        version: 2,
        factory_contract: {
          envelope_id: 'factory:attempt-factory-1',
          repository: {
            slug: 'iMelki/mission-control-kanban',
            base_sha: FACTORY_BASE_SHA,
            allowed_file_scope: ['src/**', 'tests/**', 'integrations/paperclip-bridge/**'],
          },
        },
      }),
      now,
      now,
    ]
  );
  return { task, revision };
}

function validFactoryDispatchPayload() {
  return {
    event: 'mck.task.dispatch',
    version: 2,
    dispatch: {
      attempt_id: 'attempt-1',
      delivery_id: 'delivery-1',
      correlation_id: 'mck:default:task-1',
      task_revision: 'a'.repeat(64),
    },
    task: {
      id: 'task-1',
      title: 'Factory task',
      priority: 'high',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'mission-control-kanban',
      },
    },
    agent: {
      id: 'paperclip-agent',
      name: 'Paperclip',
      role: 'Factory',
      runtime_type: 'webhook',
    },
    callbacks: {
      activity: 'http://127.0.0.1:3021/api/activities',
      deliverable: 'http://127.0.0.1:3021/api/deliverables',
      status: 'http://127.0.0.1:3021/api/status',
      dispatch: 'http://127.0.0.1:3021/api/dispatch',
      lifecycle: 'http://127.0.0.1:3021/api/webhooks/agent-completion',
    },
    callback_urls: {
      activity: 'http://127.0.0.1:3021/api/activities',
      deliverable: 'http://127.0.0.1:3021/api/deliverables',
      status: 'http://127.0.0.1:3021/api/status',
      dispatch: 'http://127.0.0.1:3021/api/dispatch',
      lifecycle: 'http://127.0.0.1:3021/api/webhooks/agent-completion',
    },
    mission_control_url: 'http://127.0.0.1:3021',
    output_directory: 'S:/source/CCAI/Assistants/tools/mission-control-kanban',
    prompt_markdown: '# Work',
    issued_at: new Date().toISOString(),
    factory_contract: {
      schema_version: 'factory-task-envelope.v1',
      envelope_id: 'factory:attempt-1',
      repository: {
        slug: 'iMelki/mission-control-kanban',
        owner: 'iMelki',
        name: 'mission-control-kanban',
        active_branch: 'dev',
        base_sha: '9'.repeat(40),
        allowed_file_scope: ['src/**'],
      },
      acceptance_criteria: ['Ship the bridge'],
      test_requirements: ['npm test'],
      risk_level: 'high',
      review_mode: 'pair_review',
      impact: 'Factory delivery',
      rollback_plan: 'Revert the bridge',
      safety_rules: [],
      limits: {
        max_repair_attempts: 2,
        concurrent_mutating_builders: 1,
      },
    },
  };
}

function buildLifecycleBody(
  status: string,
  revision: string,
  overrides: Record<string, unknown> = {}
) {
  return JSON.stringify({
    schema_version: '2',
    type: 'mck.callback.lifecycle',
    task_id: 'task-factory-1',
    attempt_id: 'attempt-factory-1',
    correlation_id: 'mck:default:task-factory-1',
    task_revision: revision,
    status,
    occurred_at: new Date().toISOString(),
    summary: `Factory reported ${status}`,
    ...overrides,
  });
}

function postLifecycleRaw(rawBody: string, deliveryId: string) {
  return completionPost(new NextRequest('http://127.0.0.1:3021/api/webhooks/agent-completion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...signHeaders({
        rawBody,
        secret: process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET || '',
        deliveryId,
      }),
    },
    body: rawBody,
  }));
}

async function sendLifecycle(
  status: string,
  revision: string,
  deliveryId: string,
  overrides: Record<string, unknown> = {}
) {
  return postLifecycleRaw(buildLifecycleBody(status, revision, overrides), deliveryId);
}

test.after(() => {
  resetDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('migration 019 preserves callback deliveries while adding the processing state', () => {
  const migrationPath = path.join(tmpDir, 'migration-019.db');
  const migrationDb = new Database(migrationPath);
  try {
    migrationDb.exec(`
      CREATE TABLE _migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE webhook_callback_deliveries (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL UNIQUE,
        task_id TEXT,
        attempt_id TEXT,
        event_type TEXT NOT NULL DEFAULT 'unknown',
        status TEXT NOT NULL CHECK (
          status IN ('accepted', 'duplicate', 'rejected', 'schema_invalid', 'signature_invalid')
        ),
        payload_hash TEXT,
        reason TEXT,
        expires_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_webhook_callback_deliveries_received
        ON webhook_callback_deliveries(received_at DESC);
      CREATE INDEX idx_webhook_callback_deliveries_expires
        ON webhook_callback_deliveries(expires_at);
      INSERT INTO webhook_callback_deliveries (
        id, delivery_id, task_id, attempt_id, event_type, status,
        payload_hash, reason, expires_at, received_at
      ) VALUES (
        'delivery-row-1', 'delivery-legacy-1', 'task-1', 'attempt-1',
        'mck.callback.lifecycle', 'accepted', '${'a'.repeat(64)}', NULL,
        '2026-07-30T12:00:00.000Z', '2026-07-29T12:00:00.000Z'
      );
    `);
    const markApplied = migrationDb.prepare(
      'INSERT INTO _migrations (id, name) VALUES (?, ?)'
    );
    for (let id = 1; id <= 18; id += 1) {
      const migrationId = String(id).padStart(3, '0');
      markApplied.run(migrationId, `existing-${migrationId}`);
    }

    runMigrations(migrationDb);

    const table = migrationDb.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'webhook_callback_deliveries'"
    ).get() as { sql: string };
    assert.match(table.sql, /'processing'/);
    assert.deepEqual(
      migrationDb.prepare(
        `SELECT delivery_id, status, payload_hash
         FROM webhook_callback_deliveries
         WHERE delivery_id = ?`
      ).get('delivery-legacy-1'),
      {
        delivery_id: 'delivery-legacy-1',
        status: 'accepted',
        payload_hash: 'a'.repeat(64),
      }
    );
    const indexes = migrationDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'webhook_callback_deliveries'"
    ).all() as Array<{ name: string }>;
    assert.ok(indexes.some(({ name }) => name === 'idx_webhook_callback_deliveries_received'));
    assert.ok(indexes.some(({ name }) => name === 'idx_webhook_callback_deliveries_expires'));
  } finally {
    migrationDb.close();
  }
});

test('dispatch v2 persists its stable pending identity before network I/O and updates the same row', async () => {
  resetDb();
  let observedPayload: Record<string, unknown> | undefined;
  const webhook = await withWebhook((request, response) => {
    let rawBody = '';
    request.on('data', (chunk) => { rawBody += String(chunk); });
    request.on('end', () => {
      observedPayload = JSON.parse(rawBody) as Record<string, unknown>;
      const dispatch = observedPayload.dispatch as Record<string, string>;
      const pending = queryOne<{ id: string; status: string; delivery_id: string; payload_hash: string }>(
        'SELECT id, status, delivery_id, payload_hash FROM task_dispatch_attempts WHERE id = ?',
        [dispatch.attempt_id]
      );
      assert.equal(pending?.status, 'retrying');
      assert.equal(pending?.delivery_id, dispatch.delivery_id);
      assert.equal(request.headers['x-mck-delivery-id'], dispatch.delivery_id);
      assert.match(String(request.headers['x-mck-signature']), /^sha256=[a-f0-9]{64}$/);
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ accepted: true }));
    });
  });
  try {
    seedFactoryTask(webhook.url);
    const result = await dispatchTaskToAssignedAgent('task-factory-1');
    assert.equal(result.dispatched, true);
    assert.match(result.attempt_id || '', /^[0-9a-f-]{36}$/);
    assert.equal(result.delivery_id, `dispatch-${result.attempt_id}`);
    assert.equal(result.correlation_id, 'mck:default:task-factory-1');
    assert.match(result.task_revision || '', /^[a-f0-9]{64}$/);
    const task = queryOne<import('../src/lib/types').Task>(
      'SELECT * FROM tasks WHERE id = ?',
      ['task-factory-1']
    );
    const agent = queryOne<import('../src/lib/types').Agent>(
      'SELECT * FROM agents WHERE id = ?',
      ['paperclip-agent']
    );
    assert.ok(task);
    assert.ok(agent);
    assert.equal(
      result.task_revision,
      computeTaskRevision(task, agent, FACTORY_BASE_SHA)
    );
    assert.notEqual(
      result.task_revision,
      computeTaskRevision(task, agent, 'f'.repeat(40))
    );
    assert.equal(
      (observedPayload?.factory_contract as Record<string, unknown>).envelope_id,
      `factory:${result.attempt_id}`
    );
    assert.equal((observedPayload?.callbacks as Record<string, string>).lifecycle, 'http://127.0.0.1:3021/api/webhooks/agent-completion');
    const repository = (observedPayload?.factory_contract as {
      repository: { owner: string; base_sha: string };
    }).repository;
    assert.equal(repository.owner, 'iMelki');
    assert.equal(repository.base_sha, FACTORY_BASE_SHA);
    assert.equal(observedPayload?.output_directory, path.resolve(process.cwd()));
    const attempts = getDispatchAttempts('task-factory-1');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].id, result.attempt_id);
    assert.equal(attempts[0].status, 'success');
    assert.equal(attempts[0].payload_hash, result.payload_hash);
  } finally {
    await webhook.close();
  }
});

test('dispatch v2 rejects a 2xx bridge response with success false', async () => {
  resetDb();
  const webhook = await withWebhook((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: false }));
    });
  });
  try {
    seedFactoryTask(webhook.url);
    await assert.rejects(
      dispatchTaskToAssignedAgent('task-factory-1'),
      /success:false/
    );
    const attempts = getDispatchAttempts('task-factory-1');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, 'failed');
    assert.equal(queryOne<{ status: string }>(
      'SELECT status FROM tasks WHERE id = ?',
      ['task-factory-1']
    )?.status, 'assigned');
  } finally {
    await webhook.close();
  }
});

test('dispatch v2 rejects a 2xx bridge response with accepted false', async () => {
  resetDb();
  const webhook = await withWebhook((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ accepted: false }));
    });
  });
  try {
    seedFactoryTask(webhook.url);
    await assert.rejects(
      dispatchTaskToAssignedAgent('task-factory-1'),
      /accepted:false/
    );
    const attempts = getDispatchAttempts('task-factory-1');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, 'failed');
    assert.equal(queryOne<{ status: string }>(
      'SELECT status FROM tasks WHERE id = ?',
      ['task-factory-1']
    )?.status, 'assigned');
  } finally {
    await webhook.close();
  }
});

test('dispatch v2 validator rejects non-iMelki repository ownership', () => {
  const payload = {
    event: 'mck.task.dispatch',
    version: 2,
    dispatch: {
      attempt_id: 'attempt',
      delivery_id: 'delivery',
      correlation_id: 'correlation',
      task_revision: 'a'.repeat(64),
    },
    task: {
      id: 'task',
      title: 'Task',
      priority: 'high',
      github_source: { repo_owner: 'external', repo_name: 'repo' },
    },
    agent: { id: 'agent', name: 'Agent', role: 'Builder', runtime_type: 'webhook' },
    callbacks: { activity: 'a', deliverable: 'd', status: 's', dispatch: 'x', lifecycle: 'l' },
    callback_urls: { activity: 'a', deliverable: 'd', status: 's', dispatch: 'x', lifecycle: 'l' },
    mission_control_url: 'http://mck',
    output_directory: 'S:/repo',
    prompt_markdown: '# Work',
    issued_at: new Date().toISOString(),
    factory_contract: {
      schema_version: 'factory-task-envelope.v1',
      envelope_id: 'factory:attempt',
      repository: {
        slug: 'external/repo',
        owner: 'external',
        name: 'repo',
        active_branch: 'dev',
        base_sha: 'a'.repeat(40),
        allowed_file_scope: ['src/**'],
      },
      acceptance_criteria: ['done'],
      test_requirements: ['test'],
      risk_level: 'high',
      review_mode: 'pair_review',
      impact: 'test',
      rollback_plan: 'revert',
      safety_rules: [],
      limits: { max_repair_attempts: 2, concurrent_mutating_builders: 1 },
    },
  };
  const validation = validateDispatchV2(payload);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('; '), /iMelki/);
  const owned = structuredClone(payload);
  owned.task.github_source.repo_owner = 'iMelki';
  owned.task.github_source.repo_name = 'repo';
  owned.factory_contract.repository.owner = 'iMelki';
  owned.factory_contract.repository.slug = 'iMelki/repo';
  delete (owned.factory_contract.repository as Partial<typeof owned.factory_contract.repository>).base_sha;
  const missingBase = validateDispatchV2(owned);
  assert.equal(missingBase.valid, false);
  assert.match(missingBase.errors.join('; '), /base_sha/);
});

test('dispatch v2 validator binds both aliases to exact loopback URLs and canonical scopes', () => {
  const valid = validFactoryDispatchPayload();
  assert.deepEqual(validateDispatchV2(valid), { valid: true, errors: [] });

  const aliasDrift = structuredClone(valid);
  aliasDrift.callback_urls.lifecycle = 'http://127.0.0.1:3021/api/webhooks/other';
  assert.match(
    validateDispatchV2(aliasDrift).errors.join('; '),
    /callbacks\.lifecycle and callback_urls\.lifecycle must be identical/
  );

  for (const lifecycle of [
    'http://localhost:3021/api/webhooks/agent-completion',
    'http://user@127.0.0.1:3021/api/webhooks/agent-completion',
    'http://127.0.0.1:3021/api/webhooks/agent-completion?retry=1',
    'http://127.0.0.1:3021/api/webhooks/agent-completion#fragment',
  ]) {
    const candidate = structuredClone(valid);
    candidate.callbacks.lifecycle = lifecycle;
    candidate.callback_urls.lifecycle = lifecycle;
    assert.match(validateDispatchV2(candidate).errors.join('; '), /callbacks\.lifecycle must be/);
  }

  for (const missionControlUrl of [
    'http://localhost:3021',
    'http://user@127.0.0.1:3021',
    'http://127.0.0.1:3021?retry=1',
    'http://127.0.0.1:3021#fragment',
  ]) {
    const candidate = structuredClone(valid);
    candidate.mission_control_url = missionControlUrl;
    assert.match(validateDispatchV2(candidate).errors.join('; '), /mission_control_url must be/);
  }

  for (const invalidScope of [
    '',
    '/src/file.ts',
    'C:/src/file.ts',
    '\\\\server\\share\\file.ts',
    'src\\file.ts',
    'src//file.ts',
    './src/file.ts',
    'src/../file.ts',
    'src/%2f/file.ts',
    'src/%252f/file.ts',
    'src/e\u0301.ts',
  ]) {
    const candidate = structuredClone(valid);
    candidate.factory_contract.repository.allowed_file_scope = [invalidScope];
    assert.equal(validateDispatchV2(candidate).valid, false, invalidScope);
  }
});

test('lifecycle v2 rejects legacy signatures without poisoning the canonical delivery id', async () => {
  resetDb();
  seedFactoryTask();
  const { revision } = seedAcceptedAttempt();
  const deliveryId = 'lifecycle-strict-signature';
  const rawBody = buildLifecycleBody('started', revision, {
    occurred_at: '2026-07-29T12:00:00.000Z',
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const legacySignature = signPayload({
    rawBody,
    secret: process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET || '',
    timestamp,
  });
  const rejected = await completionPost(new NextRequest(
    'http://127.0.0.1:3021/api/webhooks/agent-completion',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCK-Delivery-ID': deliveryId,
        'X-MCK-Timestamp': String(timestamp),
        'X-MCK-Signature': legacySignature,
      },
      body: rawBody,
    }
  ));
  assert.equal(rejected.status, 401);
  assert.equal(queryOne(
    'SELECT delivery_id FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  ), undefined);

  const accepted = await postLifecycleRaw(rawBody, deliveryId);
  assert.equal(accepted.status, 200);
  assert.equal(queryOne<{ status: string }>(
    'SELECT status FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  )?.status, 'accepted');
});

test('lifecycle v2 requires the canonical delivery header name', async () => {
  resetDb();
  seedFactoryTask();
  const { revision } = seedAcceptedAttempt();
  const deliveryId = 'lifecycle-legacy-delivery-header';
  const rawBody = buildLifecycleBody('started', revision, {
    occurred_at: '2026-07-29T12:00:00.000Z',
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await completionPost(new NextRequest(
    'http://127.0.0.1:3021/api/webhooks/agent-completion',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCK-Delivery': deliveryId,
        'X-MCK-Timestamp': String(timestamp),
        'X-MCK-Signature': signPayload({
          rawBody,
          secret: process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET || '',
          timestamp,
          deliveryId,
        }),
      },
      body: rawBody,
    }
  ));
  assert.equal(response.status, 400);
  assert.equal(queryOne(
    'SELECT delivery_id FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  ), undefined);
});

test('callback body reader rejects oversized declared and chunked bodies before authentication', async () => {
  const declared = await completionPost(new NextRequest(
    'http://127.0.0.1:3021/api/webhooks/agent-completion',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(1024 * 1024 + 1),
      },
      body: '{}',
    }
  ));
  assert.equal(declared.status, 413);

  const oversizedChunk = new Uint8Array(1024 * 1024 + 1);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(oversizedChunk);
      controller.close();
    },
  });
  const chunked = await completionPost(new NextRequest(
    'http://127.0.0.1:3021/api/webhooks/agent-completion',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as never
  ));
  assert.equal(chunked.status, 413);
});

test('callback body reader rejects a leading UTF-8 BOM before authentication', async () => {
  const body = new Uint8Array(new ArrayBuffer(5));
  body.set([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
  await assert.rejects(
    readBoundedCallbackBody({
      headers: new Headers({ 'content-length': String(body.byteLength) }),
      body: new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof CallbackBodyReadError);
      assert.equal(error.status, 400);
      assert.match(error.message, /UTF-8 BOM/);
      return true;
    },
  );
});

test('callback body reader rejects non-canonical UTF-8 before authentication', async () => {
  const body = new Uint8Array(new ArrayBuffer(2)); // overlong encoding of '/'
  body.set([0xc0, 0xaf]);
  await assert.rejects(
    readBoundedCallbackBody({
      headers: new Headers({ 'content-length': String(body.byteLength) }),
      body: new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof CallbackBodyReadError);
      assert.equal(error.status, 400);
      assert.match(error.message, /valid UTF-8/);
      return true;
    },
  );
});

test('callback body reader accepts signed chunked lifecycle bytes without changing HMAC input', async () => {
  resetDb();
  seedFactoryTask();
  const { revision } = seedAcceptedAttempt();
  const deliveryId = 'lifecycle-chunked-valid';
  const rawBody = buildLifecycleBody('started', revision, {
    occurred_at: '2026-07-29T12:00:00.000Z',
  });
  const encoded = new TextEncoder().encode(rawBody);
  const splitAt = Math.max(1, Math.floor(encoded.byteLength / 2));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, splitAt));
      controller.enqueue(encoded.slice(splitAt));
      controller.close();
    },
  });
  const response = await completionPost(new NextRequest(
    'http://127.0.0.1:3021/api/webhooks/agent-completion',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signHeaders({
          rawBody,
          secret: process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET || '',
          deliveryId,
        }),
      },
      body: stream,
      duplex: 'half',
    } as never
  ));
  assert.equal(response.status, 200);
  assert.equal(queryOne<{ status: string }>(
    'SELECT status FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  )?.status, 'accepted');
});

test('callback body reader has independent inactivity and total deadlines', async () => {
  const stalled = () => new ReadableStream<Uint8Array<ArrayBuffer>>({ start() {} });
  await assert.rejects(
    readBoundedCallbackBody(
      { headers: new Headers(), body: stalled() },
      { totalTimeoutMs: 100, inactivityTimeoutMs: 10 }
    ),
    (error: unknown) => {
      assert.ok(error instanceof CallbackBodyReadError);
      assert.equal(error.status, 408);
      assert.match(error.message, /inactivity timeout/);
      return true;
    }
  );
  await assert.rejects(
    readBoundedCallbackBody(
      { headers: new Headers(), body: stalled() },
      { totalTimeoutMs: 10, inactivityTimeoutMs: 100 }
    ),
    (error: unknown) => {
      assert.ok(error instanceof CallbackBodyReadError);
      assert.equal(error.status, 408);
      assert.match(error.message, /total read timeout/);
      return true;
    }
  );
});

test('lifecycle delivery claim rolls back when callback state persistence fails', async () => {
  resetDb();
  seedFactoryTask();
  const { revision } = seedAcceptedAttempt();
  const deliveryId = 'lifecycle-transaction-rollback';
  const rawBody = buildLifecycleBody('started', revision, {
    occurred_at: '2026-07-29T12:00:00.000Z',
  });
  run(`
    CREATE TRIGGER fail_factory_lifecycle_activity
    BEFORE INSERT ON task_activities
    WHEN NEW.message LIKE 'Paperclip lifecycle %'
    BEGIN
      SELECT RAISE(ABORT, 'forced lifecycle persistence failure');
    END
  `);
  const failed = await postLifecycleRaw(rawBody, deliveryId);
  assert.equal(failed.status, 500);
  assert.equal(queryOne(
    'SELECT delivery_id FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  ), undefined);
  assert.equal(queryOne<{ lifecycle_status: string | null }>(
    'SELECT lifecycle_status FROM task_dispatch_attempts WHERE id = ?',
    ['attempt-factory-1']
  )?.lifecycle_status, null);
  assert.equal(queryOne<{ status: string }>(
    'SELECT status FROM tasks WHERE id = ?',
    ['task-factory-1']
  )?.status, 'assigned');

  run('DROP TRIGGER fail_factory_lifecycle_activity');
  const retried = await postLifecycleRaw(rawBody, deliveryId);
  assert.equal(retried.status, 200);
  assert.equal(queryOne<{ status: string }>(
    'SELECT status FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  )?.status, 'accepted');
});

test('lifecycle v2 binds callbacks to the dispatched agent and runtime configuration', async () => {
  resetDb();
  seedFactoryTask();
  let accepted = seedAcceptedAttempt();
  const now = new Date().toISOString();
  run(
    `INSERT INTO agents (
      id, name, role, status, runtime_type, runtime_config, dispatch_enabled,
      workspace_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'replacement-agent',
      'Replacement Factory',
      'Execution control plane',
      'standby',
      'webhook',
      JSON.stringify({ webhook_url: 'http://127.0.0.1:1/unused', dispatch_version: 2 }),
      1,
      'default',
      now,
      now,
    ]
  );
  run('UPDATE tasks SET assigned_agent_id = ? WHERE id = ?', ['replacement-agent', 'task-factory-1']);
  const reassigned = await sendLifecycle('started', accepted.revision, 'lifecycle-reassigned');
  assert.equal(reassigned.status, 409);
  assert.equal((await reassigned.json()).reason, 'attempt_agent_mismatch');

  resetDb();
  seedFactoryTask();
  accepted = seedAcceptedAttempt();
  run(
    'UPDATE agents SET runtime_config = ? WHERE id = ?',
    [JSON.stringify({ webhook_url: 'http://127.0.0.1:1/changed', dispatch_version: 2 }), 'paperclip-agent']
  );
  const reconfigured = await sendLifecycle('started', accepted.revision, 'lifecycle-reconfigured');
  assert.equal(reconfigured.status, 409);
  assert.equal((await reconfigured.json()).reason, 'task_revision_stale');
});

test('lifecycle v2 advances started, testing, review, and receipt-proven completion', async () => {
  resetDb();
  seedFactoryTask();
  const { revision } = seedAcceptedAttempt();

  for (const [index, status] of ['started', 'testing', 'review'].entries()) {
    const response = await sendLifecycle(status, revision, `lifecycle-${index}`);
    assert.equal(response.status, 200);
    const expected = status === 'started' ? 'in_progress' : status;
    assert.equal(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['task-factory-1'])?.status, expected);
  }

  const invalid = await sendLifecycle('completed', revision, 'lifecycle-invalid', { receipt: { receiptId: 'missing-proof' } });
  assert.equal(invalid.status, 400);
  assert.equal(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['task-factory-1'])?.status, 'review');

  const receipt = {
    schemaVersion: 'agent-settings.factory-run-receipt.v1',
    receiptId: 'receipt-factory-1',
    envelopeId: 'factory:attempt-factory-1',
    correlationId: 'mck:default:task-factory-1',
    taskRevisionSha256: `sha256:${revision}`,
    status: 'succeeded',
    run: {
      paperclipIssueId: 'paperclip-issue-1',
      paperclipRunId: 'paperclip-run-1',
      workspaceId: 'paperclip-workspace-1',
      roleProfile: 'factory-release-steward',
      profileManifestSha256: `sha256:${'1'.repeat(64)}`,
      effectiveConfigSha256: `sha256:${'2'.repeat(64)}`,
      toolInventorySha256: `sha256:${'3'.repeat(64)}`,
      startedAtUtc: '2026-07-29T12:00:00.000Z',
      finishedAtUtc: '2026-07-29T12:01:00.000Z',
      durationMs: 60_000,
      mutationIntent: 'release',
    },
    repository: {
      slug: 'iMelki/mission-control-kanban',
      branch: 'dev',
      baseSha: FACTORY_BASE_SHA,
      headBeforeReleaseSha: '8'.repeat(40),
      candidateSnapshotSha256: `sha256:${'c'.repeat(64)}`,
      finalSha: 'a'.repeat(40),
      changedPaths: ['src/lib/dispatch-adapters.ts'],
    },
    commands: [
      {
        id: 'command:validation',
        stage: 'validation',
        argv: ['npm', 'test'],
        workingDirectory: '.',
        startedAtUtc: '2026-07-29T12:00:00.000Z',
        finishedAtUtc: '2026-07-29T12:00:30.000Z',
        durationMs: 30_000,
        status: 'passed',
        exitCode: 0,
        stdoutSha256: `sha256:${'4'.repeat(64)}`,
        stderrSha256: `sha256:${'5'.repeat(64)}`,
      },
      {
        id: 'command:release',
        stage: 'release',
        argv: ['pwsh', '-File', 'release.ps1'],
        workingDirectory: '.',
        startedAtUtc: '2026-07-29T12:00:45.000Z',
        finishedAtUtc: '2026-07-29T12:01:00.000Z',
        durationMs: 15_000,
        status: 'passed',
        exitCode: 0,
        stdoutSha256: `sha256:${'7'.repeat(64)}`,
        stderrSha256: `sha256:${'8'.repeat(64)}`,
      },
    ],
    tests: { total: 1, passed: 1, failed: 0, skipped: 0 },
    artifacts: [],
    metrics: {
      inputWorkItems: 1,
      processedItems: 1,
      changedItems: 1,
      retryCount: 0,
      deferralCount: 0,
      errorCount: 0,
      inputTokens: 100,
      outputTokens: 50,
      billedCents: 0,
      hostPressure: 'normal',
      backendLatencyMs: 10,
      freshnessAtUtc: '2026-07-29T12:01:00.000Z',
      caller: 'paperclip',
    },
    review: {
      reviewerId: 'reviewer-agent',
      decision: 'accept',
      freshSession: true,
      builderSessionReused: false,
      reviewedAtUtc: '2026-07-29T12:00:45.000Z',
      evidenceSha256: `sha256:${'6'.repeat(64)}`,
    },
    approvals: [],
    release: {
      attempted: true,
      pushed: true,
      remoteRef: 'refs/heads/dev',
      commitSha: 'a'.repeat(40),
      remoteReadbackSha: 'a'.repeat(40),
      startedAtUtc: '2026-07-29T12:00:45.000Z',
      finishedAtUtc: '2026-07-29T12:01:00.000Z',
    },
    publications: [],
    reconciliation: {
      mck: 'pending',
      paperclip: 'matched',
      missionControl: 'pending',
      githubProject: 'pending',
      git: 'matched',
    },
    privacy: {
      secretsIncluded: false,
      directContactOrPaymentIdentifiersIncluded: false,
      rawPrivateLogsIncluded: false,
      redactionApplied: true,
    },
    errors: [],
  };
  const missingRelease = await sendLifecycle('completed', revision, 'lifecycle-missing-release', {
    receipt: { ...receipt, commands: receipt.commands.filter((command) => command.stage === 'validation') },
  });
  assert.equal(missingRelease.status, 400);
  const wrongBase = await sendLifecycle('completed', revision, 'lifecycle-wrong-base', {
    receipt: {
      ...receipt,
      repository: { ...receipt.repository, baseSha: 'f'.repeat(40) },
    },
  });
  assert.equal(wrongBase.status, 409);
  assert.equal((await wrongBase.json()).reason, 'receipt_repository_mismatch');
  const zeroTests = await sendLifecycle('completed', revision, 'lifecycle-zero-tests', {
    receipt: { ...receipt, tests: { total: 0, passed: 0, failed: 0, skipped: 0 } },
  });
  assert.equal(zeroTests.status, 400);
  const undeclaredReceiptField = await sendLifecycle('completed', revision, 'lifecycle-extra-receipt-field', {
    receipt: { ...receipt, hidden_payload: 'not canonical' },
  });
  assert.equal(undeclaredReceiptField.status, 400);
  const malformedApproval = await sendLifecycle('completed', revision, 'lifecycle-malformed-approval', {
    receipt: {
      ...receipt,
      approvals: [{
        requestId: 'approval-1',
        kind: 'paperclip-approval',
        status: 'approved',
        resolvedAtUtc: '2026-07-29T12:00:45.000Z',
        hidden_payload: 'not canonical',
      }],
    },
  });
  assert.equal(malformedApproval.status, 400);
  const malformedPublication = await sendLifecycle('completed', revision, 'lifecycle-malformed-publication', {
    receipt: {
      ...receipt,
      publications: [{
        target: 'mck',
        deliveryId: 'delivery-1',
        status: 'delivered',
        publishedAtUtc: '2026-07-29T12:01:00.000Z',
        hidden_payload: 'not canonical',
      }],
    },
  });
  assert.equal(malformedPublication.status, 400);
  const outOfScope = await sendLifecycle('completed', revision, 'lifecycle-out-of-scope', {
    receipt: {
      ...receipt,
      repository: { ...receipt.repository, changedPaths: ['docs/private.md'] },
    },
  });
  assert.equal(outOfScope.status, 409);
  assert.equal((await outOfScope.json()).reason, 'receipt_repository_mismatch');
  const encodedSeparator = await sendLifecycle('completed', revision, 'lifecycle-encoded-separator', {
    receipt: {
      ...receipt,
      repository: { ...receipt.repository, changedPaths: ['src/%252f/private.ts'] },
    },
  });
  assert.equal(encodedSeparator.status, 400);

  const completed = await sendLifecycle('completed', revision, 'lifecycle-completed', { receipt });
  assert.equal(completed.status, 200);
  assert.equal(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['task-factory-1'])?.status, 'done');
  const attempt = queryOne<{ lifecycle_status: string; receipt_id: string; receipt_json: string }>(
    'SELECT lifecycle_status, receipt_id, receipt_json FROM task_dispatch_attempts WHERE id = ?',
    ['attempt-factory-1']
  );
  assert.equal(attempt?.lifecycle_status, 'completed');
  assert.equal(attempt?.receipt_id, receipt.receiptId);
  assert.equal(JSON.parse(attempt?.receipt_json || '{}').repository.candidateSnapshotSha256, receipt.repository.candidateSnapshotSha256);

  const regression = await sendLifecycle('blocked', revision, 'lifecycle-after-completed');
  assert.equal(regression.status, 409);
  assert.equal((await regression.json()).reason, 'lifecycle_regression');
  const receiptConflict = await sendLifecycle('completed', revision, 'lifecycle-receipt-conflict', {
    receipt: { ...receipt, receiptId: 'receipt-factory-conflict' },
  });
  assert.equal(receiptConflict.status, 409);
  assert.equal((await receiptConflict.json()).reason, 'receipt_conflict');
  assert.equal(queryOne<{ receipt_id: string }>(
    'SELECT receipt_id FROM task_dispatch_attempts WHERE id = ?',
    ['attempt-factory-1']
  )?.receipt_id, receipt.receiptId);
});

test('lifecycle v2 rejects replay payload conflicts and changed task revisions', async () => {
  resetDb();
  seedFactoryTask();
  const { revision } = seedAcceptedAttempt();
  const first = await sendLifecycle('started', revision, 'lifecycle-replay');
  assert.equal(first.status, 200);
  const conflict = await sendLifecycle('started', revision, 'lifecycle-replay', { summary: 'Changed signed payload' });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).reason, 'payload_conflict');

  run('UPDATE tasks SET title = ? WHERE id = ?', ['Changed after dispatch', 'task-factory-1']);
  const staleOccurredAt = new Date().toISOString();
  const stale = await sendLifecycle('testing', revision, 'lifecycle-stale', { occurred_at: staleOccurredAt });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).reason, 'task_revision_stale');
  const staleReplay = await sendLifecycle('testing', revision, 'lifecycle-stale', { occurred_at: staleOccurredAt });
  assert.equal(staleReplay.status, 409);
  assert.equal((await staleReplay.json()).duplicate, true);
});

test('blocked lifecycle evidence is recorded without false task advancement', async () => {
  resetDb();
  seedFactoryTask();
  const { revision } = seedAcceptedAttempt();
  const response = await sendLifecycle('blocked', revision, 'lifecycle-blocked', {
    error: { code: 'dependency_blocked', message: 'Waiting for reviewed input', retryable: true },
  });
  assert.equal(response.status, 200);
  assert.equal(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['task-factory-1'])?.status, 'assigned');
  assert.equal(queryOne<{ lifecycle_status: string }>('SELECT lifecycle_status FROM task_dispatch_attempts WHERE id = ?', ['attempt-factory-1'])?.lifecycle_status, 'blocked');
});

test('lifecycle callbacks never regress a manually advanced board status', async () => {
  resetDb();
  seedFactoryTask();
  const { revision } = seedAcceptedAttempt();
  run('UPDATE tasks SET status = ? WHERE id = ?', ['done', 'task-factory-1']);
  const response = await sendLifecycle('started', revision, 'lifecycle-late-started');
  assert.equal(response.status, 200);
  assert.equal(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['task-factory-1'])?.status, 'done');
});
