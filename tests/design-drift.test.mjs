import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_THRESHOLD,
  STATUS,
  classifyRoute,
  dembrandtEnv,
  evaluateDrift,
  exitCodeFor,
  formatMarkdown,
  parseDembrandtResult,
  armTimeout,
  killProcessGroup,
  parseThreshold,
  routeSlug,
  toScore,
} from '../scripts/lib/design-drift.mjs';
import { run } from '../scripts/lib/run-process.mjs';

const report = (score, extra = {}) => ({
  score,
  status: 'stable',
  threshold: 10,
  summary: { changed: 0, added: 0, removed: 0 },
  changes: [],
  ...extra,
});

test('routeSlug names baseline files predictably', () => {
  assert.equal(routeSlug('/'), 'root');
  assert.equal(routeSlug('/workspace/default'), 'workspace-default');
  assert.equal(routeSlug('/settings/?tab=agents'), 'settings');
});

test('a score at the threshold is stable; above it is drift', () => {
  assert.equal(classifyRoute({ route: '/', drift: report(DEFAULT_THRESHOLD) }).status, STATUS.STABLE);
  assert.equal(classifyRoute({ route: '/', drift: report(DEFAULT_THRESHOLD + 0.1) }).status, STATUS.DRIFT);
  assert.equal(classifyRoute({ route: '/', drift: report(3) }, 2).status, STATUS.DRIFT);
});

test('our threshold wins over the status Dembrandt computed with its own', () => {
  const drifted = report(12, { status: 'drift' });
  assert.equal(classifyRoute({ route: '/', drift: drifted }, 20).status, STATUS.STABLE);
});

test('all-stable routes pass with exit 0', () => {
  const verdict = evaluateDrift([
    { route: '/', drift: report(0) },
    { route: '/settings', drift: report(4) },
  ]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.maxScore, 4);
  assert.equal(exitCodeFor(verdict), 0);
});

test('one drifted route fails the run with exit 1', () => {
  const verdict = evaluateDrift([
    { route: '/', drift: report(0) },
    { route: '/settings', drift: report(25, { summary: { changed: 3, added: 1, removed: 1 } }) },
  ]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.counts.drift, 1);
  assert.equal(exitCodeFor(verdict), 1);
});

test('a route that could not be measured is never a pass', () => {
  for (const result of [
    { route: '/', drift: report(0, { inconclusive: true }) },
    { route: '/', baselineMissing: true },
    { route: '/', error: 'dembrandt exited 2' },
    { route: '/', drift: report('n/a') },
  ]) {
    const verdict = evaluateDrift([result]);
    assert.equal(verdict.ok, false, JSON.stringify(result));
    assert.equal(exitCodeFor(verdict), 2, JSON.stringify(result));
  }
  assert.equal(evaluateDrift([]).ok, false, 'zero routes measured nothing');
});

test('drift outranks could-not-evaluate in the exit code', () => {
  const verdict = evaluateDrift([
    { route: '/', baselineMissing: true },
    { route: '/settings', drift: report(50) },
  ]);
  assert.equal(exitCodeFor(verdict), 1);
});

test('an invalid threshold is rejected', () => {
  assert.throws(() => evaluateDrift([], -1));
  assert.throws(() => evaluateDrift([], Number.NaN));
});

