import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-webhook-health-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'mission-control-test.db');

let closeDb: typeof import('../src/lib/db').closeDb;
let postHealthTest: typeof import('../src/app/api/runtime/webhook-health-test/route').POST;
const originalFetch = globalThis.fetch;

test.before(async () => {
  ({ closeDb } = await import('../src/lib/db'));
  ({ POST: postHealthTest } = await import('../src/app/api/runtime/webhook-health-test/route'));
});

test.after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MCK_WEBHOOK_SIGNATURE_SECRET;
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function healthRequest(runtimeConfig: Record<string, unknown>) {
  return new NextRequest('http://127.0.0.1/api/runtime/webhook-health-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runtime_type: 'webhook',
      runtime_config: runtimeConfig,
    }),
  });
}

test('unsigned 2xx proves reachability but cannot verify or enable dispatch', async () => {
  delete process.env.MCK_WEBHOOK_SIGNATURE_SECRET;
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.has('X-MCK-Signature'), false);
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const response = await postHealthTest(healthRequest({ webhook_url: 'http://127.0.0.1:9123/hook' }));
  const body = await response.json();

  assert.equal(response.status, 424);
  assert.equal(body.ok, false);
  assert.equal(body.reachable, true);
  assert.equal(body.verified, false);
  assert.equal(body.signed, false);
  assert.equal(body.secret_env, 'MCK_WEBHOOK_SIGNATURE_SECRET');
});

test('signed 2xx verifies the endpoint and emits timestamped delivery headers', async () => {
  process.env.MCK_WEBHOOK_SIGNATURE_SECRET = 'health-test-secret';
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.match(String(headers.get('X-MCK-Signature')), /^sha256=[a-f0-9]{64}$/);
    assert.match(String(headers.get('X-MCK-Timestamp')), /^\d+$/);
    assert.match(String(headers.get('X-MCK-Delivery')), /^health-/);
    return Response.json({ ok: true }, { status: 202 });
  }) as typeof fetch;

  const response = await postHealthTest(healthRequest({ webhook_url: 'http://127.0.0.1:9123/hook' }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reachable, true);
  assert.equal(body.verified, true);
  assert.equal(body.signed, true);
});

test('signed non-2xx remains reachable but fails verification', async () => {
  process.env.MCK_WEBHOOK_SIGNATURE_SECRET = 'health-test-secret';
  globalThis.fetch = (async () => new Response('denied', { status: 401 })) as typeof fetch;

  const response = await postHealthTest(healthRequest({ webhook_url: 'http://127.0.0.1:9123/hook' }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.reachable, true);
  assert.equal(body.verified, false);
  assert.equal(body.http_status, 401);
});
