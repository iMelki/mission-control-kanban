import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// Layout (all under a fresh temp dir):
//   projects/ok.txt, projects/page.html          legitimate files
//   projects/escape.txt  -> outside/secret.txt   symlink escaping the base
//   projects/escape.html -> outside/secret.html  symlink escaping the base
//   projects-evil/secret.txt, page.html          sibling dir sharing the base prefix
//   outside/secret.txt, secret.html              unrelated dir
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-path-containment-')));
const base = path.join(root, 'projects');
const sibling = `${base}-evil`;
const outside = path.join(root, 'outside');

fs.mkdirSync(base);
fs.mkdirSync(sibling);
fs.mkdirSync(outside);
fs.writeFileSync(path.join(base, 'ok.txt'), 'inside');
fs.writeFileSync(path.join(base, 'page.html'), '<p>inside</p>');
fs.writeFileSync(path.join(sibling, 'secret.txt'), 'sibling-secret');
fs.writeFileSync(path.join(sibling, 'page.html'), '<p>sibling-secret</p>');
fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside-secret');
fs.writeFileSync(path.join(outside, 'secret.html'), '<p>outside-secret</p>');

let symlinksSupported = true;
try {
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(base, 'escape.txt'));
  fs.symlinkSync(path.join(outside, 'secret.html'), path.join(base, 'escape.html'));
} catch {
  // Windows without Developer Mode / admin cannot create symlinks.
  symlinksSupported = false;
}
const symlinkSkip = symlinksSupported ? false : 'symlinks not supported on this host';

process.env.PROJECTS_PATH = base;
delete process.env.WORKSPACE_BASE_PATH;

let download: typeof import('../src/app/api/files/download/route').GET;
let preview: typeof import('../src/app/api/files/preview/route').GET;
let reveal: typeof import('../src/app/api/files/reveal/route').POST;
let containment: typeof import('../src/lib/path-containment');

test.before(async () => {
  ({ GET: download } = await import('../src/app/api/files/download/route'));
  ({ GET: preview } = await import('../src/app/api/files/preview/route'));
  ({ POST: reveal } = await import('../src/app/api/files/reveal/route'));
  containment = await import('../src/lib/path-containment');
});

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function downloadRequest(params: Record<string, string>) {
  const url = new URL('http://127.0.0.1/api/files/download');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

function previewRequest(filePath: string) {
  const url = new URL('http://127.0.0.1/api/files/preview');
  url.searchParams.set('path', filePath);
  return new NextRequest(url);
}

function revealRequest(filePath: string) {
  return new NextRequest('http://127.0.0.1/api/files/reveal', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
    headers: { 'content-type': 'application/json' },
  });
}

async function assertNoLeak(response: Response) {
  const text = await response.text();
  assert.doesNotMatch(text, /secret/, 'response must not contain content from outside the base');
}

// --- download ---------------------------------------------------------------

