import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, type ExecFileOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// POST /api/files/reveal must hand the path to the OS opener as a single argv
// entry with no shell in between. The opener is replaced through the
// `revealOpener` seam so no real file manager is launched.
//
// Layout (all under a fresh temp dir):
//   projects/ok.txt                         legitimate file
//   projects/<payload>/f.txt                payload in a directory name (Linux reveals the dirname)
//   projects/<payload>.txt                  payload in a file name (macOS / Windows reveal the file)
//   projects/escape.txt -> outside/secret.txt
//   projects-evil/secret.txt                sibling dir sharing the base prefix
//   outside/secret.txt
//   cwd/                                    process cwd while tests run; a shell
//                                           payload `touch <name>` would land here
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-reveal-exec-')));
const base = path.join(root, 'projects');
const sibling = `${base}-evil`;
const outside = path.join(root, 'outside');
const cwdDir = path.join(root, 'cwd');

for (const dir of [base, sibling, outside, cwdDir]) fs.mkdirSync(dir);
fs.writeFileSync(path.join(base, 'ok.txt'), 'inside');
fs.writeFileSync(path.join(sibling, 'secret.txt'), 'sibling-secret');
fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside-secret');

let symlinksSupported = true;
try {
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(base, 'escape.txt'));
} catch {
  symlinksSupported = false;
}
const symlinkSkip = symlinksSupported ? false : 'symlinks not supported on this host';

// Each payload, if a shell ever saw it, would create `cwd/<marker>`.
const payloads = [
  { label: 'semicolon', name: 'a; touch mc-pwned-semi', marker: 'mc-pwned-semi' },
  { label: 'command substitution', name: '$(touch mc-pwned-subst)', marker: 'mc-pwned-subst' },
  { label: 'backticks', name: '`touch mc-pwned-tick`', marker: 'mc-pwned-tick' },
  { label: 'double ampersand', name: 'a && touch mc-pwned-and', marker: 'mc-pwned-and' },
  { label: 'double quote breakout', name: 'x"; touch mc-pwned-dq; echo "', marker: 'mc-pwned-dq' },
  { label: 'double quote + &&', name: 'x" && touch mc-pwned-dqand && echo "', marker: 'mc-pwned-dqand' },
  { label: 'single quote breakout', name: "x'; touch mc-pwned-sq; echo '", marker: 'mc-pwned-sq' },
] as const;

// Windows file names cannot hold these characters; only create what the host allows.
const createdPayloads = payloads.filter(({ name }) => {
  try {
    fs.mkdirSync(path.join(base, name));
    fs.writeFileSync(path.join(base, name, 'f.txt'), 'inside');
    fs.writeFileSync(path.join(base, `${name}.txt`), 'inside');
    return true;
  } catch {
    return false;
  }
});

process.env.PROJECTS_PATH = base;
delete process.env.WORKSPACE_BASE_PATH;

type Call = { file: string; args: readonly string[]; options: ExecFileOptions };
let calls: Call[] = [];

let reveal: typeof import('../src/app/api/files/reveal/route').POST;
let opener: typeof import('../src/lib/reveal-in-file-manager');
let originalCwd: string;

test.before(async () => {
  ({ POST: reveal } = await import('../src/app/api/files/reveal/route'));
  opener = await import('../src/lib/reveal-in-file-manager');
  originalCwd = process.cwd();
  process.chdir(cwdDir);
});

test.beforeEach(() => {
  // Start every test with an empty cwd so a marker is attributed to the test that made it.
  for (const entry of fs.readdirSync(cwdDir)) fs.rmSync(path.join(cwdDir, entry), { force: true });
  calls = [];
  opener.revealOpener.platform = 'linux';
  opener.revealOpener.run = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
  };
});

test.after(() => {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

function revealRequest(filePath: string) {
  return new NextRequest('http://127.0.0.1/api/files/reveal', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
    headers: { 'content-type': 'application/json' },
  });
}

function assertNoMarkers() {
  const created = fs.readdirSync(cwdDir);
  assert.deepEqual(created, [], `shell payload executed and created: ${created.join(', ')}`);
}

// --- shell metacharacters are one argument, never interpreted -------------------

for (const { label, name } of createdPayloads) {
  test(`reveal (linux): ${label} in a directory name is passed as one xdg-open argument`, async () => {
    const target = path.join(base, name, 'f.txt');
    const response = await reveal(revealRequest(target));

    assertNoMarkers();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, path: target });
    assert.equal(calls.length, 1, 'the injected opener must be the only thing that runs');
    assert.equal(calls[0].file, 'xdg-open');
    assert.deepEqual(calls[0].args, [path.join(base, name)]);
    assert.notEqual(calls[0].options.shell, true);
  });

  test(`reveal (darwin): ${label} in a file name is passed as one open -R argument`, async () => {
    opener.revealOpener.platform = 'darwin';
    const target = path.join(base, `${name}.txt`);
    const response = await reveal(revealRequest(target));

    assertNoMarkers();
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(({ file, args }) => [file, args]), [['open', ['-R', target]]]);
    assert.notEqual(calls[0].options.shell, true);
  });
}

