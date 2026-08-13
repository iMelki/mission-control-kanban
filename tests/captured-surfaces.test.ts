import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAPTURE_DECISIONS,
  MANIFEST_RELATIVE_PATH,
  deriveSurfacesFromRepo,
  diffSurfaces,
  expandDynamicRoutes,
  formatDiff,
  readManifest,
  routePatternsFromPageFiles,
  validateManifestShape,
} from '../scripts/derive-captured-surfaces';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

/** A capture record that satisfies every runtime rule, so fixtures vary one thing at a time. */
const VALID_CAPTURE = {
  commit: 'e50e2565631b00c25dd524bfd337f5cf1f635d06',
  date: '2026-08-13',
  viewports: ['mobile', 'desktop'],
  method: 'scripts/probe-surface-clipping.mjs (element-level clipping)',
};
const VIEWPORTS = [
  { label: 'mobile', width: 390, height: 844 },
  { label: 'desktop', width: 1440, height: 900 },
];
const captured = (route: string) => ({ route, capture: 'required', capturedAt: VALID_CAPTURE });

/** Problem codes raised for a route, so a fixture asserts WHY it failed. */
const codesFor = (manifest: unknown, route: string | null) =>
  validateManifestShape(manifest)
    .filter((problem) => problem.route === route)
    .map((problem) => problem.code)
    .sort();

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
    viewports: VIEWPORTS,
    surfaces: [captured('/')],
  });
  assert.deepEqual(diff.missingFromManifest, ['/workspace/frontend-revenue']);
  assert.deepEqual(
    diff.problems.filter((p) => p.route === '/workspace/frontend-revenue').map((p) => p.code),
    ['route_missing_from_manifest']
  );
  assert.match(formatDiff(diff), /score as if it were fine/);
});

test('a surface-list entry with no matching route is reported as stale', () => {
  const diff = diffSurfaces(['/'], {
    viewports: VIEWPORTS,
    surfaces: [captured('/'), captured('/removed')],
  });
  assert.deepEqual(diff.staleInManifest, ['/removed']);
  assert.deepEqual(codesFor({ viewports: VIEWPORTS, surfaces: [captured('/')] }, '/'), []);
});

// ---------------------------------------------------------------------------
// Negative fixtures for the three fail-open holes (#144). Each one exited 0
// against the real repo before this change. Each asserts the SPECIFIC code, so
// a check that starts failing for an unrelated reason is not mistaken for
// coverage.
// ---------------------------------------------------------------------------

test('HOLE (a): an entry with no "capture" field is not a capture decision', () => {
  const manifest = { viewports: VIEWPORTS, surfaces: [{ route: '/settings', note: 'no decision here' }] };
  assert.deepEqual(codesFor(manifest, '/settings'), ['capture_missing']);
  assert.match(formatDiff(diffSurfaces(['/settings'], manifest)), /an entry without a decision is not a decision/);

  // Control: the same entry WITH a decision and a capture record raises nothing.
  assert.deepEqual(codesFor({ viewports: VIEWPORTS, surfaces: [captured('/settings')] }, '/settings'), []);
});

test('HOLE (b): a misspelled capture value is rejected, and cannot dodge the reason check', () => {
  const manifest = { viewports: VIEWPORTS, surfaces: [{ route: '/settings', capture: 'excludedd' }] };
  assert.deepEqual(codesFor(manifest, '/settings'), ['capture_unrecognised']);
  assert.match(formatDiff(diffSurfaces(['/settings'], manifest)), /"excludedd" is not one of required \| excluded/);

  // The old check string-matched the literal 'excluded', so the typo also skipped it.
  // Proof the reason check itself is alive: spell it correctly and the reason is demanded.
  const spelledRight = { viewports: VIEWPORTS, surfaces: [{ route: '/settings', capture: 'excluded' }] };
  assert.deepEqual(codesFor(spelledRight, '/settings').sort(), ['exclusion_reason_missing', 'exclusion_untracked']);
});

test('HOLE (c): blanket-excluding every cockpit with reason "x" is rejected', () => {
  const cockpits = ['/workspace/memsys', '/workspace/asimtop', '/workspace/content-factory'];
  const manifest = {
    viewports: VIEWPORTS,
    surfaces: cockpits.map((route) => ({ route, capture: 'excluded', reason: 'x' })),
  };
  for (const route of cockpits) {
    assert.deepEqual(
      codesFor(manifest, route),
      ['exclusion_reason_missing_placeholder', 'exclusion_untracked'],
      `${route} must be rejected for the placeholder reason AND the missing attribution`
    );
  }
  // Excluding literally everything also empties the programme, which is its own problem.
  assert.deepEqual(codesFor(manifest, null), ['programme_empty']);

  // A substantive, attributed exclusion is accepted: the gate blocks placeholders, not exclusions.
  const legitimate = {
    viewports: VIEWPORTS,
    surfaces: [
      captured('/'),
      {
        route: '/debug',
        capture: 'excluded',
        reason: 'developer-only overlay, never reachable from the shipped navigation',
        excludedBy: '#144',
      },
    ],
  };
  assert.deepEqual(validateManifestShape(legitimate), []);
});