test('download: legitimate file inside the base (full path) is served', async () => {
  const response = await download(downloadRequest({ path: path.join(base, 'ok.txt') }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.content, 'inside');
  assert.equal(body.relativePath, 'ok.txt');
});

test('download: legitimate file inside the base (relativePath) is served raw', async () => {
  const response = await download(downloadRequest({ relativePath: 'ok.txt', raw: 'true' }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'inside');
});

test('download: missing file inside the base is 404', async () => {
  const response = await download(downloadRequest({ path: path.join(base, 'missing.txt') }));
  assert.equal(response.status, 404);
});

test('download: sibling-prefix path <base>-evil/x is denied', async () => {
  const response = await download(downloadRequest({ path: path.join(sibling, 'secret.txt') }));
  assert.equal(response.status, 403);
  await assertNoLeak(response);
});

test('download: sibling-prefix path does not reveal whether the file exists', async () => {
  const response = await download(downloadRequest({ path: path.join(sibling, 'missing.txt') }));
  assert.equal(response.status, 403);
});

test('download: .. traversal out of the base is denied', async () => {
  for (const target of [
    `${base}${path.sep}..${path.sep}outside${path.sep}secret.txt`,
    `${base}${path.sep}..${path.sep}projects-evil${path.sep}secret.txt`,
  ]) {
    const response = await download(downloadRequest({ path: target }));
    assert.equal(response.status, 403, target);
    await assertNoLeak(response);
  }
});

test('download: .. traversal in relativePath is rejected', async () => {
  const response = await download(downloadRequest({ relativePath: `..${path.sep}outside${path.sep}secret.txt` }));
  assert.equal(response.status, 400);
  await assertNoLeak(response);
});

test('download: symlink inside the base pointing outside is denied (full path)', { skip: symlinkSkip }, async () => {
  const response = await download(downloadRequest({ path: path.join(base, 'escape.txt') }));
  assert.equal(response.status, 403);
  await assertNoLeak(response);
});

test('download: symlink inside the base pointing outside is denied (relativePath)', { skip: symlinkSkip }, async () => {
  const response = await download(downloadRequest({ relativePath: 'escape.txt', raw: 'true' }));
  assert.equal(response.status, 403);
  await assertNoLeak(response);
});

// --- preview ----------------------------------------------------------------

test('preview: legitimate HTML file inside the base is served', async () => {
  const response = await preview(previewRequest(path.join(base, 'page.html')));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<p>inside</p>');
});

test('preview: sibling-prefix path <base>-evil/x is denied', async () => {
  const response = await preview(previewRequest(path.join(sibling, 'page.html')));
  assert.equal(response.status, 403);
  await assertNoLeak(response);
});

test('preview: .. traversal out of the base is denied', async () => {
  const response = await preview(previewRequest(`${base}${path.sep}..${path.sep}outside${path.sep}secret.html`));
  assert.equal(response.status, 403);
  await assertNoLeak(response);
});

test('preview: symlink inside the base pointing outside is denied', { skip: symlinkSkip }, async () => {
  const response = await preview(previewRequest(path.join(base, 'escape.html')));
  assert.equal(response.status, 403);
  await assertNoLeak(response);
});

// --- reveal (only paths that are rejected before the OS opener runs) --------

test('reveal: missing path inside the base passes containment and is 404', async () => {
  const response = await reveal(revealRequest(path.join(base, 'missing.txt')));
  assert.equal(response.status, 404);
});

test('reveal: sibling-prefix path <base>-evil/x is denied', async () => {
  const response = await reveal(revealRequest(path.join(sibling, 'secret.txt')));
  assert.equal(response.status, 403);
});

test('reveal: .. traversal out of the base is denied', async () => {
  const response = await reveal(revealRequest(`${base}${path.sep}..${path.sep}outside${path.sep}secret.txt`));
  assert.equal(response.status, 403);
});

test('reveal: symlink inside the base pointing outside is denied', { skip: symlinkSkip }, async () => {
  const response = await reveal(revealRequest(path.join(base, 'escape.txt')));
  assert.equal(response.status, 403);
});

// --- helper -----------------------------------------------------------------

test('isWithinBase uses a path-separator boundary', () => {
  assert.equal(containment.isWithinBase(base, base), true);
  assert.equal(containment.isWithinBase(path.join(base, 'a', 'b'), base), true);
  assert.equal(containment.isWithinBase(path.join(sibling, 'x'), base), false);
  assert.equal(containment.isWithinBase(sibling, base), false);
  assert.equal(containment.isWithinBase(root, base), false);
});

test('resolvePathWithinBases accepts a file reached through a symlinked base', { skip: symlinkSkip }, async () => {
  const linkedBase = path.join(root, 'projects-link');
  fs.symlinkSync(base, linkedBase);
  const viaLink = await containment.resolvePathWithinBases(path.join(linkedBase, 'ok.txt'), [linkedBase]);
  assert.deepEqual(viaLink, { ok: true, realPath: path.join(base, 'ok.txt'), realBase: base });
  const viaReal = await containment.resolvePathWithinBases(path.join(base, 'ok.txt'), [linkedBase]);
  assert.equal(viaReal.ok, true);
});

test('resolvePathWithinBases skips empty bases and denies when none match', async () => {
  assert.deepEqual(await containment.resolvePathWithinBases(path.join(base, 'ok.txt'), []), {
    ok: false,
    reason: 'outside-base',
  });
  assert.equal((await containment.resolvePathWithinBases(path.join(base, 'ok.txt'), ['', base])).ok, true);
});
