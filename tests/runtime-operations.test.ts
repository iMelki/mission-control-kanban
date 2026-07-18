import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-runtime-ops-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'mission-control-test.db');
process.env.MISSION_CONTROL_URL = 'http://127.0.0.1:3021';

let closeDb: typeof import('../src/lib/db').closeDb;
let queryOne: typeof import('../src/lib/db').queryOne;
let run: typeof import('../src/lib/db').run;
let validateWebhookCallbackPayload: typeof import('../src/lib/webhook-callback-schema').validateWebhookCallbackPayload;
let signWebhookPayload: typeof import('../src/lib/webhook-signatures').signWebhookPayload;
let verifyWebhookSignature: typeof import('../src/lib/webhook-signatures').verifyWebhookSignature;
let registerWebhookCallbackDelivery: typeof import('../src/lib/webhook-callback-operations').registerWebhookCallbackDelivery;
let getWebhookCallbackDeliveries: typeof import('../src/lib/webhook-callback-operations').getWebhookCallbackDeliveries;
let getRuntimeAudit: typeof import('../src/lib/runtime-operations').getRuntimeAudit;
let getDispatchFailureRateTrends: typeof import('../src/lib/runtime-operations').getDispatchFailureRateTrends;
let getDispatchFailureThresholdAlerts: typeof import('../src/lib/runtime-operations').getDispatchFailureThresholdAlerts;
let applyRuntimeAuditMigration: typeof import('../src/lib/runtime-operations').applyRuntimeAuditMigration;
let getRuntimeMaintenanceRuns: typeof import('../src/lib/runtime-operations').getRuntimeMaintenanceRuns;
let pruneDispatchAttemptsWithAudit: typeof import('../src/lib/runtime-operations').pruneDispatchAttemptsWithAudit;

function resetDb() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${process.env.DATABASE_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

test.before(async () => {
  const dbModule = await import('../src/lib/db');
  const callbackSchema = await import('../src/lib/webhook-callback-schema');
  const signatures = await import('../src/lib/webhook-signatures');
  const callbackOps = await import('../src/lib/webhook-callback-operations');
  const runtimeOps = await import('../src/lib/runtime-operations');
  closeDb = dbModule.closeDb;
  queryOne = dbModule.queryOne;
  run = dbModule.run;
  validateWebhookCallbackPayload = callbackSchema.validateWebhookCallbackPayload;
  signWebhookPayload = signatures.signWebhookPayload;
  verifyWebhookSignature = signatures.verifyWebhookSignature;
  registerWebhookCallbackDelivery = callbackOps.registerWebhookCallbackDelivery;
  getWebhookCallbackDeliveries = callbackOps.getWebhookCallbackDeliveries;
  getRuntimeAudit = runtimeOps.getRuntimeAudit;
  getDispatchFailureRateTrends = runtimeOps.getDispatchFailureRateTrends;
  getDispatchFailureThresholdAlerts = runtimeOps.getDispatchFailureThresholdAlerts;
  applyRuntimeAuditMigration = runtimeOps.applyRuntimeAuditMigration;
  getRuntimeMaintenanceRuns = runtimeOps.getRuntimeMaintenanceRuns;
  pruneDispatchAttemptsWithAudit = runtimeOps.pruneDispatchAttemptsWithAudit;
});

test.after(() => {
  resetDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('canonical callback payload validates and normalizes', () => {
  const result = validateWebhookCallbackPayload({
    schema_version: '1',
    type: 'mck.callback.completed',
    task_id: 'task-1',
    attempt_id: 'attempt-1',
    status: 'completed',
    completed_at: new Date().toISOString(),
    summary: 'Done',
  });
  assert.equal(result.ok, true);
  assert.equal(result.normalized?.mode, 'canonical');
  assert.equal(result.normalized?.status, 'completed');
});

test('signed callback verification includes delivery id to prevent replay substitution', () => {
  const rawBody = JSON.stringify({ hello: 'world' });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhookPayload({ rawBody, secret: 'secret', timestamp, deliveryId: 'delivery-1' });
  assert.equal(verifyWebhookSignature({ rawBody, secret: 'secret', timestamp, signature, deliveryId: 'delivery-1' }).ok, true);
  assert.equal(verifyWebhookSignature({ rawBody, secret: 'secret', timestamp, signature, deliveryId: 'delivery-2' }).ok, false);
});

test('delivery registration rejects duplicate replay IDs', () => {
  resetDb();
  const first = registerWebhookCallbackDelivery({ deliveryId: 'delivery-1', eventType: 'mck.callback.completed', status: 'accepted' });
  const duplicate = registerWebhookCallbackDelivery({ deliveryId: 'delivery-1', eventType: 'mck.callback.completed', status: 'accepted' });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  const deliveries = getWebhookCallbackDeliveries();
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].event_type, 'mck.callback.completed');
});

test('runtime audit flags webhook agents missing dispatch config', () => {
  resetDb();
  const now = new Date().toISOString();
  run(
    `INSERT INTO agents (id, name, role, description, avatar_emoji, status, runtime_type, runtime_config, dispatch_enabled, workspace_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['agent-1', 'Webhook Agent', 'Bridge', '', '🧪', 'standby', 'webhook', null, 1, 'default', now, now]
  );
  const audit = getRuntimeAudit();
  assert.equal(audit.summary.total, 1);
  assert.equal(audit.summary.needs_config, 1);
  assert.equal(audit.agents[0].recommended_action, 'add_webhook_url_env_config');
});

test('runtime audit blocks enabled webhook agents with URL but no signing secret', () => {
  resetDb();
  const previousSecret = process.env.MCK_WEBHOOK_SIGNATURE_SECRET;
  delete process.env.MCK_WEBHOOK_SIGNATURE_SECRET;
  const now = new Date().toISOString();
  run(
    `INSERT INTO agents (id, name, role, description, avatar_emoji, status, runtime_type, runtime_config, dispatch_enabled, workspace_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'agent-signed',
      'Signed Webhook Agent',
      'Bridge',
      '',
      'test',
      'standby',
      'webhook',
      JSON.stringify({ webhook_url: 'http://127.0.0.1:9123/hook' }),
      1,
      'default',
      now,
      now,
    ],
  );

  try {
    const audit = getRuntimeAudit();
    assert.equal(audit.summary.needs_config, 1);
    assert.equal(audit.agents[0].dispatch_blocked, true);
    assert.equal(audit.agents[0].recommended_action, 'add_webhook_signature_secret');
    assert.match(audit.agents[0].reason, /MCK_WEBHOOK_SIGNATURE_SECRET/);
  } finally {
    if (previousSecret === undefined) delete process.env.MCK_WEBHOOK_SIGNATURE_SECRET;
    else process.env.MCK_WEBHOOK_SIGNATURE_SECRET = previousSecret;
  }
});

test('dispatch failure-rate trends group daily runtime failures without hiding manual volume', () => {
  resetDb();
  const now = Date.parse('2026-07-01T12:00:00.000Z');
  const dayOne = '2026-06-30T10:00:00.000Z';
  const dayTwo = '2026-07-01T10:00:00.000Z';
  run(
    `INSERT INTO tasks (id, title, description, status, priority, workspace_id, business_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['task-trend', 'Trend task', '', 'assigned', 'normal', 'default', 'default', dayOne, dayOne]
  );
  const attempts = [
    ['attempt-1', 'webhook', 'success', dayOne],
    ['attempt-2', 'webhook', 'failed', dayOne],
    ['attempt-3', 'webhook', 'timeout', dayOne],
    ['attempt-4', 'manual', 'manual', dayTwo],
    ['attempt-5', 'manual', 'failed', dayTwo],
  ];
  for (const [id, runtimeType, status, createdAt] of attempts) {
    run(
      `INSERT INTO task_dispatch_attempts (id, task_id, runtime_type, status, attempt_number, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, 'task-trend', runtimeType, status, 1, 'trend seed', createdAt]
    );
  }

  const trends = getDispatchFailureRateTrends({ days: 7, now });
  const webhook = trends.find((point) => point.runtime_type === 'webhook');
  const manual = trends.find((point) => point.runtime_type === 'manual');
  assert.equal(webhook?.date, '2026-06-30');
  assert.equal(webhook?.total, 3);
  assert.equal(webhook?.failed, 1);
  assert.equal(webhook?.timeout, 1);
  assert.equal(webhook?.failure_rate, 0.6667);
  assert.equal(manual?.total, 2);
  assert.equal(manual?.failure_rate, 0.5);
});

