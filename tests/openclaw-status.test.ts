import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawClient } from '../src/lib/openclaw/client';
import { toPublicGatewayError } from '../src/lib/openclaw/public-error';
import { getOpenClawStatus } from '../src/lib/openclaw/status';

type StatusClient = Pick<OpenClawClient, 'isConnected' | 'connect' | 'listSessions'>;

function fakeClient(overrides: Partial<StatusClient> = {}): StatusClient {
  return {
    isConnected: () => true,
    connect: async () => undefined,
    listSessions: async () => [],
    ...overrides,
  };
}

test('toPublicGatewayError keeps a plain missing-scope message and numeric code', () => {
  const err = Object.assign(new Error('missing scope: operator.read'), { code: 401 });
  assert.deepEqual(toPublicGatewayError(err), {
    message: 'missing scope: operator.read',
    code: 401,
  });
});

test('toPublicGatewayError redacts token, header, and secret values', () => {
  const secret = 'totally-fake-test-secret';
  const token = 'totally-fake-test-token';
  const message = [
    'sessions.list failed at ws://127.0.0.1:28789/?token=' + token,
    'Authorization: Bearer ' + token,
    'X-Gateway-Token: ' + token,
    '{"token":"' + secret + '"}',
    'OPENCLAW_GATEWAY_TOKEN=' + secret,
  ].join(' ');

  const publicError = toPublicGatewayError(new Error(message));
  assert.equal(publicError.message.includes(token), false);
  assert.equal(publicError.message.includes(secret), false);
  assert.match(publicError.message, /token=\[redacted\]/);
  assert.match(publicError.message, /Authorization:\s*\[redacted\]/);
  assert.match(publicError.message, /X-Gateway-Token:\s*\[redacted\]/);
  assert.match(publicError.message, /"token":"\[redacted\]"/);
  assert.match(publicError.message, /OPENCLAW_GATEWAY_TOKEN=\[redacted\]/);

  const standalone = toPublicGatewayError(new Error('rejected Bearer ' + token));
  assert.equal(standalone.message.includes(token), false);
  assert.match(standalone.message, /Bearer \[redacted\]/);
});

test('toPublicGatewayError uses the fallback when the error has no message', () => {
  assert.deepEqual(toPublicGatewayError(new Error(''), 'Connected but failed to list sessions'), {
    message: 'Connected but failed to list sessions',
  });
});

test('list-sessions failure returns the gateway error message and code', async () => {
  const err = Object.assign(new Error('missing scope: operator.read'), { code: 401 });
  const response = await getOpenClawStatus(fakeClient({
    listSessions: async () => {
      throw err;
    },
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.connected, true);
  assert.equal(body.error, 'missing scope: operator.read');
  assert.equal(body.error_code, 401);
  assert.equal(body.error === 'Connected but failed to list sessions', false);
});

test('list-sessions failure redacts token, header, and secret values from the response', async () => {
  const token = 'totally-fake-test-token';
  const secret = 'totally-fake-test-secret';
  const response = await getOpenClawStatus(fakeClient({
    listSessions: async () => {
      throw new Error(`gateway url ws://127.0.0.1:28789/?token=${token} Authorization: Bearer ${secret}`);
    },
  }));
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.connected, true);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(secret), false);
  assert.match(body.error, /token=\[redacted\]/);
  assert.match(body.error, /Authorization:\s*\[redacted\]/);
});

test('list-sessions success still returns sessions_count', async () => {
  const sessions = [{ id: 'sess-1' }, { id: 'sess-2' }];
  const response = await getOpenClawStatus(fakeClient({
    listSessions: async () => sessions as never,
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.connected, true);
  assert.equal(body.sessions_count, 2);
  assert.deepEqual(body.sessions, sessions);
  assert.equal(body.error, undefined);
});
