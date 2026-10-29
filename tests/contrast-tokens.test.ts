/**
 * mck#151 — muted timestamp class must clear WCAG AA 4.5:1 on the real
 * composited cockpit backgrounds. The 2.87:1 failure was `text-mc-text-secondary/60`
 * (alpha 0.6 of #8b949e over #161b22).
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  compositeOver,
  contrastRatioRounded,
  parseHexColor,
} from '../src/lib/contrast';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

// Current tokens: studio direction B "Evolve" (docs/studio/2026-10-mck-studio/direction.md).
const TOKENS = {
  textSecondary: '#9d9a92',
  textMuted: '#9d9a92',
  accentRed: '#ef6461',
  bg: '#111214',
  bgSecondary: '#18191c',
  bgTertiary: '#202226',
} as const;

// The pre-direction-B palette. The /60, /70 and /20 failure fixtures were
// measured on these hexes; they stay pinned here so each detector keeps a known
// failing pair even though the app no longer ships these colours.
const LEGACY = {
  textSecondary: '#8b949e',
  accentRed: '#f85149',
  bgSecondary: '#161b22',
} as const;

const DIRECTION_B = {
  text: '#e6e4df',
  muted: '#9d9a92',
  accent: '#e6be5a',
  accentInk: '#1a1608',
  success: '#4cb782',
  warn: '#e0823d',
  danger: '#ef6461',
} as const;

test('the old /60 composite is the 2.87:1 fixture this gate refuses', () => {
  const fg = parseHexColor(LEGACY.textSecondary);
  const bg = parseHexColor(LEGACY.bgSecondary);
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
  assert.match(css, /--mc-text-muted:\s*#9d9a92/);
  assert.match(css, /--mc-text-muted-rgb:\s*157 154 146/);
  // Tailwind resolves through the CSS channel triple, so CSS is the one source.
  assert.match(tailwind, /'mc-text-muted':\s*'rgb\(var\(--mc-text-muted-rgb\) \/ <alpha-value>\)'/);
});

test('src no longer uses the failing text-mc-text-secondary/60 timestamp class', () => {
  const card = readFileSync(
    path.join(repoRoot, 'src', 'components', 'board', 'task-card.tsx'),
    'utf8',
  );
  assert.doesNotMatch(card, /text-mc-text-secondary\/60/);
  assert.match(card, /text-mc-text-muted/);
});

test('direction B pairs meet the ratios recorded in direction.md', () => {
  const pairs: Array<[string, string, string, number]> = [
    ['text on bg', DIRECTION_B.text, TOKENS.bg, 14.75],
    ['text on card', DIRECTION_B.text, TOKENS.bgTertiary, 12.54],
    ['muted on bg', DIRECTION_B.muted, TOKENS.bg, 6.67],
    ['muted on card', DIRECTION_B.muted, TOKENS.bgTertiary, 5.67],
    ['accent on bg', DIRECTION_B.accent, TOKENS.bg, 10.6],
    ['success on card', DIRECTION_B.success, TOKENS.bgTertiary, 6.37],
    ['warn on card', DIRECTION_B.warn, TOKENS.bgTertiary, 5.64],
    ['danger on card', DIRECTION_B.danger, TOKENS.bgTertiary, 5.06],
    ['ink on accent', DIRECTION_B.accentInk, DIRECTION_B.accent, 10.22],
  ];
  for (const [name, fg, bg, expected] of pairs) {
    const ratio = contrastRatioRounded(parseHexColor(fg), parseHexColor(bg));
    assert.ok(Math.abs(ratio - expected) < 0.02, `${name}: expected ${expected}:1, got ${ratio}:1`);
    assert.ok(ratio >= 4.5, `${name} must clear 4.5:1, got ${ratio}:1`);
  }
});

test('globals.css carries the direction B hexes verbatim', () => {
  const css = readFileSync(path.join(repoRoot, 'src', 'app', 'globals.css'), 'utf8');
  for (const [token, hex] of [
    ['--mc-bg', TOKENS.bg],
    ['--mc-bg-secondary', TOKENS.bgSecondary],
    ['--mc-bg-tertiary', TOKENS.bgTertiary],
    ['--mc-accent', DIRECTION_B.accent],
    ['--mc-accent-ink', DIRECTION_B.accentInk],
    ['--mc-warn', DIRECTION_B.warn],
    ['--mc-danger', DIRECTION_B.danger],
    ['--mc-success', DIRECTION_B.success],
  ] as const) {
    assert.match(css, new RegExp(`${token}:\\s*${hex}\\b`), `${token} should be ${hex}`);
  }
});

test('no raw Tailwind palette literals remain in src (warn is orange via mc-warn)', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(entry.name)) {
        const text = readFileSync(full, 'utf8');
        const hit = text.match(/\b(?:bg|text|border|ring)-(?:amber|yellow|orange|rose|red|green|emerald|purple|violet|blue|cyan|pink)-\d{2,3}\b/);
        if (hit) offenders.push(`${path.relative(repoRoot, full)}: ${hit[0]}`);
      }
    }
  };
  walk(path.join(repoRoot, 'src'));
  assert.deepEqual(offenders, []);
});

test('the old n8n /70 composite is the 3.43:1 fixture this gate refuses', () => {
  const fg = parseHexColor(LEGACY.textSecondary);
  const bg = parseHexColor(LEGACY.bgSecondary);
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
  const red = parseHexColor(LEGACY.accentRed);
  const header = parseHexColor(LEGACY.bgSecondary);
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
  assert.doesNotMatch(header, /bg-mc-(?:accent-red|danger)\/20 border-mc-(?:accent-red|danger) text-mc-(?:accent-red|danger)/);
  assert.match(header, /bg-mc-bg border-mc-danger text-mc-danger/);
  assert.match(css, /\.status-offline[^{]*\{[^}]*bg-mc-bg/);
});