test('the Markdown report lists each route and the drifted tokens', () => {
  const verdict = evaluateDrift([
    { route: '/', drift: report(0) },
    {
      route: '/settings',
      drift: report(25, {
        summary: { changed: 1, added: 0, removed: 0 },
        changes: [{ category: 'color', kind: 'changed', label: 'semantic.primary', before: '#58a6ff', after: '#ff00ff' }],
      }),
    },
  ]);
  const markdown = formatMarkdown(verdict, { baseUrl: 'http://127.0.0.1:3021' });
  assert.match(markdown, /\| `\/` \| stable \| 0 \|/);
  assert.match(markdown, /\| `\/settings` \| drift \| 25 \| 1 \| 0 \| 0 \|/);
  assert.match(markdown, /color changed: semantic\.primary \(#58a6ff -> #ff00ff\)/);
  assert.match(markdown, /--update-baseline/);
});

test('parseDembrandtResult rejects Dembrandt error JSON even with exit 0 or 1', () => {
  const stdout = JSON.stringify({ error: 'navigation failed' });
  for (const code of [0, 1, 2]) {
    for (const compare of [false, true]) {
      const result = parseDembrandtResult({ code, stdout }, { compare });
      assert.equal(result.extract, undefined);
      assert.match(result.error, /navigation failed/);
    }
  }
});

test('parseDembrandtResult accepts exit 0 extraction and exit 1 only with a valid drift report', () => {
  const extract = { colors: [] };
  assert.deepEqual(parseDembrandtResult({ code: 0, stdout: JSON.stringify(extract) }).extract, extract);

  const drifted = { colors: [], drift: report(40, { status: 'drift' }) };
  assert.deepEqual(parseDembrandtResult({ code: 1, stdout: JSON.stringify(drifted) }, { compare: true }).extract, drifted);
  assert.ok(parseDembrandtResult({ code: 1, stdout: JSON.stringify(drifted) }, { compare: false }).error);

  const inconclusive = { drift: { inconclusive: true } };
  assert.ok(parseDembrandtResult({ code: 1, stdout: JSON.stringify(inconclusive) }, { compare: true }).extract);

  assert.ok(parseDembrandtResult({ code: 1, stdout: JSON.stringify({ colors: [] }) }, { compare: true }).error);
  assert.ok(parseDembrandtResult({ code: 0, stdout: JSON.stringify({ colors: [] }) }, { compare: true }).error);
  assert.ok(parseDembrandtResult({ code: 2, stdout: JSON.stringify(drifted) }, { compare: true }).error);
  const exit2 = JSON.stringify({ drift: { inconclusive: true } });
  assert.deepEqual(parseDembrandtResult({ code: 2, stdout: exit2 }, { compare: true }).extract, inconclusive);
  assert.ok(parseDembrandtResult({ code: 2, stdout: exit2 }, { compare: false }).error);
  assert.ok(parseDembrandtResult({ code: 2, stdout: JSON.stringify({ colors: [] }) }, { compare: true }).error);
  assert.deepEqual(classifyRoute({ route: '/', drift: { inconclusive: true, warnings: ['w'] } }).warnings, ['w']);
});

test('parseDembrandtResult rejects non-JSON and non-object payloads', () => {
  assert.match(parseDembrandtResult({ code: 1, stdout: 'boom', stderr: 'bad\nworse' }).error, /without JSON output: bad worse/);
  assert.ok(parseDembrandtResult({ code: 0, stdout: '[]' }).error);
  assert.ok(parseDembrandtResult({ code: 0, stdout: 'null' }).error);
});

test('dembrandtEnv blanks DEMBRANDT_KEY so an operator key never syncs a checked page', () => {
  const env = dembrandtEnv('http://127.0.0.1:9222');
  assert.equal(env.DEMBRANDT_KEY, '');
  assert.equal(env.BROWSER_CDP_ENDPOINT, 'http://127.0.0.1:9222');
  // Spread over an inherited environment, the blank value must win.
  const merged = { ...{ DEMBRANDT_KEY: 'operator-secret' }, ...env };
  assert.equal(merged.DEMBRANDT_KEY, '');
});

test('a null, empty or boolean drift score is never a pass', () => {
  for (const score of [null, '', '  ', false, undefined]) {
    assert.ok(Number.isNaN(toScore(score)), String(score));
    assert.ok(parseDembrandtResult({ code: 0, stdout: JSON.stringify({ drift: { score } }) }, { compare: true }).error, String(score));
    assert.equal(evaluateDrift([{ route: '/', drift: report(score) }]).ok, false, String(score));
  }
  assert.equal(toScore(0), 0);
  assert.equal(toScore('12'), 12);
});

test('an empty or blank --threshold is rejected, a number is kept', () => {
  for (const value of ['', '   ', undefined, null]) assert.ok(Number.isNaN(parseThreshold(value)), String(value));
  assert.equal(parseThreshold('10'), 10);
  assert.equal(parseThreshold(' 0 '), 0);
  assert.throws(() => evaluateDrift([], parseThreshold('')));
});

test('armTimeout stops a hung child once, and clear() disarms it', async () => {
  const stopped = [];
  const hung = armTimeout('child', 5, (child) => stopped.push(child));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(stopped, ['child']);
  assert.equal(hung.expired(), true);

  const quick = armTimeout('child', 5, (child) => stopped.push(child));
  quick.clear();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(stopped.length, 1);
  assert.equal(quick.expired(), false);

  assert.equal(armTimeout('child', 0, () => stopped.push('x')).expired(), false);
});

// kill(pid, 0) also succeeds for a defunct process that PID 1 has not reaped (some containers),
// so a zombie must not count as running.
async function isRunning(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try {
    const { readFile } = await import('node:fs/promises');
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return true;
  }
}

test('killProcessGroup stops a hung descendant, not just the child (POSIX)', { skip: process.platform === 'win32' }, async () => {
  const { spawn } = await import('node:child_process');
  // The child spawns a grandchild that ignores nothing but outlives a child-only kill.
  const child = spawn(process.execPath, ['-e', "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log('up');setInterval(()=>{},1000)"], {
    detached: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const closed = new Promise((resolve) => child.once('close', resolve));
  killProcessGroup(child, { graceMs: 1000 });
  const winner = await Promise.race([closed.then(() => 'closed'), new Promise((resolve) => setTimeout(() => resolve('hung'), 4000))]);
  assert.equal(winner, 'closed', 'close fires only once the whole group is gone');
});

test('run() with a timeout resolves and reaps a hung grandchild, like npx over Dembrandt (POSIX)', { skip: process.platform === 'win32' }, async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'dd-run-'));
  const pidFile = join(dir, 'grandchild.pid');
  // Parent (npx stand-in) spawns a grandchild (Dembrandt stand-in) that shares the captured pipes and hangs.
  const grandchild = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
  const parent = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' }); setInterval(() => {}, 1000)`;
  let grandchildPid;
  try {
    const started = Date.now();
    const result = await Promise.race([
      run(process.execPath, ['-e', parent], { capture: true, timeoutMs: 700 }),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 8000)),
    ]);
    assert.notEqual(result, 'hung', 'run() must resolve instead of waiting on the grandchild');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /timed out after 0\.7s/);
    assert.ok(Date.now() - started < 6000);
    grandchildPid = Number(readFileSync(pidFile, 'utf8'));
    for (let waited = 0; (await isRunning(grandchildPid)) && waited < 4000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await isRunning(grandchildPid), false, 'the grandchild is gone');
  } finally {
    if (grandchildPid && (await isRunning(grandchildPid))) process.kill(grandchildPid, 'SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancelling the launcher (SIGINT) stops a timed run\'s detached process group (POSIX)', { skip: process.platform === 'win32' }, async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, readFileSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'dd-sigint-'));
  const pidFile = join(dir, 'grandchild.pid');
  const grandchild = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
  const parent = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' }); setInterval(() => {}, 1000)`;
  const runUrl = pathToFileURL(new URL('../scripts/lib/run-process.mjs', import.meta.url).pathname).href;
  // A stand-in launcher: starts a long timed run, so cancelling it is the only way the tree can stop.
  const launcher = `import(${JSON.stringify(runUrl)}).then(({ run }) => { run(process.execPath, ['-e', ${JSON.stringify(parent)}], { capture: true, timeoutMs: 600000 }); console.log('ready'); });`;
  const launcherProc = spawn(process.execPath, ['-e', launcher], { stdio: ['ignore', 'pipe', 'inherit'] });
  let grandchildPid;
  try {
    await new Promise((resolve) => launcherProc.stdout.once('data', resolve));
    for (let waited = 0; !existsSync(pidFile) && waited < 5000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    grandchildPid = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(await isRunning(grandchildPid), true, 'the grandchild started');
    const exited = new Promise((resolve) => launcherProc.once('exit', (code, signal) => resolve({ code, signal })));
    launcherProc.kill('SIGINT'); // the launcher only, as a Ctrl-C to a detached child would behave
    const result = await exited;
    assert.equal(result.code, 130);
    for (let waited = 0; (await isRunning(grandchildPid)) && waited < 5000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await isRunning(grandchildPid), false, 'the detached group was stopped on cancel');
  } finally {
    if (grandchildPid && (await isRunning(grandchildPid))) process.kill(grandchildPid, 'SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
