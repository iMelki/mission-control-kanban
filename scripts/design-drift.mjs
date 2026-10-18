#!/usr/bin/env node
/**
 * Design-token drift check: "did this change alter the look?"
 *
 * Runs Dembrandt (pinned, via npx) against a few key routes of a running MCK,
 * compares each route's extracted tokens to the committed baseline in
 * docs/design-drift/baseline/, writes artifacts/design-drift/report.{json,md},
 * and exits 0 stable / 1 drift above the threshold / 2 could not evaluate.
 *
 *   npm run design:drift -- --base-url http://127.0.0.1:3021
 *   npm run design:drift -- --start                 # build + start like Runtime Regression
 *   npm run design:drift -- --start --update-baseline
 *
 * Chromium comes from this repo's own Playwright install (or
 * DESIGN_DRIFT_CHROMIUM_PATH) and is handed to Dembrandt over CDP, so the check
 * never downloads a second browser. See docs/design-drift.md.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_ROUTES,
  DEFAULT_THRESHOLD,
  DEMBRANDT_VERSION,
  evaluateDrift,
  exitCodeFor,
  formatMarkdown,
  routeSlug,
} from './lib/design-drift.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { getRuntimeRegressionServerPlan } = require('./runtime-regression-server.js');

const isWindows = process.platform === 'win32';
const baselineDir = path.resolve('docs/design-drift/baseline');

const { values: args } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    start: { type: 'boolean', default: false },
    'no-build': { type: 'boolean', default: false },
    'update-baseline': { type: 'boolean', default: false },
    threshold: { type: 'string', default: String(DEFAULT_THRESHOLD) },
    routes: { type: 'string', default: DEFAULT_ROUTES.join(',') },
    'report-dir': { type: 'string', default: 'artifacts/design-drift' },
  },
});

const port = Number(process.env.DESIGN_DRIFT_PORT || 3021);
const baseUrl = (args['base-url'] || process.env.MCK_SMOKE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
const threshold = Number(args.threshold);
const routes = args.routes.split(',').map((route) => route.trim()).filter(Boolean);
const reportDir = path.resolve(args['report-dir']);

function spawnCommand(command, commandArgs, options) {
  if (!isWindows) return spawn(command, commandArgs, { shell: false, ...options });
  const shim = command === 'npm' || command === 'npx' ? `${command}.cmd` : command;
  return spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', shim, ...commandArgs], {
    shell: false,
    windowsHide: true,
    ...options,
  });
}

function run(command, commandArgs, { env = {}, capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawnCommand(command, commandArgs, {
      stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (isWindows) {
    spawnSync('C:\\Windows\\System32\\taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

function isPortOpen(host, targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: targetPort });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} was not ready after ${timeoutMs / 1000}s`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port: free } = server.address();
      server.close(() => resolve(free));
    });
  });
}

/** Build and start the production standalone server, exactly like Runtime Regression. */
async function startApp() {
  if (await isPortOpen('127.0.0.1', port)) {
    throw new Error(`--start needs a free port, but ${port} is in use. Use --base-url to check a server that is already running.`);
  }
  const plan = getRuntimeRegressionServerPlan({ port, mode: 'production' });
  if (!args['no-build']) {
    const build = await run(plan.build.command, plan.build.args);
    if (build.code !== 0) throw new Error(`npm run build failed with exit code ${build.code}`);
  }
  for (const asset of plan.assets) {
    if (!existsSync(asset.source)) throw new Error(`Build output is missing: ${asset.source}`);
    rmSync(asset.destination, { recursive: true, force: true });
    cpSync(asset.source, asset.destination, { recursive: true });
  }
  // A throwaway database keeps the rendered content (and so the tokens) independent of local data.
  const dbDir = path.join(reportDir, 'db');
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  const server = spawnCommand(plan.start.command, plan.start.args, {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', DATABASE_PATH: path.join(dbDir, 'design-drift.db'), ...plan.start.env },
  });
  try {
    await waitFor(() => isPortOpen('127.0.0.1', port), 60_000, `MCK on port ${port}`);
  } catch (error) {
    stopProcessTree(server);
    throw error;
  }
  return server;
}

