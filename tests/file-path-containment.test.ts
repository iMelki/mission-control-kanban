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
fs.mkdirSync(path.join(base, 'sub'));

// Bugbot on #200 (existence oracle). Extra layout:
//   projects/escape-dir   -> outside/            directory symlink escaping the base
//   projects/dangling.txt -> outside/nope.txt    dangling symlink escaping the base
//   projects/sub-link     -> projects/sub/       directory symlink that stays inside
// CodeRabbit on #200 (relative dangling links whose target walks through a symlink and ..):
//   projects/dotdot-out.txt -> escape-dir/../nope.txt  really <root>/nope.txt (outside)
//   projects/dotdot-in.txt  -> sub-link/../nope.txt    really projects/nope.txt (inside)
let symlinksSupported = true;
try {
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(base, 'escape.txt'));
  fs.symlinkSync(path.join(outside, 'secret.html'), path.join(base, 'escape.html'));
  fs.symlinkSync(outside, path.join(base, 'escape-dir'), 'dir');
  fs.symlinkSync(path.join(outside, 'nope.txt'), path.join(base, 'dangling.txt'));
  fs.symlinkSync(path.join(base, 'sub'), path.join(base, 'sub-link'), 'dir');
  fs.symlinkSync(['escape-dir', '..', 'nope.txt'].join(path.sep), path.join(base, 'dotdot-out.txt'));
  fs.symlinkSync(['sub-link', '..', 'nope.txt'].join(path.sep), path.join(base, 'dotdot-in.txt'));
} catch {
  // Windows without Developer Mode / admin cannot create symlinks.
  symlinksSupported = false;
}
const symlinkSkip = symlinksSupported ? false : 'symlinks not supported on this host';

// Bugbot on #200 (dangling targets misclassified by prefix). Absolute dangling targets
// that are inside the base only once symlinks / .. are resolved:
//   root-alias -> <root>                                symlinked ancestor of the base
//   projects/alias-in.txt   -> root-alias/projects/missing.txt   really projects/missing.txt
//   projects/alias-out.txt  -> root-alias/outside/missing.txt    really outside/missing.txt
//   projects/abs-dotdot-in.txt  -> <base>/sub/../missing.txt         really projects/missing.txt
//   projects/abs-dotdot-up.txt  -> <root>/outside/../projects/missing.txt  really projects/missing.txt
//   projects/abs-dotdot-out.txt -> <base>/escape-dir/../nope.txt     really <root>/nope.txt
const rootAlias = path.join(root, 'root-alias');
if (symlinksSupported) {
  fs.symlinkSync(root, rootAlias, 'dir');
  fs.symlinkSync(path.join(rootAlias, 'projects', 'missing.txt'), path.join(base, 'alias-in.txt'));
  fs.symlinkSync(path.join(rootAlias, 'outside', 'missing.txt'), path.join(base, 'alias-out.txt'));
  fs.symlinkSync([base, 'sub', '..', 'missing.txt'].join(path.sep), path.join(base, 'abs-dotdot-in.txt'));
  fs.symlinkSync([outside, '..', 'projects', 'missing.txt'].join(path.sep), path.join(base, 'abs-dotdot-up.txt'));
  fs.symlinkSync([base, 'escape-dir', '..', 'nope.txt'].join(path.sep), path.join(base, 'abs-dotdot-out.txt'));
}

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

// --- existence oracle through an escaping symlink (Bugbot on #200) ----------
// A missing path behind a symlink that leaves the base must get the same 403 as an
// existing one; otherwise 404-vs-403 tells the caller whether the outside path exists.

test('download: missing child of a directory symlink pointing outside is 403, not 404', { skip: symlinkSkip }, async () => {
  const missing = await download(downloadRequest({ path: path.join(base, 'escape-dir', 'missing.txt') }));
  assert.equal(missing.status, 403);
  const existing = await download(downloadRequest({ path: path.join(base, 'escape-dir', 'secret.txt') }));
  assert.equal(existing.status, 403);
  await assertNoLeak(existing);
});

test('download: missing child of an escaping directory symlink via relativePath is 403', { skip: symlinkSkip }, async () => {
  const response = await download(downloadRequest({ relativePath: `escape-dir${path.sep}missing.txt`, raw: 'true' }));
  assert.equal(response.status, 403);
});

test('download: dangling symlink pointing outside is 403, not 404', { skip: symlinkSkip }, async () => {
  const response = await download(downloadRequest({ path: path.join(base, 'dangling.txt') }));
  assert.equal(response.status, 403);
});

// CodeRabbit on #200: the link target must not be lexically normalized before its
// symlinks are followed. escape-dir/.. is <root> (the parent of outside/), not the base.
test('download: dangling link through an escaping dir symlink and .. is 403, not 404', { skip: symlinkSkip }, async () => {
  const missing = await download(downloadRequest({ path: path.join(base, 'dotdot-out.txt') }));
  assert.equal(missing.status, 403);
  // Same answer once the real outside target exists: no existence oracle.
  fs.writeFileSync(path.join(root, 'nope.txt'), 'outside-secret');
  try {
    const existing = await download(downloadRequest({ path: path.join(base, 'dotdot-out.txt') }));
    assert.equal(existing.status, 403);
    await assertNoLeak(existing);
  } finally {
    fs.rmSync(path.join(root, 'nope.txt'), { force: true });
  }
});