test('reveal (win32): metacharacters stay inside the verbatim /select,"<path>" argument', async () => {
  opener.revealOpener.platform = 'win32';
  const name = createdPayloads.find(({ name: n }) => !n.includes('"'))?.name;
  assert.ok(name, 'need at least one payload without a double quote');
  const target = path.join(base, `${name}.txt`);
  const response = await reveal(revealRequest(target));

  assertNoMarkers();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'explorer.exe');
  assert.deepEqual(calls[0].args, [`/select,"${target}"`]);
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
  assert.notEqual(calls[0].options.shell, true);
});

test('reveal (win32): a path containing a double quote is refused before explorer runs', async () => {
  opener.revealOpener.platform = 'win32';
  const name = createdPayloads.find(({ name: n }) => n.includes('"'))?.name;
  if (!name) return; // host cannot create such a file (Windows); nothing to refuse
  const response = await reveal(revealRequest(path.join(base, `${name}.txt`)));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to reveal file' });
  assert.equal(calls.length, 0);
});

test('reveal: argv survives a real execFile round trip without a shell', async () => {
  // Run the built command through real execFile, but with `node` echoing its
  // argv in place of the opener, to prove the OS receives the path verbatim.
  const received: string[][] = [];
  opener.revealOpener.run = (_file, args, options) =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        // `--` stops node from reading `-R` as its own flag; argv[1..] is then exactly `args`.
        ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...args],
        { ...options, cwd: cwdDir },
        (error, stdout) => {
          if (error) return reject(error);
          received.push(JSON.parse(String(stdout)));
          resolve();
        },
      );
    });

  for (const platform of ['linux', 'darwin'] as const) {
    opener.revealOpener.platform = platform;
    for (const { name } of createdPayloads) {
      const target = platform === 'linux' ? path.join(base, name, 'f.txt') : path.join(base, `${name}.txt`);
      const response = await reveal(revealRequest(target));
      assert.equal(response.status, 200);
    }
  }

  assertNoMarkers();
  const expected = [
    ...createdPayloads.map(({ name }) => [path.join(base, name)]),
    ...createdPayloads.map(({ name }) => ['-R', path.join(base, `${name}.txt`)]),
  ];
  assert.deepEqual(received, expected);
});

// --- containment still denies before anything runs ------------------------------

test('reveal: path outside the base is 403 and the opener never runs', async () => {
  const response = await reveal(revealRequest(path.join(outside, 'secret.txt')));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Path not in allowed directories' });
  assert.equal(calls.length, 0);
});

test('reveal: sibling-prefix path <base>-evil/x is 403 and the opener never runs', async () => {
  const response = await reveal(revealRequest(path.join(sibling, 'secret.txt')));
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('reveal: .. traversal with a shell payload is 403 and the opener never runs', async () => {
  const response = await reveal(
    revealRequest(`${base}${path.sep}..${path.sep}outside${path.sep}$(touch mc-pwned-traversal)`),
  );
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
  assertNoMarkers();
});

test('reveal: symlink inside the base pointing outside is 403', { skip: symlinkSkip }, async () => {
  const response = await reveal(revealRequest(path.join(base, 'escape.txt')));
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('reveal: missing file inside the base is 404 and the opener never runs', async () => {
  const target = path.join(base, 'missing.txt');
  const response = await reveal(revealRequest(target));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'File or directory not found', path: target });
  assert.equal(calls.length, 0);
});

test('reveal: missing filePath is 400', async () => {
  const response = await reveal(revealRequest(''));
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

// --- legitimate path ------------------------------------------------------------

test('reveal: legitimate path produces the expected argv on each platform', async () => {
  const target = path.join(base, 'ok.txt');
  const expected = {
    linux: ['xdg-open', [base]],
    darwin: ['open', ['-R', target]],
    win32: ['explorer.exe', [`/select,"${target}"`]],
  } as const;

  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    calls = [];
    opener.revealOpener.platform = platform;
    const response = await reveal(revealRequest(target));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, path: target });
    assert.deepEqual(calls.map(({ file, args }) => [file, args]), [expected[platform]]);
  }
});

test('reveal: opener failure is reported as 500', async () => {
  opener.revealOpener.run = async () => {
    throw new Error('spawn xdg-open ENOENT');
  };
  const response = await reveal(revealRequest(path.join(base, 'ok.txt')));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to reveal file' });
});

test('buildRevealCommand never asks for a shell', () => {
  const target = path.join(base, '$(id) `id` ; && | >', '$(id) `id` ; && | > x.txt');
  for (const platform of ['linux', 'darwin', 'win32', 'freebsd'] as const) {
    const command = opener.buildRevealCommand(platform, target);
    assert.notEqual(command.options.shell, true, platform);
    assert.equal(command.args.filter((arg) => arg.includes('$(id) `id` ; && | >')).length, 1, platform);
  }
});
