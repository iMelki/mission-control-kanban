/**
 * mission-control-kanban#159 -- the coverage reporter scored a surface that
 * rendered ZERO controls as full coverage.
 *
 * These tests are written FAIL-FIRST against the behaviour on origin/dev
 * @ 2ae7059: `population === 0 ? 100` produced
 * `{ coveragePct: 100, status: 'full', unaccounted: -1 }` and the surface was
 * counted among those at full coverage. Every `assert` below fails against
 * that expression and passes against `classifyCoverage`.
 *
 * The last block is the RATCHET: it fails when a new call site hand-rolls the
 * ratio instead of importing the primitive. Without it the four copies come
 * back (canonical-primitive-ratchet, obligation 3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyCoverage,
  assertDenominator,
  formatCoveragePct,
  EMPTY,
  INVALID,
  FULL,
  PARTIAL,
} from '../scripts/lib/coverage-denominator.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Remove block and line comments so the ratchet scans code, not prose. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ---------------------------------------------------- the reproduction --- */

test('THE DEFECT: a zero denominator is never 100% and never full', () => {
  // Verbatim input from the published report in #159: route "/", viewport
  // mobile, population 0, measured 0, one control recorded outsideApp.
  const c = classifyCoverage({ population: 0, measured: 0 });

  assert.equal(c.coveragePct, null, 'zero denominator must not yield a percentage');
  assert.notEqual(c.coveragePct, 100, 'the #159 defect: 0/0 reported as 100%');
  assert.equal(c.status, EMPTY);
  assert.notEqual(c.status, FULL, 'the #159 defect: 0 controls reported as full coverage');
  assert.equal(c.reason, 'zero-denominator');
  assert.equal(c.scorable, false);
});

test('a zero-denominator surface is excluded from "surfaces at full coverage"', () => {
  const surfaces = [
    { route: '/', viewport: 'mobile', coverage: classifyCoverage({ population: 0, measured: 0 }) },
    { route: '/', viewport: 'desktop', coverage: classifyCoverage({ population: 26, measured: 26 }) },
  ];
  const atFull = surfaces.filter((s) => s.coverage.status === FULL);
  assert.equal(atFull.length, 1, 'the empty surface must not be counted at full coverage');
  assert.equal(atFull[0].viewport, 'desktop');

  // ...and it must be named, and must make the run non-zero-exit.
  const needingAttention = surfaces.filter((s) => s.coverage.status !== FULL);
  assert.deepEqual(
    needingAttention.map((s) => s.route + ' ' + s.viewport + ' ' + s.coverage.status),
    ['/ mobile empty']
  );
});

test('a zero-denominator measurement never prints as a number', () => {
  const c = classifyCoverage({ population: 0, measured: 0 });
  assert.equal(formatCoveragePct(c.coveragePct, c.status), 'n/a (zero denominator)');
  assert.ok(!/\d/.test(formatCoveragePct(c.coveragePct, c.status).replace('n/a', '')));
});

/* --------------------------------------- a genuine good input still passes --- */

test('CONTROL: a genuine full measurement is still full at 100%', () => {
  const c = classifyCoverage({ population: 26, measured: 26 });
  assert.equal(c.coveragePct, 100);
  assert.equal(c.status, FULL);
  assert.equal(c.scorable, true);
  assert.equal(c.reason, null);
});

test('CONTROL: a genuine partial measurement is still partial', () => {
  const c = classifyCoverage({ population: 1058, measured: 981 });
  assert.equal(c.coveragePct, 92.7);
  assert.equal(c.status, PARTIAL);
  assert.equal(c.scorable, true);
});

test('CONTROL: 100% with a destroyed sample is partial, not full', () => {
  const c = classifyCoverage({ population: 13, measured: 13, staleAfterSampleDestroyed: 4 });
  assert.equal(c.coveragePct, 100);
  assert.equal(c.status, PARTIAL, 'a destroyed sample forbids full even at 100%');
});

test('CONTROL: the rounding contract is unchanged (one decimal place)', () => {
  assert.equal(classifyCoverage({ population: 1058, measured: 1057 }).coveragePct, 99.9);
  assert.equal(classifyCoverage({ population: 4402, measured: 2964 }).coveragePct, 67.3);
  assert.equal(classifyCoverage({ population: 3, measured: 1 }).coveragePct, 33.3);
});

/* ------------------------------------------------ malformed denominators --- */

test('a malformed denominator is invalid, not scored', () => {
  for (const bad of [-1, 1.5, NaN, null, undefined, '12']) {
    const c = classifyCoverage({ population: bad, measured: 0 });
    assert.equal(c.status, INVALID, 'population ' + JSON.stringify(bad));
    assert.equal(c.coveragePct, null);
  }
});

test('a numerator larger than its denominator is invalid, not >100%', () => {
  const c = classifyCoverage({ population: 5, measured: 9 });
  assert.equal(c.status, INVALID);
  assert.equal(c.reason, 'numerator-exceeds-denominator');
  assert.equal(c.coveragePct, null);
});

