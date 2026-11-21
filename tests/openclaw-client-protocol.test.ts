import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_CLIENT_IDENTITY,
  OPENCLAW_PROTOCOL_VERSION,
  OpenClawClient,
  buildConnectParams,
  errorFromGateway,
} from '../src/lib/openclaw/client';

test('OPENCLAW_PROTOCOL_VERSION is 4, matching openclaw@2026.9.7', () => {
  assert.equal(OPENCLAW_PROTOCOL_VERSION, 4);
});

test('buildConnectParams sends protocol 4 and the client identity fields', () => {
  const params = buildConnectParams('test-token');

  assert.equal(params.minProtocol, OPENCLAW_PROTOCOL_VERSION);
  assert.equal(params.maxProtocol, OPENCLAW_PROTOCOL_VERSION);
  assert.equal(params.minProtocol, 4);
  assert.equal(params.maxProtocol, 4);
  assert.deepEqual(params.client, {
    id: 'gateway-client',
    version: '1.0.0',
    platform: 'node',
    mode: 'backend',
  });
  assert.deepEqual(params.client, { ...OPENCLAW_CLIENT_IDENTITY });
  assert.equal(params.role, 'operator');
  assert.deepEqual(params.scopes, ['operator.read', 'operator.write']);
  assert.deepEqual(params.auth, { token: 'test-token' });
});

// Regression: "missing scope: operator.read" on /api/openclaw/status.
// openclaw 2026.11.x keeps the requested scopes of a token-auth client that
// has no device identity only when it is a local backend client
// (client.id 'gateway-client' + client.mode 'backend', loopback, no Origin).
// Any other id/mode (the old 'ui' mode included) gets its scopes cleared, and
// sessions.list is then refused. This mirrors that gateway rule so a future
// identity edit cannot silently bring the error back.
function gatewayKeepsTokenScopesWithoutDevice(client: { id: string; mode: string }): boolean {
  return client.id === 'gateway-client' && client.mode === 'backend';
}

test('client identity is the local backend shape the gateway keeps scopes for', () => {
  const params = buildConnectParams('test-token');
  assert.equal(gatewayKeepsTokenScopesWithoutDevice(params.client), true);
  assert.ok(params.scopes.includes('operator.read'), 'sessions.list needs operator.read');
  assert.equal('device' in params, false);
});

test('the previous ui mode is the shape whose scopes the gateway clears', () => {
  assert.equal(gatewayKeepsTokenScopesWithoutDevice({ id: 'gateway-client', mode: 'ui' }), false);
  assert.notEqual(OPENCLAW_CLIENT_IDENTITY.mode, 'ui');
});

type FakeListener = ((event?: unknown) => void) | null;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: FakeListener = null;
  onclose: FakeListener = null;
  onerror: FakeListener = null;
  onmessage: FakeListener = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.({});
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '', wasClean: true });
  }
}

test('connect frame after connect.challenge uses protocol 4 and client identity', async () => {
  const OriginalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  // @ts-expect-error test double replaces the DOM/Node WebSocket
  globalThis.WebSocket = FakeWebSocket;

  const client = new OpenClawClient('ws://127.0.0.1:28789', 'test-token');
  client.setAutoReconnect(false);

  try {
    const connected = client.connect();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    assert.equal(FakeWebSocket.instances.length, 1);
    const ws = FakeWebSocket.instances[0];
    assert.ok(ws.onmessage, 'onmessage handler should be installed');

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'test-nonce', ts: 1737264000000 },
      }),
    });

    assert.equal(ws.sent.length, 1);
    const frame = JSON.parse(ws.sent[0]) as {
      type: string;
      id: string;
      method: string;
      params: ReturnType<typeof buildConnectParams>;
    };

    assert.equal(frame.type, 'req');
    assert.equal(frame.method, 'connect');
    assert.equal(typeof frame.id, 'string');
    assert.equal(frame.params.minProtocol, 4);
    assert.equal(frame.params.maxProtocol, 4);
    assert.deepEqual(frame.params.client, {
      id: 'gateway-client',
      version: '1.0.0',
      platform: 'node',
      mode: 'backend',
    });
    assert.equal(frame.params.role, 'operator');
    assert.equal('device' in frame.params, false, 'backend client must not send a device identity');
    assert.deepEqual(frame.params.scopes, ['operator.read', 'operator.write']);
    assert.deepEqual(frame.params.auth, { token: 'test-token' });

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { type: 'hello-ok', protocol: 4 },
      }),
    });

    await connected;
    assert.equal(client.isConnected(), true);
  } finally {
    client.disconnect();
    globalThis.WebSocket = OriginalWebSocket;
  }
});

test('errorFromGateway keeps a string gateway error.code', () => {
  const forbidden = errorFromGateway({ code: 'FORBIDDEN', message: 'missing scope: operator.read' });
  assert.equal(forbidden.message, 'missing scope: operator.read');
  assert.equal(forbidden.code, 'FORBIDDEN');

  const numeric = errorFromGateway({ code: 401, message: 'unauthorized' });
  assert.equal(numeric.code, 401);

  const trimmed = errorFromGateway({ code: '  FORBIDDEN  ', message: 'missing scope: operator.read' });
  assert.equal(trimmed.code, 'FORBIDDEN');

  const dropped = errorFromGateway({ code: '   ', message: 'blank code' });
  assert.equal(dropped.message, 'blank code');
  assert.equal('code' in dropped, false);
});

test('sessions.list rejection keeps a string gateway error.code', async () => {
  const OriginalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  // @ts-expect-error test double replaces the DOM/Node WebSocket
  globalThis.WebSocket = FakeWebSocket;

  const client = new OpenClawClient('ws://127.0.0.1:28789', 'test-token');
  client.setAutoReconnect(false);

  try {
    const connected = client.connect();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const ws = FakeWebSocket.instances[0];
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'test-nonce', ts: 1737264000000 },
      }),
    });
    const connectFrame = JSON.parse(ws.sent[0]) as { id: string };
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'res',
        id: connectFrame.id,
        ok: true,
        payload: { type: 'hello-ok', protocol: 4 },
      }),
    });
    await connected;

    const listed = client.listSessions();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const listFrame = JSON.parse(ws.sent[1]) as { id: string; method: string };
    assert.equal(listFrame.method, 'sessions.list');

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'res',
        id: listFrame.id,
        ok: false,
        error: { code: 'FORBIDDEN', message: 'missing scope: operator.read' },
      }),
    });

    await assert.rejects(listed, (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'missing scope: operator.read');
      assert.equal((err as Error & { code?: string }).code, 'FORBIDDEN');
      return true;
    });
  } finally {
    client.disconnect();
    globalThis.WebSocket = OriginalWebSocket;
  }
});
