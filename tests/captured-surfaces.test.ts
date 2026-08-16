import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAPTURE_DECISIONS,
  MANIFEST_RELATIVE_PATH,
  checkCaptureFreshness,
  deriveSurfacesFromRepo,
  diffSurfaces,
  expandDynamicRoutes,
  formatDiff,
  readManifest,
  routePatternsFromPageFiles,
  validateManifestShape,
  type SurfaceFingerprintLookup,
} from '../scripts/derive-captured-surfaces';
import {
  DEPENDENCY_CONTRACT_VERSION,
  fingerprintSurface,
  normalisedFileDigest,
  renderSeedsForRoute,
  resolveSurfaceDependencies,
} from '../scripts/surface-dependencies';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

/** The digest fixtures claim was recorded at capture time. */
const FIXTURE_DIGEST = '0123456789abcdef';

/** A capture record that satisfies every runtime rule, so fixtures vary one thing at a time. */
const VALID_CAPTURE = {
  commit: 'e50e2565631b00c25dd524bfd337f5cf1f635d06',
  date: '2026-08-13',
  viewports: ['mobile', 'desktop'],
  method: 'scripts/probe-surface-clipping.mjs (element-level clipping)',
  sourceDigest: FIXTURE_DIGEST,
  sourceFileCount: 3,
};
const VIEWPORTS = [
  { label: 'mobile', width: 390, height: 844 },
  { label: 'desktop', width: 1440, height: 900 },
];
const captured = (route: string) => ({ route, capture: 'required', capturedAt: VALID_CAPTURE });

const fingerprintStub = (digest: string, unresolved: string[] = []): SurfaceFingerprintLookup => () => ({
  digest,
  fileCount: 3,
  files: ['src/app/layout.tsx', 'src/app/globals.css', 'src/app/page.tsx'],
  unresolved,
});
/** The surface's source is byte-for-byte what the capture measured. */
const SOURCE_UNCHANGED = fingerprintStub(FIXTURE_DIGEST);
/** The surface's source moved after the capture was taken. */
const SOURCE_CHANGED = fingerprintStub('fedcba9876543210');

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
  const diff = diffSurfaces(
    ['/', '/workspace/frontend-revenue'],
    { viewports: VIEWPORTS, surfaces: [captured('/')] },
    SOURCE_UNCHANGED
  );
  assert.deepEqual(diff.missingFromManifest, ['/workspace/frontend-revenue']);
  assert.deepEqual(
    diff.problems.filter((p) => p.route === '/workspace/frontend-revenue').map((p) => p.code),
    ['route_missing_from_manifest']
  );
  assert.match(formatDiff(diff), /score as if it were fine/);
});

test('a surface-list entry with no matching route is reported as stale', () => {
  const diff = diffSurfaces(
    ['/'],
    { viewports: VIEWPORTS, surfaces: [captured('/'), captured('/removed')] },
    SOURCE_UNCHANGED
  );
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
  assert.match(formatDiff(diffSurfaces(['/settings'], manifest, SOURCE_UNCHANGED)), /an entry without a decision is not a decision/);

  // Control: the same entry WITH a decision and a capture record raises nothing.
  assert.deepEqual(codesFor({ viewports: VIEWPORTS, surfaces: [captured('/settings')] }, '/settings'), []);
});

