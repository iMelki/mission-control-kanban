/**
 * Measures element-level clipping on every surface docs/captured-surfaces.json marks
 * `capture: "required"`, at every viewport the manifest declares.
 *
 * Read-only against the app: it navigates and measures, and never mutates the app or
 * the repo. Screenshots and the JSON record land in `artifacts/` (gitignored).
 *
 * Why this does NOT read document scroll (#144)
 * ---------------------------------------------
 * src/app/globals.css sets `html, body { max-width: 100vw; overflow-x: hidden }`. That
 * clamp means a page whose content is far wider than the viewport still reports
 * `documentElement.scrollWidth === clientWidth` and `body.scrollWidth === clientWidth`.
 * A reflow probe built on document scroll is defeated by construction and returns a
 * clean result for a broken page. This probe measures ELEMENT-level clipping instead,
 * and reports the document numbers only as evidence that they are useless.
 *
 * Self-proof
 * ----------
 * Before measuring anything real it injects a known-overflowing element into a control
 * route and requires the count to move. A live probe flips clipped 0 -> >=1 while the
 * document overflow stays 0. If the injection does not move the number the probe is
 * dead, every downstream zero is meaningless, and this exits 2 rather than reporting
 * a reassuring row of zeroes.
 *
 * Usage:
 *   npm run surfaces:probe                       # against MCK_BASE_URL or :3021
 *   node scripts/probe-surface-clipping.mjs <outDir>
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const base = process.env.MCK_BASE_URL || 'http://127.0.0.1:3021';
const outDir = path.resolve(process.argv[2] || path.join(repoRoot, 'artifacts', 'surface-captures'));

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'captured-surfaces.json'), 'utf8'));
const viewports = manifest.viewports.map((viewport) => ({
  w: viewport.width,
  h: viewport.height,
  label: viewport.label,
}));
// Drive the route list from the manifest so the probe can never drift from the gate.
const routes = manifest.surfaces
  .filter((surface) => surface.capture === 'required')
  .map((surface) => ({ url: surface.route, name: surface.route === '/' ? 'home' : surface.route.replace(/^\//, '').replace(/\//g, '-') }));
// `/` is the control: any non-zero here means the probe or the app moved.
const control = routes.find((route) => route.url === '/') || routes[0];

fs.mkdirSync(outDir, { recursive: true });

/** Runs in the page. Classifies overflow so intentional scrollers and truncation are not counted. */
function describe() {
  const de = document.documentElement;
  const clipped = [];
  const scrollers = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const clsStr = typeof el.className === 'string' ? el.className : '';
    if (clsStr.split(/\s+/).includes('sr-only')) continue;

    if (el.clientWidth <= 0) {
      // A zero-width content box that still holds content: the content is unreachable.
      if (el.scrollWidth > 1) {
        clipped.push({
          tag: el.tagName.toLowerCase(),
          cls: clsStr.slice(0, 110),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowPx: el.scrollWidth,
          parentClientWidth: el.parentElement ? el.parentElement.clientWidth : null,
          text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
          reason: 'zero-width box with content',
        });
      }
      continue;
    }
    const over = el.scrollWidth - el.clientWidth;
    if (over <= 1) continue;
    const isScroller = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    const truncates =
      cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' || clsStr.includes('line-clamp');
    const row = {
      tag: el.tagName.toLowerCase(),
      cls: clsStr.slice(0, 110),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowPx: over,
      overflowX: cs.overflowX,
      parentClientWidth: el.parentElement ? el.parentElement.clientWidth : null,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    };
    if (isScroller) scrollers.push(row);
    else if (!truncates) clipped.push({ ...row, reason: 'content wider than box, no scroll or ellipsis' });
  }
  clipped.sort((a, b) => b.overflowPx - a.overflowPx);
  scrollers.sort((a, b) => b.overflowPx - a.overflowPx);

  return {
    viewportPx: window.innerWidth,
    // Reported to demonstrate the clamp. Never used to decide pass/fail.
    docScrollWidth: de.scrollWidth,
    docClientWidth: de.clientWidth,
    docHorizontalOverflowPx: de.scrollWidth - de.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyHorizontalOverflowPx: document.body.scrollWidth - document.body.clientWidth,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    bodyMaxWidth: getComputedStyle(document.body).maxWidth,
    clippedCount: clipped.length,
    worstClipped: clipped.slice(0, 20),
    widestScroller: scrollers[0] || null,
  };
}