test('dispatch failure threshold alerts and bulk migration diff expose operator gates', () => {
  resetDb();
  const now = Date.parse('2026-07-01T12:00:00.000Z');
  const createdAt = '2026-07-01T10:00:00.000Z';
  run(
    `INSERT INTO tasks (id, title, description, status, priority, workspace_id, business_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['task-alert', 'Alert task', '', 'assigned', 'normal', 'default', 'default', createdAt, createdAt]
  );
  run(
    `INSERT INTO agents (id, name, role, description, avatar_emoji, status, runtime_type, runtime_config, dispatch_enabled, workspace_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['agent-alert', 'Unsafe manual', 'Worker', '', '🧪', 'standby', 'manual', null, 1, 'default', createdAt, createdAt]
  );
  for (let index = 0; index < 6; index += 1) {
    run(
      `INSERT INTO task_dispatch_attempts (id, task_id, runtime_type, status, attempt_number, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`attempt-alert-${index}`, 'task-alert', 'webhook', index < 4 ? 'failed' : 'success', 1, 'alert seed', createdAt]
    );
  }

  const alerts = getDispatchFailureThresholdAlerts({ now, policy: { warn_rate: 0.25, critical_rate: 0.5, min_attempts: 5, lookback_days: 7 } });
  assert.equal(alerts[0].runtime_type, 'webhook');
  assert.equal(alerts[0].level, 'critical');
  assert.equal(alerts[0].failure_rate, 0.6667);

  const preview = applyRuntimeAuditMigration({ dryRun: true, agentIds: ['agent-alert'] });
  assert.equal(preview.candidates, 1);
  assert.equal(preview.diff[0].before.dispatch_enabled, true);
  assert.equal(preview.diff[0].after.dispatch_enabled, false);
  const history = getRuntimeMaintenanceRuns({ runType: 'runtime_audit_migration' });
  assert.equal(history.length, 1);
  assert.equal(history[0].dry_run, true);
  assert.equal((history[0].summary as { candidates?: number } | null)?.candidates, 1);
});

test('retention cleanup records maintenance audit rows', () => {
  resetDb();
  const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  run(
    `INSERT INTO tasks (id, title, description, status, priority, workspace_id, business_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['task-1', 'Old failure task', '', 'assigned', 'normal', 'default', 'default', oldDate, oldDate]
  );
  run(
    `INSERT INTO task_dispatch_attempts (id, task_id, runtime_type, status, attempt_number, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['attempt-old', 'task-1', 'webhook', 'failed', 1, 'old failure', oldDate]
  );
  const result = pruneDispatchAttemptsWithAudit({ dryRun: false, policy: { succeeded_days: 30, failed_days: 1, manual_days: 30, batch_size: 10 } });
  assert.equal(result.deleted, 1);
  const runRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM runtime_maintenance_runs WHERE run_type = ?', ['dispatch_attempt_retention']);
  assert.equal(runRow?.count, 1);
});
