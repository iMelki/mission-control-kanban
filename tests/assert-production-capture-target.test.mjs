import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  classifyCaptureTarget,
  prepareProductionCaptureTarget,
  resolveBuildIdFromEnv,
  SUPERVISED_DEV_PORT,
  EXIT_REFUSED,
} from '../scripts/assert-production-capture-target.mjs';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const CLI = path.join(repoRoot, 'scripts', 'assert-production-capture-target.mjs');

const PROD_HTML =
  '<html><script src="/_next/static/LhwzqpkXyePprPbNMSBmo/chunks/app.js"></script></html>';
const DEV_HTML =
  '<html><script src="/_next/static/chunks/react-refresh.js"></script>' +
  '<nextjs-portal></nextjs-portal></html>';

function classify(overrides = {}) {
  return classifyCaptureTarget({
    baseUrl: 'http://127.0.0.1:3121',
    buildId: 'LhwzqpkXyePprPbNMSBmo',
    html: PROD_HTML,
    ...overrides,
  });
}

test('missing MCK_BASE_URL is refused without a fetch', () => {
  const result = classifyCaptureTarget({});
  assert.equal(result.ok, false);
  assert.equal(result.scoreable, false);
  assert.equal(result.code, 'base_url_required');
  assert.equal(result.fetched, false);
  assert.match(result.detail, /3021/);
});

test('supervised 3021 is refused even when a leftover BUILD_ID is present', () => {
  const result = classify({
    baseUrl: 'http://127.0.0.1:3021',
    buildId: 'LhwzqpkXyePprPbNMSBmo',
    html: PROD_HTML,
    allowDevCapture: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.scoreable, false);
  assert.equal(result.serverMode, 'next-dev');
  assert.equal(result.code, 'supervised_next_dev');
  assert.equal(result.fetched, false);
  assert.equal(result.allowDevCaptureIgnored, true);
  assert.equal(result.buildId, 'LhwzqpkXyePprPbNMSBmo');
  assert.match(result.detail, new RegExp(String(SUPERVISED_DEV_PORT)));
});

test('localhost:3021 is the same supervised listener', () => {
  const result = classify({ baseUrl: 'http://localhost:3021/', html: undefined });
  assert.equal(result.code, 'supervised_next_dev');
  assert.equal(result.fetched, false);
});

test('next-dev HTML on a capture port is refused; leftover BUILD_ID is not provenance', () => {
  const result = classify({ html: DEV_HTML });
  assert.equal(result.ok, false);
  assert.equal(result.scoreable, false);
  assert.equal(result.serverMode, 'next-dev');
  assert.equal(result.code, 'next_dev_html');
  assert.ok(result.markers.includes('nextjs-portal'));
});

test('a capture port without BUILD_ID is refused', () => {
  const result = classify({ buildId: '', html: '<html>no next assets</html>' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'build_id_required');
  assert.equal(result.scoreable, false);
});

test('production HTML plus BUILD_ID on a non-supervised port is scoreable', () => {
  const result = classify();
  assert.equal(result.ok, true);
  assert.equal(result.scoreable, true);
  assert.equal(result.serverMode, 'production');
  assert.equal(result.code, 'production_ok');
  assert.equal(result.buildId, 'LhwzqpkXyePprPbNMSBmo');
});

test('HTML BUILD_ID must match the declared BUILD_ID', () => {
  const result = classify({ buildId: 'OtherBuildId99' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'build_id_mismatch');
});

test('resolveBuildIdFromEnv prefers MCK_BUILD_ID over a leftover file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mck-buildid-'));
  try {
    mkdirSync(path.join(dir, '.next'));
    writeFileSync(path.join(dir, '.next', 'BUILD_ID'), 'FileBuildId99\n');
    assert.equal(
      resolveBuildIdFromEnv({ env: { MCK_BUILD_ID: 'EnvBuildId99' }, repoRoot: dir }),
      'EnvBuildId99'
    );
    assert.equal(resolveBuildIdFromEnv({ env: {}, repoRoot: dir }), 'FileBuildId99');
    assert.equal(
      resolveBuildIdFromEnv({
        env: { MCK_NEXT_DIR: path.join(dir, '.next') },
        repoRoot: path.join(dir, 'other'),
      }),
      'FileBuildId99'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare never fetches 3021 — the compile that kills the watchdog must not start', async () => {
  let fetched = false;
  const result = await prepareProductionCaptureTarget({
    env: { MCK_BASE_URL: 'http://127.0.0.1:3021', MCK_BUILD_ID: 'LhwzqpkXyePprPbNMSBmo' },
    fetchHtml: async () => {
      fetched = true;
      throw new Error('fetch must not run against 3021');
    },
  });
  assert.equal(fetched, false, 'BREAK: a 3021 prepare must not GET /');
  assert.equal(result.code, 'supervised_next_dev');
  assert.equal(result.fetched, false);
  assert.equal(result.scoreable, false);
});

test('prepare fetches a capture port and refuses next-dev HTML', async () => {
  const result = await prepareProductionCaptureTarget({
    env: { MCK_BASE_URL: 'http://127.0.0.1:3121', MCK_BUILD_ID: 'LhwzqpkXyePprPbNMSBmo' },
    fetchHtml: async () => ({ ok: true, status: 200, html: DEV_HTML }),
  });
  assert.equal(result.fetched, true);
  assert.equal(result.code, 'next_dev_html');
  assert.equal(result.scoreable, false);
});

test('prepare accepts a reachable production target', async () => {
  const result = await prepareProductionCaptureTarget({
    env: { MCK_BASE_URL: 'http://127.0.0.1:3121', MCK_BUILD_ID: 'LhwzqpkXyePprPbNMSBmo' },
    fetchHtml: async () => ({ ok: true, status: 200, html: PROD_HTML }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.scoreable, true);
  assert.equal(result.code, 'production_ok');
  assert.equal(result.fetched, true);
  assert.equal(result.httpStatus, 200);
});

test('CLI as the probes invoke it: unset URL exits 2 for base_url_required', () => {
  const run = spawnSync(process.execPath, [CLI, '--json'], {
    cwd: repoRoot,
    env: { ...process.env, MCK_BASE_URL: '', MCK_BUILD_ID: '', MCK_NEXT_DIR: '' },
    encoding: 'utf8',
  });
  assert.equal(run.status, EXIT_REFUSED);
  const payload = JSON.parse(run.stdout.trim());
  assert.equal(payload.code, 'base_url_required');
  assert.equal(payload.scoreable, false);
});

test('CLI as the probes invoke it: 3021 exits 2 without needing a live server', () => {
  const run = spawnSync(process.execPath, [CLI, '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MCK_BASE_URL: 'http://127.0.0.1:3021',
      MCK_BUILD_ID: 'LhwzqpkXyePprPbNMSBmo',
    },
    encoding: 'utf8',
  });
  assert.equal(run.status, EXIT_REFUSED);
  const payload = JSON.parse(run.stdout.trim());
  assert.equal(payload.code, 'supervised_next_dev');
  assert.equal(payload.fetched, false);
});