async function measure(browser, route, vp, opts = {}) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const response = await page.goto(base + route.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);
  try { await page.evaluate(() => document.fonts.ready); } catch { /* fonts API unavailable */ }
  if (opts.inject) {
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = '__overflow_probe__';
      probe.textContent = 'x'.repeat(400);
      probe.setAttribute('style', 'width:1200px;white-space:nowrap;overflow:visible;');
      document.body.appendChild(probe);
    });
    await page.waitForTimeout(250);
  }
  const data = await page.evaluate(describe);
  if (opts.screenshot) {
    await page.screenshot({ path: path.join(outDir, `${route.name}-${vp.label}.png`), fullPage: false });
  }
  await page.close();
  return { ...data, route: route.name, url: route.url, status: response ? response.status() : null, viewport: vp.label, pageErrors };
}

const browser = await chromium.launch({ headless: true });
const smallest = viewports.reduce((a, b) => (a.w <= b.w ? a : b));

// ---- 1. Self-proof. ----
const baseline = await measure(browser, control, smallest);
const injected = await measure(browser, control, smallest, { inject: true });
const proof = {
  kind: 'self-proof',
  route: control.url,
  viewportPx: smallest.w,
  baseline: { clippedCount: baseline.clippedCount, docOverflowPx: baseline.docHorizontalOverflowPx },
  injected: { clippedCount: injected.clippedCount, docOverflowPx: injected.docHorizontalOverflowPx },
  probeDetectedInjection: injected.clippedCount > baseline.clippedCount,
  documentScrollProbeDefeated:
    injected.docHorizontalOverflowPx === 0 && injected.clippedCount > baseline.clippedCount,
};
console.log(`=== SELF-PROOF (control ${control.url} @ ${smallest.w}px) ===`);
console.log(`  baseline:                  clipped=${proof.baseline.clippedCount} docOverflow=${proof.baseline.docOverflowPx}px`);
console.log(`  after injecting a 1200px element: clipped=${proof.injected.clippedCount} docOverflow=${proof.injected.docOverflowPx}px`);
console.log(`  probe detected the injection: ${proof.probeDetectedInjection}`);
console.log(`  document-scroll probe defeated by the globals.css clamp: ${proof.documentScrollProbeDefeated}`);
if (!proof.probeDetectedInjection) {
  console.error('  PROBE IS DEAD: it did not see a 1200px element in a phone viewport. Refusing to report zeroes.');
  await browser.close();
  process.exit(2);
}

// ---- 2. Measure every required surface. ----
const results = [];
for (const route of routes) {
  for (const vp of viewports) results.push(await measure(browser, route, vp, { screenshot: true }));
}
await browser.close();

const capturedAt = {
  commit: process.env.MCK_CAPTURE_COMMIT || '(set MCK_CAPTURE_COMMIT to the 40-hex sha you measured)',
  date: new Date().toISOString().slice(0, 10),
  viewports: viewports.map((vp) => vp.label),
  method: 'scripts/probe-surface-clipping.mjs (element-level clipping; document scroll is clamped by globals.css)',
};
fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify({ base, capturedAt, proof, results }, null, 2));

console.log('\n=== MEASUREMENTS ===');
let dirty = 0;
for (const r of results) {
  const flag = r.clippedCount > 0 ? 'CLIPPED' : 'clean   ';
  if (r.clippedCount > 0) dirty += 1;
  console.log(`\n--- [${flag}] ${r.url} @ ${r.viewport} ${r.viewportPx}px  HTTP ${r.status} ---`);
  console.log(`  clippedElements=${r.clippedCount}`);
  console.log(`  doc  sw=${r.docScrollWidth} cw=${r.docClientWidth} -> ${r.docHorizontalOverflowPx}px (clamped by max-width:${r.bodyMaxWidth}, overflow-x:${r.bodyOverflowX})`);
  console.log(`  body sw=${r.bodyScrollWidth} cw=${r.bodyClientWidth} -> ${r.bodyHorizontalOverflowPx}px`);
  for (const c of r.worstClipped.slice(0, 6)) {
    console.log(`   CLIP <${c.tag}> sw=${c.scrollWidth} cw=${c.clientWidth} pcw=${c.parentClientWidth} :: ${c.cls} :: "${c.text}"`);
  }
  if (r.pageErrors.length) console.log(`  pageErrors=${JSON.stringify(r.pageErrors)}`);
}
console.log(`\n${results.length} measurement(s), ${dirty} with clipping. Record in docs/captured-surfaces.json as:`);
console.log(JSON.stringify({ capturedAt }, null, 2));
console.log(`Artifacts: ${outDir}`);
