import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_CLIENT_IDENTITY,
  OPENCLAW_PROTOCOL_VERSION,
  OpenClawClient,
  buildConnectParams,
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
    platform: 'web',
    mode: 'ui',
  });
  assert.deepEqual(params.client, { ...OPENCLAW_CLIENT_IDENTITY });
  assert.equal(params.role, 'operator');
  assert.deepEqual(params.scopes, ['operator.read', 'operator.write']);
  assert.deepEqual(params.auth, { token: 'test-token' });
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
      platform: 'web',
      mode: 'ui',
    });
    assert.equal(frame.params.role, 'operator');
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