test('download: dangling link through an inside dir symlink and .. stays 404', { skip: symlinkSkip }, async () => {
  const response = await download(downloadRequest({ path: path.join(base, 'dotdot-in.txt') }));
  assert.equal(response.status, 404);
});

// Bugbot on #200: an absolute dangling target is classified by where it really resolves,
// not by a string prefix compare against the real base.
test('download: dangling absolute link spelling the base through a symlinked ancestor is 404', { skip: symlinkSkip }, async () => {
  const response = await download(downloadRequest({ path: path.join(base, 'alias-in.txt') }));
  assert.equal(response.status, 404);
});

test('download: dangling absolute link whose target folds .. back into the base is 404', { skip: symlinkSkip }, async () => {
  for (const link of ['abs-dotdot-in.txt', 'abs-dotdot-up.txt']) {
    const response = await download(downloadRequest({ path: path.join(base, link) }));
    assert.equal(response.status, 404, link);
  }
});

test('download: dangling absolute links that really resolve outside stay 403', { skip: symlinkSkip }, async () => {
  for (const link of ['alias-out.txt', 'abs-dotdot-out.txt']) {
    const response = await download(downloadRequest({ path: path.join(base, link) }));
    assert.equal(response.status, 403, link);
  }
  // Same answer once the outside targets exist: no existence oracle.
  fs.writeFileSync(path.join(outside, 'missing.txt'), 'outside-secret');
  fs.writeFileSync(path.join(root, 'nope.txt'), 'outside-secret');
  try {
    for (const link of ['alias-out.txt', 'abs-dotdot-out.txt']) {
      const response = await download(downloadRequest({ path: path.join(base, link) }));
      assert.equal(response.status, 403, link);
      await assertNoLeak(response);
    }
  } finally {
    fs.rmSync(path.join(outside, 'missing.txt'), { force: true });
    fs.rmSync(path.join(root, 'nope.txt'), { force: true });
  }
});

test('preview: missing child of a directory symlink pointing outside is 403, not 404', { skip: symlinkSkip }, async () => {
  const response = await preview(previewRequest(path.join(base, 'escape-dir', 'missing.html')));
  assert.equal(response.status, 403);
});

test('reveal: missing child of a directory symlink pointing outside is 403, not 404', { skip: symlinkSkip }, async () => {
  const response = await reveal(revealRequest(path.join(base, 'escape-dir', 'missing.txt')));
  assert.equal(response.status, 403);
});

test('download: missing paths that stay inside the base are still 404', async () => {
  for (const target of [
    path.join(base, 'missing.txt'),
    path.join(base, 'no-such-dir', 'missing.txt'),
    path.join(base, 'sub', 'missing.txt'),
    path.join(base, 'ok.txt', 'child'), // ENOTDIR: a file used as a directory
  ]) {
    const response = await download(downloadRequest({ path: target }));
    assert.equal(response.status, 404, target);
  }
});

test('download: missing child of a directory symlink that stays inside the base is 404', { skip: symlinkSkip }, async () => {
  const response = await download(downloadRequest({ path: path.join(base, 'sub-link', 'missing.txt') }));
  assert.equal(response.status, 404);
});

test('resolvePathWithinBases classifies missing targets by their deepest existing ancestor', { skip: symlinkSkip }, async () => {
  assert.deepEqual(await containment.resolvePathWithinBases(path.join(base, 'escape-dir', 'missing.txt'), [base]), {
    ok: false,
    reason: 'outside-base',
  });
  assert.deepEqual(await containment.resolvePathWithinBases(path.join(base, 'escape-dir', 'a', 'b'), [base]), {
    ok: false,
    reason: 'outside-base',
  });
  assert.deepEqual(await containment.resolvePathWithinBases(path.join(base, 'dangling.txt'), [base]), {
    ok: false,
    reason: 'outside-base',
  });
  assert.deepEqual(await containment.resolvePathWithinBases(path.join(base, 'sub-link', 'missing.txt'), [base]), {
    ok: false,
    reason: 'not-found',
  });
  assert.deepEqual(await containment.resolvePathWithinBases(path.join(base, 'no-such-dir', 'x'), [base]), {
    ok: false,
    reason: 'not-found',
  });
  for (const link of ['alias-in.txt', 'abs-dotdot-in.txt', 'abs-dotdot-up.txt']) {
    assert.deepEqual(await containment.resolvePathWithinBases(path.join(base, link), [base]), { ok: false, reason: 'not-found' }, link);
    // Same answer when the base itself is configured through the symlinked ancestor.
    assert.deepEqual(
      await containment.resolvePathWithinBases(path.join(rootAlias, 'projects', link), [path.join(rootAlias, 'projects')]),
      { ok: false, reason: 'not-found' },
      link,
    );
  }
  for (const link of ['alias-out.txt', 'abs-dotdot-out.txt', 'dotdot-out.txt']) {
    assert.deepEqual(await containment.resolvePathWithinBases(path.join(base, link), [base]), { ok: false, reason: 'outside-base' }, link);
  }
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
