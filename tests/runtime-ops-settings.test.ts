/**
 * RuntimeOpsSettings' maintenance actions (retention, callback prune) check response.ok before
 * reading the body (#194 r12). React Doctor's no-fetch-response-used-without-status-check also
 * catches a revert, but only when the file is staged; these tests catch it on every run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readActionResult } from '../src/lib/action-result';

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('an OK answer is the action result', async () => {
  assert.deepEqual(await readActionResult(json({ deleted: 3, dry_run: true }, 200)), { deleted: 3, dry_run: true });
});

test('a non-OK answer is never shown as a result, even when its body looks like one', async () => {
  assert.deepEqual(await readActionResult(json({ deleted: 3 }, 500)), { error: 'The server answered HTTP 500' });
});

test("a non-OK answer shows the server's error when it gave one", async () => {
  assert.deepEqual(await readActionResult(json({ error: 'Retention is disabled' }, 409)), { error: 'Retention is disabled' });
});

test('a non-OK answer with no JSON body falls back to the HTTP status', async () => {
  assert.deepEqual(await readActionResult(new Response('Bad Gateway', { status: 502 })), { error: 'The server answered HTTP 502' });
});

test('both RuntimeOpsSettings actions read their answer through readActionResult, never response.json() directly', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RuntimeOpsSettings.tsx'), 'utf8');
  assert.match(source, /setRetentionResult\(await readActionResult\(response\)\)/);
  assert.match(source, /setCallbackResult\(await readActionResult\(response\)\)/);
  assert.doesNotMatch(source, /set(Retention|Callback)Result\(await response\.json\(\)\)/);
});