test('HOLE (b): a misspelled capture value is rejected, and cannot dodge the reason check', () => {
  const manifest = { viewports: VIEWPORTS, surfaces: [{ route: '/settings', capture: 'excludedd' }] };
  assert.deepEqual(codesFor(manifest, '/settings'), ['capture_unrecognised']);
  assert.match(formatDiff(diffSurfaces(['/settings'], manifest, SOURCE_UNCHANGED)), /"excludedd" is not one of required \| excluded/);

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
  const diff = diffSurfaces(['/settings'], manifest, SOURCE_UNCHANGED);
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
// HOLE (e), #147: a capture that has gone stale. `capturedAt.commit` was checked
// for SHAPE and never compared to the code, so a surface could be re-edited after
// its capture and the gate stayed green. Both directions are asserted: a changed
// surface must fail and name itself, an unchanged one must still pass.
// ---------------------------------------------------------------------------

const staleFixture = { viewports: VIEWPORTS, surfaces: [captured('/settings')] };

test('HOLE (e): a capture whose surface has since changed FAILS and names the surface', () => {
  const diff = diffSurfaces(['/settings'], staleFixture, SOURCE_CHANGED);
  assert.deepEqual(
    diff.problems.map((problem) => problem.code),
    ['capture_stale'],
    'the only complaint must be the staleness itself, not some unrelated shape error'
  );
  assert.deepEqual(diff.staleCaptures, ['/settings']);

  // Naming the surface is the point: "something is stale" is not actionable.
  const report = formatDiff(diff);
  assert.match(report, /\/settings changed since it was captured/);
  assert.match(report, /recorded sourceDigest 0123456789abcdef, current fedcba9876543210/);
  assert.match(report, /not evidence about the code as it stands/);
  assert.match(report, /Stale captures \(1\): \/settings/);
});

test('CONTROL for (e): the same manifest passes while the surface source is unchanged', () => {
  const diff = diffSurfaces(['/settings'], staleFixture, SOURCE_UNCHANGED);
  assert.deepEqual(diff.problems, [], 'an unchanged surface must not be reported as stale');
  assert.deepEqual(diff.staleCaptures, []);
  assert.equal(formatDiff(diff), '');
});

test('(e) is per-surface: a changed surface fails without dragging its unchanged siblings in', () => {
  const manifest = {
    viewports: VIEWPORTS,
    surfaces: [captured('/'), captured('/settings'), captured('/runtime-regression')],
  };
  // Only /settings moved.
  const lookup: SurfaceFingerprintLookup = (route) => ({
    digest: route === '/settings' ? 'fedcba9876543210' : FIXTURE_DIGEST,
    fileCount: 3,
    files: ['src/app/globals.css'],
    unresolved: [],
  });
  const diff = diffSurfaces(['/', '/settings', '/runtime-regression'], manifest, lookup);
  assert.deepEqual(diff.staleCaptures, ['/settings']);
  assert.deepEqual(
    diff.problems.map((problem) => problem.route),
    ['/settings'],
    'a whole-repo hash would have flagged all three; this must flag only the one that changed'
  );
});

test('a capture with no sourceDigest is rejected: it could never be shown to be stale', () => {
  const { sourceDigest: _dropped, ...noDigest } = VALID_CAPTURE;
  const manifest = {
    viewports: VIEWPORTS,
    surfaces: [{ route: '/settings', capture: 'required', capturedAt: noDigest }],
  };
  assert.deepEqual(codesFor(manifest, '/settings'), ['capture_digest_missing']);
  assert.match(formatDiff(diffSurfaces(['/settings'], manifest, SOURCE_UNCHANGED)), /npm run surfaces:fingerprint/);

  // A malformed digest is not a digest. Short, uppercase and non-hex all fail.
  for (const bad of ['abc', '0123456789ABCDEF', '0123456789abcdefg', 'zzzzzzzzzzzzzzzz', '']) {
    const patched = {
      viewports: VIEWPORTS,
      surfaces: [{ route: '/settings', capture: 'required', capturedAt: { ...VALID_CAPTURE, sourceDigest: bad } }],
    };
    assert.deepEqual(codesFor(patched, '/settings'), ['capture_digest_missing'], `digest ${JSON.stringify(bad)}`);
  }
});

test('freshness can never be skipped by forgetting to pass a lookup', () => {
  // An optional freshness source would make "nobody checked" look exactly like
  // "nothing was stale" — the fail-open shape this gate exists to close.
  assert.throws(
    () => checkCaptureFreshness(staleFixture, ['/settings'], undefined as unknown as SurfaceFingerprintLookup),
    /freshness is never skipped by omission/
  );
  assert.throws(
    () => (diffSurfaces as (a: string[], b: unknown) => unknown)(['/settings'], staleFixture),
    /freshness is never skipped by omission/
  );
});

test('an unresolvable import makes the fingerprint incomplete, and that is reported', () => {
  const diff = diffSurfaces(
    ['/settings'],
    staleFixture,
    fingerprintStub(FIXTURE_DIGEST, ['src/app/settings/page.tsx -> @/components/Ghost'])
  );
  assert.deepEqual(diff.problems.map((problem) => problem.code), ['surface_dependencies_unresolved']);
  assert.match(formatDiff(diff), /does not cover everything that renders it/);
});

test('a stale entry for a route the app no longer serves is reported once, as stale-in-manifest', () => {
  // Fingerprinting a route with no page would report a second, less useful problem
  // for the same fact, so freshness only looks at routes the app actually serves.
  const diff = diffSurfaces(['/'], { viewports: VIEWPORTS, surfaces: [captured('/'), captured('/gone')] }, SOURCE_CHANGED);
  assert.deepEqual(
    diff.problems.filter((problem) => problem.route === '/gone').map((problem) => problem.code),
    ['route_stale_in_manifest']
  );
});

// ---------------------------------------------------------------------------
// The dependency set the digest covers. Depth is the whole design decision, so
// it is asserted rather than described: deep enough to see shared components and
// the global stylesheet, narrow enough that unrelated code does not invalidate.
// ---------------------------------------------------------------------------

test('a surface is more than its page.tsx: shared components and globals.css are in the set', () => {
  const settings = resolveSurfaceDependencies(repoRoot, '/settings');
  assert.ok(settings, '/settings must resolve');
  assert.ok(settings.files.includes('src/app/settings/page.tsx'), 'the page itself');
  // The #145 clipping bug lived HERE, not in page.tsx. A page-only rule misses it.
  assert.ok(
    settings.files.includes('src/components/runtime/RuntimeConfigTemplateGallery.tsx'),
    'the component the #145 clipping bug lived in must invalidate the /settings capture'
  );
  // How globals.css reaches every surface, and the file 5b846ce changed under 8 stale captures.
  assert.ok(settings.files.includes('src/app/layout.tsx'), 'the root layout always wraps the page');
  assert.ok(settings.files.includes('src/app/globals.css'), 'the global stylesheet renders on every surface');
  assert.ok(settings.files.includes('tailwind.config.ts'), 'the config that decides what the classes mean');
  assert.deepEqual(settings.unresolved, [], 'an unresolved import would make the digest a lie by omission');
});

test('the dependency set is NOT a whole-repo hash', () => {
  const routes = deriveSurfacesFromRepo(repoRoot);
  const union = new Set<string>();
  for (const route of routes) {
    const resolved = resolveSurfaceDependencies(repoRoot, route);
    assert.ok(resolved, `${route} must resolve to a rendering file set`);
    assert.deepEqual(resolved.unresolved, [], `${route} has unresolvable imports`);
    for (const file of resolved.files) union.add(file);
  }
  // Nothing that cannot render a page may sit in the set: those are the edits that
  // would invalidate every capture on every commit and get this gate switched off.
  for (const file of union) {
    assert.doesNotMatch(file, /^(scripts|tests|docs|artifacts|reports)\//, `${file} cannot render a surface`);
    assert.doesNotMatch(file, /^src\/app\/api\//, `${file} is a route handler, not a rendered surface`);
  }
  const trackedSourceFiles = fs
    .readdirSync(path.join(repoRoot, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(tsx?|jsx?|css)$/.test(entry)).length;
  assert.ok(union.size < trackedSourceFiles, `the union (${union.size}) must be a strict subset of src (${trackedSourceFiles})`);

  // Per-surface sets differ, so an edit to one page does not invalidate the others.
  const home = new Set(resolveSurfaceDependencies(repoRoot, '/')!.files);
  assert.ok(!home.has('src/app/settings/page.tsx'), '/ must not depend on the settings page');
});

test('render seeds follow the App Router: wrappers first, then the page, and [slug] resolves', () => {
  const seeds = renderSeedsForRoute(repoRoot, '/settings')!.map((seed) => seed.replace(/\\/g, '/'));
  assert.ok(seeds[0].endsWith('src/app/layout.tsx'), 'the outermost wrapper comes first');
  assert.ok(seeds.some((seed) => seed.endsWith('src/app/settings/page.tsx')));
  // A cockpit slug resolves to the dynamic page that actually serves it.
  const cockpit = renderSeedsForRoute(repoRoot, '/workspace/memsys')!.map((seed) => seed.replace(/\\/g, '/'));
  assert.ok(cockpit.some((seed) => seed.endsWith('src/app/workspace/[slug]/page.tsx')));
  assert.equal(renderSeedsForRoute(repoRoot, '/no-such-route'), null);
});

test('the digest moves when a rendering file changes, and only then', () => {
  // A self-contained fixture repo: the mechanism is proved directly rather than
  // inferred from the real tree, which no test may mutate.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-surface-deps-'));
  try {
    const write = (relative: string, body: string) => {
      fs.mkdirSync(path.join(root, path.dirname(relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), body);
    };
    write('src/app/globals.css', 'body { margin: 0 }\n');
    write('src/app/layout.tsx', "import './globals.css';\nexport default function L() {}\n");
    write('src/components/Shared.tsx', 'export const Shared = () => null;\n');
    write('src/app/thing/page.tsx', "import { Shared } from '@/components/Shared';\nexport default function P() {}\n");
    write('src/app/other/page.tsx', 'export default function O() {}\n');

    const before = fingerprintSurface(root, '/thing')!;
    assert.deepEqual(before.files.sort(), [
      'src/app/globals.css',
      'src/app/layout.tsx',
      'src/app/thing/page.tsx',
      'src/components/Shared.tsx',
    ]);

    // 1. An unrelated page moving must NOT invalidate this surface.
    write('src/app/other/page.tsx', 'export default function O() { return null; }\n');
    assert.equal(fingerprintSurface(root, '/thing')!.digest, before.digest, 'an unrelated page must not invalidate');

    // 2. A file the surface imports transitively MUST invalidate it.
    write('src/components/Shared.tsx', 'export const Shared = () => "changed";\n');
    const afterShared = fingerprintSurface(root, '/thing')!;
    assert.notEqual(afterShared.digest, before.digest, 'a shared component change must invalidate');

    // 3. The global stylesheet reaches the surface through the root layout.
    write('src/components/Shared.tsx', 'export const Shared = () => null;\n');
    assert.equal(fingerprintSurface(root, '/thing')!.digest, before.digest, 'reverting must restore the digest');
    write('src/app/globals.css', 'body { margin: 1px }\n');
    assert.notEqual(fingerprintSurface(root, '/thing')!.digest, before.digest, 'globals.css must invalidate');

    // 4. Line endings must not. core.autocrlf=true and no .gitattributes means the
    //    same commit checks out CRLF on Windows and LF on Linux; a digest that moved
    //    with the checkout would fail for a reason unrelated to its subject.
    write('src/app/globals.css', 'body { margin: 0 }\n');
    assert.equal(fingerprintSurface(root, '/thing')!.digest, before.digest);
    const lfPath = path.join(root, 'src/components/Shared.tsx');
    const lfDigest = normalisedFileDigest(lfPath);
    fs.writeFileSync(lfPath, 'export const Shared = () => null;\r\n');
    assert.equal(normalisedFileDigest(lfPath), lfDigest, 'CRLF and LF of the same file must digest identically');
    assert.equal(fingerprintSurface(root, '/thing')!.digest, before.digest, 'CRLF must not move the surface digest');

    // 5. The contract version is part of the digest, so changing the resolution
    //    rules invalidates every capture on purpose instead of silently comparing
    //    old digests against a set computed by different rules.
    assert.equal(typeof DEPENDENCY_CONTRACT_VERSION, 'number');
    assert.ok(DEPENDENCY_CONTRACT_VERSION >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The real repo.
// ---------------------------------------------------------------------------

test('the committed surface list matches the routes this app actually serves', () => {
  const derived = deriveSurfacesFromRepo(repoRoot);
  const diff = diffSurfaces(derived, readManifest(repoRoot), (route) => fingerprintSurface(repoRoot, route));
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

test('every committed capture still describes the source that renders it today (#147)', () => {
  const manifest = readManifest(repoRoot) as {
    surfaces: Array<{ route: string; capture: string; capturedAt?: { sourceDigest?: string; sourceFileCount?: number } }>;
  };
  const captures = manifest.surfaces.filter((surface) => surface.capture === 'required' && surface.capturedAt);
  assert.ok(captures.length > 0, 'there must be captures to check, or this test proves nothing');
  for (const surface of captures) {
    const current = fingerprintSurface(repoRoot, surface.route);
    assert.ok(current, `${surface.route} must resolve to a rendering file set`);
    assert.equal(
      surface.capturedAt?.sourceDigest,
      current.digest,
      `${surface.route} was captured against source that has since changed; re-probe it and record the new capture`
    );
    assert.equal(surface.capturedAt?.sourceFileCount, current.fileCount, `${surface.route} file count drifted`);
  }
});