/** Launch Chromium from this repo's Playwright and expose it to Dembrandt over CDP. */
async function launchBrowser() {
  const cdpPort = await freePort();
  const browser = await chromium.launch({
    executablePath: process.env.DESIGN_DRIFT_CHROMIUM_PATH || undefined,
    args: [`--remote-debugging-port=${cdpPort}`, '--no-sandbox'],
  });
  const endpoint = `http://127.0.0.1:${cdpPort}`;
  await waitFor(async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok === true, 15_000, 'Chromium CDP endpoint');
  return { browser, endpoint };
}

async function extractRoute(route, cdpEndpoint, baselineFile) {
  const dembrandtArgs = ['--yes', `dembrandt@${DEMBRANDT_VERSION}`, `${baseUrl}${route}`, '--json-only', '--no-sandbox', '--no-headed-fallback'];
  if (baselineFile) dembrandtArgs.push('--compare', baselineFile);
  const result = await run('npx', dembrandtArgs, {
    capture: true,
    // omit=optional skips Dembrandt's optional 280 MB ML runtime, which only --ai uses.
    env: { BROWSER_CDP_ENDPOINT: cdpEndpoint, DEMBRANDT_NO_HINTS: '1', npm_config_omit: 'optional', NO_COLOR: '1' },
  });
  // Exit 1 is Dembrandt's own drift verdict; we apply our threshold to the score instead.
  try {
    return { extract: JSON.parse(result.stdout) };
  } catch {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ');
    return { error: `dembrandt exited ${result.code} without JSON output: ${detail}` };
  }
}

async function main() {
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`--threshold must be a number >= 0, got ${args.threshold}`);
  mkdirSync(reportDir, { recursive: true });
  let server;
  let browser;
  try {
    if (args.start) server = await startApp();
    else if (!(await fetch(baseUrl).then((response) => response.status < 500).catch(() => false))) {
      throw new Error(`${baseUrl} is not reachable. Start MCK first or pass --start.`);
    }
    const launched = await launchBrowser();
    browser = launched.browser;

    const results = [];
    for (const route of routes) {
      const slug = routeSlug(route);
      const baselineFile = path.join(baselineDir, `${slug}.json`);
      if (args['update-baseline']) {
        const { extract, error } = await extractRoute(route, launched.endpoint, null);
        if (error) throw new Error(`${route}: ${error}`);
        mkdirSync(baselineDir, { recursive: true });
        writeFileSync(baselineFile, `${JSON.stringify(extract, null, 2)}\n`);
        console.log(`baseline written: ${path.relative(process.cwd(), baselineFile)}`);
        continue;
      }
      if (!existsSync(baselineFile)) {
        results.push({ route, baselineMissing: true, error: `no baseline at ${path.relative(process.cwd(), baselineFile)}` });
        continue;
      }
      const { extract, error } = await extractRoute(route, launched.endpoint, baselineFile);
      if (extract) {
        const { drift, ...candidate } = extract;
        writeFileSync(path.join(reportDir, `${slug}.candidate.json`), `${JSON.stringify(candidate, null, 2)}\n`);
        results.push({ route, drift });
      } else {
        results.push({ route, error });
      }
    }
    if (args['update-baseline']) return 0;

    const verdict = evaluateDrift(results, threshold);
    const markdown = formatMarkdown(verdict, { baseUrl });
    writeFileSync(path.join(reportDir, 'report.json'), `${JSON.stringify({ baseUrl, dembrandt: DEMBRANDT_VERSION, ...verdict }, null, 2)}\n`);
    writeFileSync(path.join(reportDir, 'report.md'), markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(markdown);
    return exitCodeFor(verdict);
  } finally {
    await browser?.close().catch(() => {});
    stopProcessTree(server);
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => { console.error(`design:drift: ${error.message}`); process.exitCode = 2; },
);
