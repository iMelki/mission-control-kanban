import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MANIFEST_RELATIVE_PATH,
  deriveSurfacesFromRepo,
  diffSurfaces,
  expandDynamicRoutes,
  formatDiff,
  readManifest,
  routePatternsFromPageFiles,
} from '../scripts/derive-captured-surfaces';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

test('page files map to App Router route patterns', () => {
  assert.deepEqual(
    routePatternsFromPageFiles([
      'page.tsx',
      'settings/page.tsx',
      'workspace/[slug]/page.tsx',
      '(marketing)/pricing/page.tsx',
    ]),
    ['/', '/pricing', '/settings', '/workspace/[slug]']
  );
});

test('workspace slugs expand from the workspace registry, not a hand-written list', () => {
  const expanded = expandDynamicRoutes(['/workspace/[slug]', '/settings'], ['alpha', 'beta']);
  assert.deepEqual(expanded, ['/settings', '/workspace/alpha', '/workspace/beta']);
});

test('a route the app serves but the surface list omits is reported as drift', () => {
  const diff = diffSurfaces(['/', '/workspace/frontend-revenue'], {
    surfaces: [{ route: '/', capture: 'required' }],
  });
  assert.deepEqual(diff.missingFromManifest, ['/workspace/frontend-revenue']);
  assert.match(formatDiff(diff), /\/workspace\/frontend-revenue/);
  assert.match(formatDiff(diff), /score as if they were fine/);
});

test('a surface-list entry with no matching route is reported as stale', () => {
  const diff = diffSurfaces(['/'], {
    surfaces: [
      { route: '/', capture: 'required' },
      { route: '/removed', capture: 'required' },
    ],
  });
  assert.deepEqual(diff.staleInManifest, ['/removed']);
});

test('an excluded surface must record why it is excluded', () => {
  const withoutReason = diffSurfaces(['/', '/debug'], {
    surfaces: [
      { route: '/', capture: 'required' },
      { route: '/debug', capture: 'excluded' },
    ],
  });
  assert.deepEqual(withoutReason.exclusionsWithoutReason, ['/debug']);

  const withReason = diffSurfaces(['/', '/debug'], {
    surfaces: [
      { route: '/', capture: 'required' },
      { route: '/debug', capture: 'excluded', reason: 'developer-only overlay' },
    ],
  });
  assert.deepEqual(withReason.exclusionsWithoutReason, []);
});

test('the committed surface list matches the routes this app actually serves', () => {
  const derived = deriveSurfacesFromRepo(repoRoot);
  const diff = diffSurfaces(derived, readManifest(repoRoot));
  assert.equal(
    diff.missingFromManifest.length + diff.staleInManifest.length + diff.exclusionsWithoutReason.length,
    0,
    `${MANIFEST_RELATIVE_PATH} is out of date:\n${formatDiff(diff)}`
  );
  assert.ok(derived.includes('/workspace/frontend-revenue'), 'the #142 cockpit must be derivable');
});
