import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithBudget } from '../src/lib/fetch-budget';

const originalFetch = globalThis.fetch;

test('keeps the deadline active while a JSON body is stalled', async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestSignal = init?.signal as AbortSignal;
    return new Response(new ReadableStream({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode('{"tasks":'));
      },
    }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const request = await fetchWithBudget('/api/tasks', { timeoutMs: 10 });
    await assert.rejects(request.json(), (error: Error) => error.name === 'AbortError');
    assert.equal(requestSignal?.aborted, true);
  } finally {
    streamController?.error(new DOMException('Test cleanup.', 'AbortError'));
    globalThis.fetch = originalFetch;
  }
});

test('does not start a request when the caller signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('Unmounted.', 'AbortError'));
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchWithBudget('/api/tasks', { signal: controller.signal }),
      (error: Error) => error.name === 'AbortError',
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
