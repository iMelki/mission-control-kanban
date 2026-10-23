import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_THRESHOLD,
  STATUS,
  classifyRoute,
  evaluateDrift,
  exitCodeFor,
  formatMarkdown,
  routeSlug,
} from '../scripts/lib/design-drift.mjs';

const report = (score, extra = {}) => ({
  score,
  status: 'stable',
  threshold: 10,
  summary: { changed: 0, added: 0, removed: 0 },
  changes: [],
  ...extra,
});

test('routeSlug names baseline files predictably', () => {
  assert.equal(routeSlug('/'), 'root');
  assert.equal(routeSlug('/workspace/default'), 'workspace-default');
  assert.equal(routeSlug('/settings/?tab=agents'), 'settings');
});

test('a score at the threshold is stable; above it is drift', () => {
  assert.equal(classifyRoute({ route: '/', drift: report(DEFAULT_THRESHOLD) }).status, STATUS.STABLE);
  assert.equal(classifyRoute({ route: '/', drift: report(DEFAULT_THRESHOLD + 0.1) }).status, STATUS.DRIFT);
  assert.equal(classifyRoute({ route: '/', drift: report(3) }, 2).status, STATUS.DRIFT);
});

test('our threshold wins over the status Dembrandt computed with its own', () => {
  const drifted = report(12, { status: 'drift' });
  assert.equal(classifyRoute({ route: '/', drift: drifted }, 20).status, STATUS.STABLE);
});

test('all-stable routes pass with exit 0', () => {
  const verdict = evaluateDrift([
    { route: '/', drift: report(0) },
    { route: '/settings', drift: report(4) },
  ]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.maxScore, 4);
  assert.equal(exitCodeFor(verdict), 0);
});

test('one drifted route fails the run with exit 1', () => {
  const verdict = evaluateDrift([
    { route: '/', drift: report(0) },
    { route: '/settings', drift: report(25, { summary: { changed: 3, added: 1, removed: 1 } }) },
  ]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.counts.drift, 1);
  assert.equal(exitCodeFor(verdict), 1);
});

test('a route that could not be measured is never a pass', () => {
  for (const result of [
    { route: '/', drift: report(0, { inconclusive: true }) },
    { route: '/', baselineMissing: true },
    { route: '/', error: 'dembrandt exited 2' },
    { route: '/', drift: report('n/a') },
  ]) {
    const verdict = evaluateDrift([result]);
    assert.equal(verdict.ok, false, JSON.stringify(result));
    assert.equal(exitCodeFor(verdict), 2, JSON.stringify(result));
  }
  assert.equal(evaluateDrift([]).ok, false, 'zero routes measured nothing');
});

test('drift outranks could-not-evaluate in the exit code', () => {
  const verdict = evaluateDrift([
    { route: '/', baselineMissing: true },
    { route: '/settings', drift: report(50) },
  ]);
  assert.equal(exitCodeFor(verdict), 1);
});

test('an invalid threshold is rejected', () => {
  assert.throws(() => evaluateDrift([], -1));
  assert.throws(() => evaluateDrift([], Number.NaN));
});

test('the Markdown report lists each route and the drifted tokens', () => {
  const verdict = evaluateDrift([
    { route: '/', drift: report(0) },
    {
      route: '/settings',
      drift: report(25, {
        summary: { changed: 1, added: 0, removed: 0 },
        changes: [{ category: 'color', kind: 'changed', label: 'semantic.primary', before: '#58a6ff', after: '#ff00ff' }],
      }),
    },
  ]);
  const markdown = formatMarkdown(verdict, { baseUrl: 'http://127.0.0.1:3021' });
  assert.match(markdown, /\| `\/` \| stable \| 0 \|/);
  assert.match(markdown, /\| `\/settings` \| drift \| 25 \| 1 \| 0 \| 0 \|/);
  assert.match(markdown, /color changed: semantic\.primary \(#58a6ff -> #ff00ff\)/);
  assert.match(markdown, /--update-baseline/);
});
