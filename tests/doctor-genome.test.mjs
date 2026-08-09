import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const genome = JSON.parse(readFileSync(resolve(repoRoot, 'doctor.genome.json'), 'utf8'));
const schema = JSON.parse(readFileSync(resolve(repoRoot, 'docs/schemas/doctor-genome.v1.json'), 'utf8'));

test('Doctor genome uses the public versioned schema distribution mirror', () => {
  assert.equal(
    genome.$schema,
    'https://raw.githubusercontent.com/iMelki/mission-control-kanban/dev/docs/schemas/doctor-genome.v1.json',
  );
  assert.equal(schema.$id, genome.$schema);
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.match(schema.$comment, /Canonical source: iMelki\/projects-ops/);
  assert.equal(
    schema['x-canonical-source-sha256'],
    'afe8676e1c3c78c8d3c2a52915bea4246a09da2f82770fbe115ee2722323d272',
  );

  const acceptedSchemaUri = new RegExp(schema.properties.$schema.pattern);
  assert.equal(acceptedSchemaUri.test(genome.$schema), true);
  assert.equal(
    acceptedSchemaUri.test(
      'https://raw.githubusercontent.com/iMelki/mission-control-kanban/main/docs/schemas/doctor-genome.v1.json',
    ),
    true,
  );
  assert.equal(
    acceptedSchemaUri.test(
      'https://raw.githubusercontent.com/iMelki/projects-ops/main/docs/schemas/doctor-genome.v1.json',
    ),
    false,
  );
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
