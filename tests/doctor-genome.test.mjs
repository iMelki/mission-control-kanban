import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const genome = JSON.parse(readFileSync(resolve(repoRoot, 'doctor.genome.json'), 'utf8'));
const mirrorPath = resolve(repoRoot, 'docs/schemas/doctor-genome.v1.json');
const mirrorBytes = readFileSync(mirrorPath);
const schema = JSON.parse(mirrorBytes.toString('utf8'));

// The authority is git-toolkit's vendored copy of the canonical contract, which
// lives in the private iMelki/projects-ops repository. That copy validates every
// genome at pre-commit, and it accepts only the projects-ops URI. Pointing the
// genome at this repo's own mirror instead made the repository accept no commit
// at all (issue #149): the classifier validates the BASELINE, so the repair for
// the field was itself blocked by the field. The digest below is the canonical
// document's SHA-256, so this mirror cannot silently diverge again.
const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
const CANONICAL_SCHEMA_URI =
  'https://raw.githubusercontent.com/iMelki/projects-ops/main/docs/schemas/doctor-genome.v1.json';
const CANONICAL_SCHEMA_SHA256 =
  'afe8676e1c3c78c8d3c2a52915bea4246a09da2f82770fbe115ee2722323d272';

test('Doctor genome declares the canonical pinned schema URI', () => {
  assert.equal(genome.$schema, CANONICAL_SCHEMA_URI);
});

test('the local schema copy is a byte-faithful mirror of the canonical contract', () => {
  // Hash LF-normalised bytes: the path is pinned to `eol=lf` in .gitattributes,
  // but a checkout that ignored that must report real drift, not a CRLF artefact.
  const normalised = Buffer.from(mirrorBytes.toString('utf8').split(CRLF).join(LF), 'utf8');
  const digest = createHash('sha256').update(normalised).digest('hex');
  assert.equal(
    digest,
    CANONICAL_SCHEMA_SHA256,
    'docs/schemas/doctor-genome.v1.json has drifted from the canonical projects-ops contract. ' +
      'A mirror that edits the contract it mirrors is not a mirror, and git-toolkit will not honour it.',
  );
  assert.equal(schema.$id, CANONICAL_SCHEMA_URI);
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
});

test('the mirrored $schema pattern accepts the canonical URI and rejects the self-reference', () => {
  const acceptedSchemaUri = new RegExp(schema.properties.$schema.pattern);

  // Positive controls: both canonical branches are accepted.
  assert.equal(acceptedSchemaUri.test(CANONICAL_SCHEMA_URI), true);
  assert.equal(
    acceptedSchemaUri.test(
      'https://raw.githubusercontent.com/iMelki/projects-ops/dev/docs/schemas/doctor-genome.v1.json',
    ),
    true,
  );

  // Negative control: the exact string that locked this repository out of every
  // commit for three scoring rounds must stay rejected.
  assert.equal(
    acceptedSchemaUri.test(
      'https://raw.githubusercontent.com/iMelki/mission-control-kanban/dev/docs/schemas/doctor-genome.v1.json',
    ),
    false,
  );

  // The genome the repository actually ships must satisfy the pattern it ships.
  assert.equal(acceptedSchemaUri.test(genome.$schema), true);
});

test('Doctor authored-app coverage includes tracked TypeScript component barrels', () => {
  const authoredSource = genome.sourceSets.find((sourceSet) => sourceSet.id === 'authored-app-source');
  assert.ok(authoredSource);
  assert.ok(authoredSource.includeGlobs.includes('src/components/**/*.ts'));

  const trackedComponents = execFileSync('git', ['ls-files', 'src/components'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).split(/\r?\n/).filter(Boolean);
  assert.ok(trackedComponents.includes('src/components/index.ts'));
});
