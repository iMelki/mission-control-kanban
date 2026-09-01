/**
 * Repeated cockpit loads against a production side-serve (never :3021).
 * Records whether each load presents the 2026-08-31 false pre-data copy
 * as settled fact.
 *
 *   MCK_BASE_URL=http://127.0.0.1:3122 node scripts/reproduce-stuck-cockpit-load.mjs
 */
import { chromium } from 'playwright';
import {
  prepareProductionCaptureTarget,
  exitIfCaptureTargetUnscoreable,
} from './assert-production-capture-target.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const captureTarget = exitIfCaptureTargetUnscoreable(
  await prepareProductionCaptureTarget({ repoRoot: process.cwd() }),
);
const base = (process.env.MCK_BASE_URL || captureTarget.href).replace(/\/$/, '');
const route = process.env.MCK_REPRO_ROUTE || '/workspace/assistants';
const loads = Number(process.env.MCK_REPRO_LOADS || 13);
const waitMs = Number(process.env.MCK_REPRO_WAIT_MS || 12000);

const FALSE_SETTLED = [
  'No token detected',
  'Needs GH_GENERAL_TOKEN',
  'Showing 0/0',
  'No events yet',
];

const browser = await chromium.launch({ headless: true });
const results = [];

for (let i = 1; i <= loads; i += 1) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const started = Date.now();
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(waitMs);
  const snapshot = await page.evaluate(() => ({
    textLength: (document.body.innerText || '').length,
    bodyText: document.body.innerText || '',
    workspaceReady: document.documentElement.querySelector('[data-workspace-ready]')?.getAttribute('data-workspace-ready') ?? null,
    cockpitLoad: document.documentElement.querySelector('[data-cockpit-load]')?.getAttribute('data-cockpit-load') ?? null,
    readinessPhase: document.documentElement.querySelector('[data-readiness-phase]')?.getAttribute('data-readiness-phase') ?? null,
    connectionPhase: document.documentElement.querySelector('[data-connection-phase]')?.getAttribute('data-connection-phase') ?? null,
  }));
  const hits = FALSE_SETTLED.filter((needle) => snapshot.bodyText.includes(needle));
  const row = {
    load: i,
    wallMs: Date.now() - started,
    textLength: snapshot.textLength,
    workspaceReady: snapshot.workspaceReady,
    cockpitLoad: snapshot.cockpitLoad,
    readinessPhase: snapshot.readinessPhase,
    connectionPhase: snapshot.connectionPhase,
    falseSettledHits: hits,
    stuck: hits.length > 0 && snapshot.textLength < 4000,
  };
  results.push(row);
  console.log(JSON.stringify(row));
  await page.close();
}

await browser.close();

const stuck = results.filter((row) => row.stuck);
const summary = {
  base,
  route,
  loads,
  waitMs,
  stuckCount: stuck.length,
  stuckLoads: stuck.map((row) => row.load),
  textLengths: results.map((row) => row.textLength),
};
console.log(JSON.stringify({ summary }, null, 2));
process.exit(stuck.length > 0 ? 2 : 0);
