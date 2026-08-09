import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  RECEIPT_SCHEMA_VERSION,
  verifyRuntimeSmokeCleanup,
  writeRuntimeSmokeCleanupReceipt,
} = require('../scripts/runtime-smoke-cleanup.js');

const entities = [
  { kind: 'task', role: 'primary', id: 'task-1', path: '/api/tasks/task-1' },
  { kind: 'task', role: 'blocker', id: 'task-2', path: '/api/tasks/task-2' },
  { kind: 'task', role: 'checklist', id: 'task-3', path: '/api/tasks/task-3' },
  { kind: 'agent', role: 'runtime', id: 'agent-1', path: '/api/agents/agent-1' },
];

function response(status) {
  return { status, ok: status >= 200 && status < 300 };
}

test('deletes every temporary entity and proves absence with a 404 readback', async () => {
  const calls = [];
  const timestamps = ['2026-08-09T00:00:00.000Z', '2026-08-09T00:00:01.000Z'];
  const receipt = await verifyRuntimeSmokeCleanup({
    baseUrl: 'http://127.0.0.1:3021/',
    entities,
    now: () => timestamps.shift(),
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method });
      return response(init.method === 'DELETE' ? 200 : 404);
    },
  });

  assert.equal(receipt.schema_version, RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.entity_count, 4);
  assert.equal(receipt.started_at, '2026-08-09T00:00:00.000Z');
  assert.equal(receipt.finished_at, '2026-08-09T00:00:01.000Z');
  assert.deepEqual(calls.map(({ method }) => method), [
    'DELETE', 'GET', 'DELETE', 'GET', 'DELETE', 'GET', 'DELETE', 'GET',
  ]);
  assert.ok(calls.every(({ url }) => !url.includes('//api/')));
  assert.ok(receipt.entities.every((entity) => entity.deletion.ok));
  assert.ok(receipt.entities.every((entity) => entity.readback.absent));
});

test('fails closed when an agent remains readable after deletion', async () => {
  const receipt = await verifyRuntimeSmokeCleanup({
    baseUrl: 'http://127.0.0.1:3021',
    entities,
    fetchImpl: async (url, init) => {
      if (init.method === 'GET' && url.endsWith('/api/agents/agent-1')) return response(200);
      return response(init.method === 'DELETE' ? 200 : 404);
    },
  });

  assert.equal(receipt.ok, false);
  assert.equal(receipt.entities.at(-1).kind, 'agent');
  assert.equal(receipt.entities.at(-1).readback.status, 200);
  assert.equal(receipt.entities.at(-1).readback.absent, false);
  assert.equal(receipt.entities.at(-1).ok, false);
});

test('continues cleanup and records transport failures without treating absence as deletion proof', async () => {
  let callCount = 0;
  const receipt = await verifyRuntimeSmokeCleanup({
    baseUrl: 'http://127.0.0.1:3021',
    entities,
    fetchImpl: async (_url, init) => {
      callCount += 1;
      if (callCount === 1) throw new Error('connection reset');
      return response(init.method === 'DELETE' ? 200 : 404);
    },
  });

  assert.equal(callCount, 8);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.entities[0].deletion.status, null);
  assert.equal(receipt.entities[0].deletion.error, 'connection reset');
  assert.equal(receipt.entities[0].readback.absent, true);
  assert.equal(receipt.entities[0].ok, false);
  assert.ok(receipt.entities.slice(1).every((entity) => entity.ok));
});

test('writes one deterministic JSON receipt inside the uploaded artifact directory', () => {
  const writes = [];
  const directories = [];
  const receipt = { schema_version: RECEIPT_SCHEMA_VERSION, ok: true, entities: [] };
  const receiptPath = writeRuntimeSmokeCleanupReceipt({
    artifactDir: 'artifacts/runtime-ui-smoke/ci',
    receipt,
    fsImpl: {
      mkdirSync(directory, options) {
        directories.push({ directory, options });
      },
      writeFileSync(filePath, body, encoding) {
        writes.push({ filePath, body, encoding });
      },
    },
  });

  assert.equal(receiptPath, path.join('artifacts', 'runtime-ui-smoke', 'ci', 'cleanup-receipt.json'));
  assert.deepEqual(directories, [{
    directory: 'artifacts/runtime-ui-smoke/ci',
    options: { recursive: true },
  }]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filePath, receiptPath);
  assert.equal(writes[0].encoding, 'utf8');
  assert.deepEqual(JSON.parse(writes[0].body), receipt);
});

test('wires cleanup verification and receipt upload into Runtime Regression', () => {
  const smoke = fs.readFileSync(path.join(repoRoot, 'scripts/smoke-runtime-ui.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/runtime-regression.yml'), 'utf8');

  assert.match(smoke, /verifyRuntimeSmokeCleanup\(\{ baseUrl, entities \}\)/);
  assert.match(smoke, /writeRuntimeSmokeCleanupReceipt\(\{ artifactDir, receipt: cleanupReceipt \}\)/);
  assert.match(smoke, /RUNTIME_SMOKE_CLEANUP_RECEIPT/);
  assert.match(smoke, /cleanupReceipt && !cleanupReceipt\.ok/);
  assert.match(workflow, /artifacts\/runtime-ui-smoke\/\*\*/);
});
