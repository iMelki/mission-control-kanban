import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { coversFile, runPreflight } from '../scripts/verify-component-sourcing-preflight.mjs';

const VALID_RECORD = `# Sourcing record fixture

- Target app/surface and component job: MCK workspace fixture surface
- Target-app component checked: yes, inspected sibling panels first
- Component marketplace primitive checked: yes, checked shadcn registry
- External pools checked or deliberately skipped: deliberately skipped, fixture scope
- Chosen source lane and why: vendored primitive, matches house conventions
- License/access/dependency result: MIT, no new dependencies
- Proof expected before closeout: unit test assertions in this suite
- Covers: src/components/**/*.tsx
`;

function makeFixture({ components = [], baseline, record } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'mck-preflight-'));
  for (const file of components) {
    const abs = path.join(root, file);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, 'export {};\n');
  }
  if (baseline !== undefined) {
    mkdirSync(path.join(root, 'docs', 'preflight'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'preflight', 'component-baseline.json'), JSON.stringify(baseline, null, 2));
  }
  if (record !== undefined) {
    mkdirSync(path.join(root, 'docs', 'preflight', 'records'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'preflight', 'records', '2026-08-10-fixture.md'), record);
  }
  return root;
}

test('coversFile: ** matches zero directory levels for direct children', () => {
  assert.equal(coversFile('src/components/**/*.tsx', 'src/components/Foo.tsx'), true);
  assert.equal(coversFile('src/components/**/*.tsx', 'src/components/ui/Foo.tsx'), true);
  assert.equal(coversFile('src/components/**/*.tsx', 'src/components/a/b/Foo.tsx'), true);
});

test('coversFile: segment boundaries and extensions stay strict', () => {
  assert.equal(coversFile('src/components/**/*.tsx', 'src/componentsX/Foo.tsx'), false);
  assert.equal(coversFile('src/components/**/*.tsx', 'src/components/Foo.ts'), false);
  assert.equal(coversFile('src/components/*.tsx', 'src/components/ui/Foo.tsx'), false);
  assert.equal(coversFile('src/components/*.tsx', 'src/components/Foo.tsx'), true);
});

test('coversFile: exact paths, ? wildcards, and non-glob mismatches', () => {
  assert.equal(coversFile('src/components/Foo.tsx', 'src/components/Foo.tsx'), true);
  assert.equal(coversFile('src/components/Bar.tsx', 'src/components/Foo.tsx'), false);
  assert.equal(coversFile('src/components/Fo?.tsx', 'src/components/Foo.tsx'), true);
  assert.equal(coversFile('src/components/Fo?.tsx', 'src/components/Fo/x.tsx'), false);
});

test('runPreflight: a valid record with a ** glob covers direct and nested components', () => {
  const root = makeFixture({
    components: ['src/components/Direct.tsx', 'src/components/ui/Nested.tsx'],
    record: VALID_RECORD,
  });
  try {
    const { failures } = runPreflight(root);
    assert.deepEqual(failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runPreflight: baseline entries require a non-placeholder reason', () => {
  const root = makeFixture({
    components: ['src/components/Legacy.tsx'],
    baseline: [
      { file: 'src/components/Legacy.tsx', reason: 'TBD' },
    ],
  });
  try {
    const { failures } = runPreflight(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /non-placeholder reason/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runPreflight: a non-array baseline fails closed', () => {
  const root = makeFixture({
    components: [],
    baseline: { file: 'src/components/Legacy.tsx', reason: 'valid reason' },
  });
  try {
    const { failures } = runPreflight(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /expected a JSON array/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runPreflight: stale baseline entries still ratchet down', () => {
  const root = makeFixture({
    components: [],
    baseline: [
      { file: 'src/components/Gone.tsx', reason: 'pre-gate baseline 2026-08-09' },
    ],
  });
  try {
    const { failures } = runPreflight(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /no longer exists on disk/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runPreflight: an uncovered component fails with remediation guidance', () => {
  const root = makeFixture({ components: ['src/components/Orphan.tsx'] });
  try {
    const { failures } = runPreflight(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /no sourcing-preflight record/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Regression: agent-settings#780 sibling. parseRecord read ONLY the label line, so a
// field value that wrapped onto a continuation line was cut at the line break and a
// value written entirely below its label read as MISSING. These two records are
// identical but for one line break, and before the fix the second one failed.
const WRAPPED_RECORD = VALID_RECORD.replace(
  '- Chosen source lane and why: vendored primitive, matches house conventions',
  '- Chosen source lane and why:\n  vendored primitive, matches house conventions',
);

test('runPreflight: a field value written on a continuation line is still read', () => {
  const root = makeFixture({ components: ['src/components/Foo.tsx'], record: WRAPPED_RECORD });
  try {
    const { failures } = runPreflight(root);
    assert.deepEqual(failures, [], 'a wrapped field value must not read as missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Guards the OPPOSITE error: an over-greedy continuation that swallows the following
// field would make a genuinely missing field look present, turning the fix into a new
// fail-open. The wrap here sits directly above a field that has been deleted.
const WRAPPED_THEN_MISSING_RECORD = WRAPPED_RECORD.replace(
  '- License/access/dependency result: MIT, no new dependencies\n',
  '',
);

test('runPreflight: a continuation does not swallow the next field', () => {
  const root = makeFixture({ components: ['src/components/Foo.tsx'], record: WRAPPED_THEN_MISSING_RECORD });
  try {
    const { failures } = runPreflight(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /license\/access\/dependency result/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
