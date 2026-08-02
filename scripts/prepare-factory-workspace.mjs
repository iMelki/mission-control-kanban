import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = resolve(repositoryRoot, 'integrations', 'paperclip-bridge');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const processExecutable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : npmExecutable;
const markerPath = resolve(repositoryRoot, 'node_modules', '.paperclip-factory-workspace.json');
const lockPath = resolve(repositoryRoot, 'node_modules', '.paperclip-factory-workspace.lock');

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function expectedMarker() {
  return {
    schemaVersion: 'mission-control-kanban.paperclip-workspace-ready.v1',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    rootLockSha256: sha256File(resolve(repositoryRoot, 'package-lock.json')),
    pluginLockSha256: sha256File(resolve(pluginRoot, 'package-lock.json')),
  };
}

function hasReadyDependencies() {
  return existsSync(resolve(repositoryRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'))
    && existsSync(resolve(repositoryRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))
    && existsSync(resolve(pluginRoot, 'node_modules', '@paperclipai', 'plugin-sdk'))
    && existsSync(resolve(pluginRoot, 'node_modules', '@paperclipai', 'shared'));
}

function isReady(marker) {
  if (!hasReadyDependencies()) return false;
  try {
    const actual = JSON.parse(readFileSync(marker, 'utf8'));
    const expected = expectedMarker();
    return Object.entries(expected).every(([key, value]) => actual[key] === value);
  } catch {
    return false;
  }
}

function sleep(milliseconds) {
  const atomics = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(atomics, 0, 0, milliseconds);
}

function acquireProvisionLock() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (existsSync(markerPath) && isReady(markerPath)) return false;
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      sleep(5000);
    }
  }
  throw new Error('Timed out waiting for another Paperclip workspace provisioner.');
}

function runNpm(args, cwd) {
  const processArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', npmExecutable, ...args]
    : args;
  const result = spawnSync(processExecutable, processArgs, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Paperclip execution workspaces are intentionally disposable. Install from
// each checked-in lockfile before running validation, and keep lifecycle
// scripts disabled. better-sqlite3 is rebuilt explicitly because the host
// binary must match the current Node/OS runtime after a clean install.
if (existsSync(markerPath) && isReady(markerPath)) {
  console.log('Paperclip factory workspace dependencies already match the lockfile/runtime marker; skipping reinstall.');
  process.exit(0);
}

const ownsProvisionLock = acquireProvisionLock();
if (!ownsProvisionLock) {
  console.log('Another Paperclip factory provisioner completed the matching lockfile/runtime setup; reusing it.');
  process.exit(0);
}

const installArgs = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
try {
  runNpm(installArgs, repositoryRoot);
  runNpm(['rebuild', 'better-sqlite3', '--no-audit', '--no-fund'], repositoryRoot);
  runNpm(installArgs, pluginRoot);
  writeFileSync(markerPath, `${JSON.stringify(expectedMarker(), null, 2)}\n`, { encoding: 'utf8' });
} finally {
  if (existsSync(lockPath)) unlinkSync(lockPath);
}