test('HOLE (d): "required" on a surface nobody ever captured is a NON-passing state', () => {
  const manifest = { viewports: VIEWPORTS, surfaces: [{ route: '/settings', capture: 'required' }] };
  const diff = diffSurfaces(['/settings'], manifest);
  assert.deepEqual(codesFor(manifest, '/settings'), ['required_never_captured']);
  assert.deepEqual(diff.requiredNeverCaptured, ['/settings']);
  assert.match(formatDiff(diff), /unmeasured, not known-good/);
});

test('the explicitly-reasoned downgrade is allowed, but only when justified and tracked', () => {
  const untracked = {
    viewports: VIEWPORTS,
    surfaces: [
      { route: '/settings', capture: 'required', captureDeferred: { reason: 'x', issue: 'soon' } },
    ],
  };
  assert.deepEqual(codesFor(untracked, '/settings'), ['deferral_reason_missing_placeholder', 'deferral_untracked']);

  const proper = {
    viewports: VIEWPORTS,
    surfaces: [
      {
        route: '/settings',
        capture: 'required',
        captureDeferred: {
          reason: 'blocked on seeded runtime fixtures; the page renders empty without them',
          issue: '#144',
        },
      },
    ],
  };
  assert.deepEqual(validateManifestShape(proper), []);

  // A surface cannot claim to be both captured and deferred.
  const both = {
    viewports: VIEWPORTS,
    surfaces: [
      {
        route: '/settings',
        capture: 'required',
        capturedAt: VALID_CAPTURE,
        captureDeferred: { reason: 'blocked on seeded runtime fixtures for this page', issue: '#144' },
      },
    ],
  };
  assert.deepEqual(codesFor(both, '/settings'), ['deferral_contradicts_capture']);
});

test('a capture record must name a full commit, an ISO date, a method, and real viewports', () => {
  const bad = (patch: Record<string, unknown>) => ({
    viewports: VIEWPORTS,
    surfaces: [{ route: '/settings', capture: 'required', capturedAt: { ...VALID_CAPTURE, ...patch } }],
  });
  // A short sha is ambiguous and cannot be checked against a remote.
  assert.deepEqual(codesFor(bad({ commit: 'e50e256' }), '/settings'), ['capture_record_invalid']);
  assert.deepEqual(codesFor(bad({ date: 'last Tuesday' }), '/settings'), ['capture_record_invalid']);
  // A capture with no named method cannot be reproduced, so it is not evidence.
  assert.deepEqual(codesFor(bad({ method: '' }), '/settings'), ['capture_record_invalid']);
  // Claiming a viewport the manifest does not declare.
  assert.deepEqual(codesFor(bad({ viewports: ['tablet'] }), '/settings').sort(), [
    'capture_viewports_incomplete',
    'capture_viewports_invalid',
  ]);
  // Capturing mobile only, while the programme declares mobile AND desktop.
  assert.deepEqual(codesFor(bad({ viewports: ['mobile'] }), '/settings'), ['capture_viewports_incomplete']);
});

test('the parsed JSON is validated at runtime, not merely cast to a type', () => {
  assert.deepEqual(validateManifestShape(null).map((p) => p.code), ['manifest_not_object']);
  assert.deepEqual(validateManifestShape({}).map((p) => p.code), ['surfaces_not_array']);
  // A bare string is not an entry. The manifest then requires nothing, which also fires.
  assert.deepEqual(
    validateManifestShape({ surfaces: ['/settings'] }).map((p) => p.code),
    ['entry_not_object', 'programme_empty']
  );
  assert.deepEqual(
    validateManifestShape({ surfaces: [{ capture: 'required' }] }).map((p) => p.code),
    ['route_invalid', 'programme_empty']
  );
  const duplicated = {
    viewports: VIEWPORTS,
    surfaces: [captured('/settings'), captured('/settings')],
  };
  assert.deepEqual(codesFor(duplicated, '/settings'), ['route_duplicated']);
  assert.deepEqual(CAPTURE_DECISIONS, ['required', 'excluded']);
});

// ---------------------------------------------------------------------------
// The real repo.
// ---------------------------------------------------------------------------

test('the committed surface list matches the routes this app actually serves', () => {
  const derived = deriveSurfacesFromRepo(repoRoot);
  const diff = diffSurfaces(derived, readManifest(repoRoot));
  assert.equal(diff.problems.length, 0, `${MANIFEST_RELATIVE_PATH} is out of date:\n${formatDiff(diff)}`);
  assert.ok(derived.includes('/workspace/frontend-revenue'), 'the #142 cockpit must be derivable');
});

test('every required surface in the committed list carries real capture evidence', () => {
  const manifest = readManifest(repoRoot) as { surfaces: Array<Record<string, unknown>> };
  const required = manifest.surfaces.filter((surface) => surface.capture === 'required');
  assert.ok(required.length > 0, 'the scoring programme must require at least one surface');
  for (const surface of required) {
    assert.ok(
      surface.capturedAt || surface.captureDeferred,
      `${surface.route} is required but has neither a capture record nor a tracked deferral`
    );
  }
});
