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

// mck#151 non-text leftover (WCAG 2.2 SC 1.4.11, 3:1). The task-card reorder
// handle is a real button whose only visual identifier is the GripVertical
// icon. `text-mc-text-secondary/50` composites below 3:1 on the card and on
// the handle's own hover fill, so the control is not perceivable once shown.
const HANDLE_BACKDROPS = [
  ['mc-bg-secondary (task card)', TOKENS.bgSecondary],
  ['mc-bg-tertiary (handle hover)', TOKENS.bgTertiary],
] as const;

test('the old drag-handle icon /50 composite is the sub-3:1 fixture this gate refuses', () => {
  const fg = parseHexColor(TOKENS.textSecondary);
  for (const [name, hex] of HANDLE_BACKDROPS) {
    const bg = parseHexColor(hex);
    const ratio = contrastRatioRounded(compositeOver(fg, 0.5, bg), bg);
    assert.ok(ratio < 3, `${name}: old /50 icon must stay a failing fixture, got ${ratio}:1`);
  }
});

test('the drag-handle icon token is >=3:1 on the card and on its hover fill', () => {
  const fg = parseHexColor(TOKENS.textSecondary);
  for (const [name, hex] of HANDLE_BACKDROPS) {
    const ratio = contrastRatioRounded(fg, parseHexColor(hex));
    assert.ok(ratio >= 3, `${name} against the handle icon is ${ratio}:1, need >=3`);
  }
});

test('the focusable drag handle no longer fades its icon with /50', () => {
  const queue = readFileSync(path.join(repoRoot, 'src', 'components', 'MissionQueue.tsx'), 'utf8');
  const start = queue.indexOf('data-task-drag-handle');
  assert.ok(start > 0, 'TaskCard still renders the data-task-drag-handle button');
  const handle = queue.slice(start, queue.indexOf('</button>', start));
  assert.match(handle, /<GripVertical className="size-4 text-mc-text-secondary"/);
  assert.doesNotMatch(handle, /text-mc-text-secondary\/\d+/);
});

// mck#150 regression ratchet (WCAG 2.2 SC 2.4.7 / 2.4.13 / 1.4.11): the shared
// Input focus ring is mc-accent at full alpha, and it must stay >=3:1 against
// every backdrop the /settings fields sit on. A faded ring (/40, /50) fails.
const ACCENT = '#58a6ff';

test('the Input focus ring colour is >=3:1 on every settings backdrop', () => {
  const ring = parseHexColor(ACCENT);
  for (const hex of [TOKENS.bg, TOKENS.bgSecondary, TOKENS.bgTertiary]) {
    const ratio = contrastRatioRounded(ring, parseHexColor(hex));
    assert.ok(ratio >= 3, `ring ${ACCENT} on ${hex} is ${ratio}:1, need >=3`);
  }
  const faded = compositeOver(ring, 0.4, parseHexColor(TOKENS.bgTertiary));
  assert.ok(
    contrastRatioRounded(faded, parseHexColor(TOKENS.bgTertiary)) < 3,
    'a /40 ring must stay a failing fixture or this check is dead',
  );
  const input = readFileSync(path.join(repoRoot, 'src', 'components', 'ui', 'input.tsx'), 'utf8');
  assert.match(input, /focus-visible:ring-mc-accent(?![/\w-])/);
  assert.match(
    readFileSync(path.join(repoRoot, 'tailwind.config.ts'), 'utf8'),
    /'mc-accent':\s*'#58a6ff'/,
  );
});
