// Wave 2 leftover contrast measure for mck#151.
// Reads computed styles on a production capture host. Does not touch :3021.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const BASE = process.env.MCK_BASE_URL;
if (!BASE) {
  console.error('MCK_BASE_URL required');
  process.exit(2);
}
if (/:(3021)(?:\/|$)/.test(BASE)) {
  console.error('refusing supervised 3021');
  process.exit(2);
}

const ANALYSE_EL = `((el) => {
  if (!el) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  const resolveColor = (s) => {
    const m = /^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)$/.exec(s);
    if (m) return { ok: true, rgba: [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] };
    cx.fillStyle = '#010203'; cx.fillRect(0, 0, 1, 1);
    cx.fillStyle = s; cx.fillRect(0, 0, 1, 1);
    const a = cx.getImageData(0, 0, 1, 1).data;
    return { ok: true, rgba: [a[0], a[1], a[2], a[3] / 255] };
  };
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg, bg) => {
    const l1 = lum(fg), l2 = lum(bg);
    return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
  };
  const composite = (top, bot) => {
    const a = top[3];
    return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1];
  };
  const effectiveBg = (node) => {
    const stack = [];
    let cur = node;
    while (cur) {
      const c = resolveColor(getComputedStyle(cur).backgroundColor);
      if (c.ok && c.rgba[3] > 0) stack.push(c.rgba);
      if (c.ok && c.rgba[3] >= 0.99) break;
      cur = cur.parentElement;
    }
    if (stack.length === 0) return [13, 17, 23, 1];
    let bg = stack[stack.length - 1];
    for (let i = stack.length - 2; i >= 0; i--) bg = composite(stack[i], bg);
    return bg;
  };
  const cs = getComputedStyle(el);
  const fg = resolveColor(cs.color);
  const bg = effectiveBg(el);
  let fgc = fg.rgba;
  if (fgc[3] < 0.99) fgc = composite(fgc, bg);
  return {
    text: (el.innerText || '').trim().slice(0, 80),
    cls: String(el.className).slice(0, 160),
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    fontSize: cs.fontSize,
    ratio: ratio(fgc, bg),
  };
})`;

const label = process.env.MCK_MEASURE_LABEL || 'before';
const results = {
  probe: 'wave2-leftover-contrast',
  label,
  base: BASE,
  startedAt: new Date().toISOString(),
};

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/workspace/assistants', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  results.n8n = await page.evaluate((fnSrc) => {
    const fn = eval(fnSrc);
    const el = [...document.querySelectorAll('div, span')].find((n) => /n8n sync:/i.test(n.textContent || '') && (n.textContent || '').length < 240);
    return fn(el || null);
  }, ANALYSE_EL);

  results.offlineLive = await page.evaluate((fnSrc) => {
    const fn = eval(fnSrc);
    const el = document.querySelector('[data-connection-phase]');
    return el ? { phase: el.getAttribute('data-connection-phase'), ...fn(el) } : null;
  }, ANALYSE_EL);

  results.offlineFixture = await page.evaluate((fnSrc) => {
    const fn = eval(fnSrc);
    const host = document.createElement('div');
    host.style.cssText = 'position:static';
    host.className = 'bg-mc-bg-secondary';
    const badge = document.createElement('div');
    badge.className = 'flex items-center gap-2 px-3 py-1 rounded border text-sm font-medium bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red';
    badge.textContent = 'OFFLINE';
    host.appendChild(badge);
    document.body.appendChild(host);
    const measured = fn(badge);
    host.remove();
    return measured;
  }, ANALYSE_EL);

  results.offlineFixedFixture = await page.evaluate((fnSrc) => {
    const fn = eval(fnSrc);
    const host = document.createElement('div');
    host.style.cssText = 'position:static';
    host.className = 'bg-mc-bg-secondary';
    const badge = document.createElement('div');
    badge.className = 'flex items-center gap-2 px-3 py-1 rounded border text-sm font-medium bg-mc-bg border-mc-accent-red text-mc-accent-red';
    badge.textContent = 'OFFLINE';
    host.appendChild(badge);
    document.body.appendChild(host);
    const measured = fn(badge);
    host.remove();
    return measured;
  }, ANALYSE_EL);

  results.n8nSolidFixture = await page.evaluate((fnSrc) => {
    const fn = eval(fnSrc);
    const host = document.createElement('div');
    host.className = 'bg-mc-bg-secondary';
    const line = document.createElement('div');
    line.className = 'flex flex-wrap items-center gap-2 text-mc-text-secondary';
    line.textContent = 'n8n sync: waiting for first scheduled run';
    host.appendChild(line);
    document.body.appendChild(host);
    const measured = fn(line);
    host.remove();
    return measured;
  }, ANALYSE_EL);

  await ctx.close();
} finally {
  await browser.close();
}

results.finishedAt = new Date().toISOString();
const outPath = path.join(OUT, `wave2-leftover-contrast-${label}.json`);
fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({
  n8n: results.n8n,
  offlineLive: results.offlineLive,
  offlineFixture: results.offlineFixture,
  offlineFixedFixture: results.offlineFixedFixture,
  n8nSolidFixture: results.n8nSolidFixture,
  outPath,
}, null, 2));