/* ------------------------------- the missing assertion class (agent-settings#863 D2) --- */

test('assertDenominator refuses a coverage claim with nothing in scope', () => {
  const r = assertDenominator({ expected: 0, observed: 0, basis: 'board rows parsed' });
  assert.equal(r.ok, false);
  assert.equal(r.status, EMPTY);
  assert.equal(r.reason, 'zero-denominator');
  // This is the agent-settings#863 shape: 0 rows parsed, reported 5/5 GREEN.
  assert.notEqual(r.status, FULL);
});

test('assertDenominator refuses a denominator with no declared basis', () => {
  const r = assertDenominator({ expected: 10, observed: 5, basis: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'denominator-basis-undeclared');
});

test('assertDenominator: "scored N of M, M>0" passes and states both numbers', () => {
  const r = assertDenominator({ expected: 10, observed: 5, basis: 'board rows present' });
  assert.equal(r.ok, true);
  assert.equal(r.status, PARTIAL);
  assert.match(r.detail, /scored 5 of 10 \(board rows present\)/);

  const full = assertDenominator({ expected: 10, observed: 10, basis: 'board rows present' });
  assert.equal(full.status, FULL);
});

test('assertDenominator refuses observing more than was expected', () => {
  const r = assertDenominator({ expected: 5, observed: 10, basis: 'registered apps' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'numerator-out-of-range');
});

/* ------------------------------------------------------------ the ratchet --- */

test('RATCHET: no call site hand-rolls the zero-denominator ratio', () => {
  // Call sites live under scripts/. This test file is deliberately NOT scanned:
  // it carries the offending expression as a string literal in the positive
  // control below, and a scanner that matched it would never be able to go green.
  const scanRoots = ['scripts'];
  const primitive = path.join('scripts', 'lib', 'coverage-denominator.mjs');
  // `<something> === 0 ? 100` -- the exact expression that produced #159.
  const handRolled = /===\s*0\s*\?\s*100\b/;
  const offenders = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true });
    } catch (err) {
      // fail-open-ok: a missing scan root is reported below as a hard failure,
      // never swallowed into an empty offender list.
      throw new Error('RATCHET could not read ' + dir + ': ' + err.message);
    }
    for (const e of entries) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'fixtures') continue;
        walk(rel);
        continue;
      }
      if (!/\.(mjs|js|ts|tsx)$/.test(e.name)) continue;
      if (rel === primitive) continue;
      // Scan CODE, not prose. The migrated call sites carry comments that
      // quote the old expression verbatim to explain what was removed; a
      // scanner that matched those could never go green, and rewording the
      // explanation to appease the scanner would be the tail wagging the dog.
      const src = stripComments(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
      if (handRolled.test(src)) offenders.push(rel);
    }
  };
  for (const root of scanRoots) walk(root);

  assert.deepEqual(
    offenders,
    [],
    'hand-rolled zero-denominator ratio found; import classifyCoverage from ' +
      'scripts/lib/coverage-denominator.mjs instead (mission-control-kanban#159):\n  ' +
      offenders.join('\n  ')
  );
});

test('RATCHET POSITIVE CONTROL: the scan can actually see a violation', () => {
  // gate-negative-proof corollary (g): prove the probe reads something in THIS
  // run. A ratchet that scans zero files also reports zero offenders.
  const handRolled = /===\s*0\s*\?\s*100\b/;
  assert.equal(
    handRolled.test('const pct = population === 0 ? 100 : ratio;'),
    true,
    'the ratchet pattern no longer matches the exact expression from #159'
  );
  // The comment stripper must remove PROSE without blinding the scanner to
  // CODE. A stripper that ate everything would trade one fail-open for another.
  assert.equal(
    handRolled.test(stripComments('const pct = population === 0 ? 100 : ratio;')),
    true,
    'stripComments blinded the ratchet to a real hand-rolled call site'
  );
  assert.equal(
    handRolled.test(stripComments('// #159: was `population === 0 ? 100`.')),
    false,
    'stripComments failed to remove a line comment'
  );
  assert.equal(
    handRolled.test(stripComments('/* population === 0 ? 100 */')),
    false,
    'stripComments failed to remove a block comment'
  );
  assert.equal(
    handRolled.test(stripComments('const u = "https://x/y"; const p = n === 0 ? 100 : r;')),
    true,
    'the [^:] guard must not let a URL swallow the rest of a code line'
  );
  const probe = fs.readFileSync(path.join(repoRoot, 'scripts', 'probe-surface-a11y.mjs'), 'utf8');
  assert.ok(probe.length > 1000, 'the ratchet must be reading a real, non-empty probe file');
  assert.match(
    probe,
    /coverage-denominator\.mjs/,
    'the probe must import the primitive, not re-derive the ratio'
  );
});
