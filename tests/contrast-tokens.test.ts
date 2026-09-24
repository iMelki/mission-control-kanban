/**
 * mck#151 — muted timestamp class must clear WCAG AA 4.5:1 on the real
 * composited cockpit backgrounds. The 2.87:1 failure was `text-mc-text-secondary/60`
 * (alpha 0.6 of #8b949e over #161b22).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  compositeOver,
  contrastRatioRounded,
  parseHexColor,
} from '../src/lib/contrast';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

const TOKENS = {
  textSecondary: '#8b949e',
  textMuted: '#8b949e',
  accentRed: '#f85149',
  bg: '#0d1117',
  bgSecondary: '#161b22',
  bgTertiary: '#21262d',
} as const;

test('the old /60 composite is the 2.87:1 fixture this gate refuses', () => {
  const fg = parseHexColor(TOKENS.textSecondary);
  const bg = parseHexColor(TOKENS.bgSecondary);
  const composited = compositeOver(fg, 0.6, bg);
  assert.deepEqual([...composited], [92, 100, 108]);
  const ratio = contrastRatioRounded(composited, bg);
  assert.ok(Math.abs(ratio - 2.87) < 0.02, `old pair should be ~2.87:1, got ${ratio}`);
  assert.ok(ratio < 4.5, 'old /60 pair must stay a failing fixture or the detector is dead');
});

test('muted timestamp token is >=4.5:1 on every real card/column backdrop', () => {
  const muted = parseHexColor(TOKENS.textMuted);
  const backgrounds = [
    ['mc-bg', TOKENS.bg],
    ['mc-bg-secondary (task card)', TOKENS.bgSecondary],
    ['mc-bg-tertiary', TOKENS.bgTertiary],
  ] as const;

  for (const [name, hex] of backgrounds) {
    const ratio = contrastRatioRounded(muted, parseHexColor(hex));
    assert.ok(
      ratio >= 4.5,
      `${name} ${hex} against muted ${TOKENS.textMuted} is ${ratio}:1, need >=4.5`,
    );
  }
});

test('token files pin mc-text-muted to the proven solid color', () => {
  const css = readFileSync(path.join(repoRoot, 'src', 'app', 'globals.css'), 'utf8');
  const tailwind = readFileSync(path.join(repoRoot, 'tailwind.config.ts'), 'utf8');
  assert.match(css, /--mc-text-muted:\s*#8b949e/);
  assert.match(tailwind, /'mc-text-muted':\s*'#8b949e'/);
});

test('src no longer uses the failing text-mc-text-secondary/60 timestamp class', () => {
  const queue = readFileSync(
    path.join(repoRoot, 'src', 'components', 'MissionQueue.tsx'),
    'utf8',
  );
  assert.doesNotMatch(queue, /text-mc-text-secondary\/60/);
  assert.match(queue, /text-mc-text-muted/);
});

test('the old n8n /70 composite is the 3.43:1 fixture this gate refuses', () => {
  const fg = parseHexColor(TOKENS.textSecondary);
  const bg = parseHexColor(TOKENS.bgSecondary);
  const composited = compositeOver(fg, 0.7, bg);
  const ratio = contrastRatioRounded(composited, bg);
  assert.ok(Math.abs(ratio - 3.45) < 0.05, `old n8n pair should be ~3.43-3.45:1, got ${ratio}`);
  assert.ok(ratio < 4.5, 'old /70 pair must stay a failing fixture or the detector is dead');
});

test('solid n8n secondary token is >=4.5:1 on card and column backdrops', () => {
  const fg = parseHexColor(TOKENS.textSecondary);
  for (const [name, hex] of [
    ['mc-bg', TOKENS.bg],
    ['mc-bg-secondary', TOKENS.bgSecondary],
    ['mc-bg-tertiary', TOKENS.bgTertiary],
  ] as const) {
    const ratio = contrastRatioRounded(fg, parseHexColor(hex));
    assert.ok(ratio >= 4.5, `${name} against solid secondary is ${ratio}:1`);
  }
});

test('the old OFFLINE /20 fill is the 4.04:1 fixture this gate refuses', () => {
  const red = parseHexColor(TOKENS.accentRed);
  const header = parseHexColor(TOKENS.bgSecondary);
  const fill = compositeOver(red, 0.2, header);
  const ratio = contrastRatioRounded(red, fill);
  assert.ok(Math.abs(ratio - 4.04) < 0.02, `old OFFLINE pair should be ~4.04:1, got ${ratio}`);
  assert.ok(ratio < 4.5, 'old /20 fill must stay a failing fixture or the detector is dead');
});

test('OFFLINE red on mc-bg is >=4.5:1', () => {
  const ratio = contrastRatioRounded(parseHexColor(TOKENS.accentRed), parseHexColor(TOKENS.bg));
  assert.ok(ratio >= 4.5, `OFFLINE red on mc-bg is ${ratio}:1`);
});

test('src no longer uses the leftover n8n /70 or OFFLINE /20 pairs', () => {
  const page = readFileSync(
    path.join(repoRoot, 'src', 'app', 'workspace', '[slug]', 'page.tsx'),
    'utf8',
  );
  const header = readFileSync(
    path.join(repoRoot, 'src', 'components', 'Header.tsx'),
    'utf8',
  );
  const css = readFileSync(path.join(repoRoot, 'src', 'app', 'globals.css'), 'utf8');
  assert.doesNotMatch(page, /text-mc-text-secondary\/70/);
  assert.match(page, /text-mc-text-secondary/);
  assert.doesNotMatch(header, /bg-mc-accent-red\/20 border-mc-accent-red text-mc-accent-red/);
  assert.match(header, /bg-mc-bg border-mc-accent-red text-mc-accent-red/);
  assert.match(css, /\.status-offline[^{]*\{[^}]*bg-mc-bg/);
});
