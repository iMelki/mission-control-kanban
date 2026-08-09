#!/usr/bin/env node
/**
 * Component sourcing preflight gate (fleet pilot; tracked in #139, agent-settings#586).
 *
 * Every component file under src/components must be either:
 *   1. Grandfathered in docs/preflight/component-baseline.json ({file, reason}), or
 *   2. Covered by a "Covers:" line (exact path or glob) in at least one record under
 *      docs/preflight/records/*.md that carries all 7 sourcing-record fields from
 *      shared/prompts/frontend-component-sourcing.md with non-placeholder values.
 *
 * Ratchet-down: a baseline entry whose file no longer exists is also a failure —
 * remove the stale entry so the baseline only shrinks.
 *
 * Zero dependencies. Mirrors the field labels/aliases of
 * agent-settings shared/tools/Test-FrontendComponentSourcingPreflight.ps1.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentsDir = path.join(repoRoot, 'src', 'components');
const baselinePath = path.join(repoRoot, 'docs', 'preflight', 'component-baseline.json');
const recordsDir = path.join(repoRoot, 'docs', 'preflight', 'records');

const REQUIRED_FIELD_ALIASES = [
  ['target app/surface and component job', 'target app/surface', 'target surface', 'surface'],
  ['target-app component checked', 'target app component checked', 'target-app checked', 'target app checked'],
  ['component marketplace primitive checked', 'component marketplace checked', 'local component marketplace checked'],
  ['external pools checked or deliberately skipped', 'external pools checked or skipped', 'external pools checked', 'external pools'],
  ['chosen source lane and why', 'chosen source lane', 'source lane'],
  ['license/access/dependency result', 'license access dependency result', 'license/access/pricing/dependency result', 'license'],
  ['proof expected before closeout', 'proof expected', 'verification expected', 'closeout proof'],
];

function normalizeLabel(value) {
  return value
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9/ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeaningful(value) {
  const trimmed = (value ?? '').trim();
  if (trimmed.length < 3) return false;
  return !/^(todo|tbd|unknown|n\/?a|none|\?+|-+)$/i.test(trimmed);
}

function listComponentFiles(dir, prefix = 'src/components') {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listComponentFiles(path.join(dir, entry.name), rel));
    else if (/\.(tsx|jsx)$/.test(entry.name)) files.push(rel);
  }
  return files;
}

function parseRecord(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const fieldValues = new Map();
  const covers = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const match = rawLine.trim().match(/^(?:[-*]\s+|\d+\.\s+)?(.+?):\s*(.*)$/);
    if (!match) continue;
    const label = normalizeLabel(match[1]);
    if (label === 'covers') {
      for (const target of match[2].split(',')) {
        if (target.trim()) covers.push(target.trim().replace(/\\/g, '/'));
      }
      continue;
    }
    for (let i = 0; i < REQUIRED_FIELD_ALIASES.length; i++) {
      if (REQUIRED_FIELD_ALIASES[i].some((alias) => normalizeLabel(alias) === label) && !fieldValues.has(i)) {
        fieldValues.set(i, match[2].trim());
      }
    }
  }
  const missing = REQUIRED_FIELD_ALIASES
    .map((aliases, i) => (isMeaningful(fieldValues.get(i)) ? null : aliases[0]))
    .filter(Boolean);
  return { name: path.basename(filePath), valid: missing.length === 0, missing, covers };
}

function coversFile(pattern, file) {
  if (pattern === file) return true;
  if (!/[*?]/.test(pattern)) return false;
  const regex = pattern
    .split('**')
    .map((part) => part
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]'))
    .join('.*');
  return new RegExp(`^${regex}$`).test(file);
}

const components = listComponentFiles(componentsDir);
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : [];
const records = existsSync(recordsDir)
  ? readdirSync(recordsDir).filter((name) => name.endsWith('.md')).sort()
      .map((name) => parseRecord(path.join(recordsDir, name)))
  : [];

const failures = [];
const baselineFiles = new Set();
for (const entry of baseline) {
  const file = String(entry.file ?? '').replace(/\\/g, '/');
  baselineFiles.add(file);
  if (!components.includes(file)) {
    failures.push(`docs/preflight/component-baseline.json: baselined file ${file} no longer exists on disk. Remove its baseline entry (the baseline only ratchets down).`);
  }
}

for (const file of components) {
  if (baselineFiles.has(file)) continue;
  const validCover = records.some((record) => record.valid && record.covers.some((pattern) => coversFile(pattern, file)));
  if (validCover) continue;
  const invalidCover = records.find((record) => !record.valid && record.covers.some((pattern) => coversFile(pattern, file)));
  const hint = invalidCover
    ? ` (docs/preflight/records/${invalidCover.name} covers it but is missing/placeholder on: ${invalidCover.missing.join('; ')})`
    : '';
  failures.push(`${file}: new component with no sourcing-preflight record.${hint} Write docs/preflight/records/<date>-<slug>.md with the 7-field record from shared/prompts/frontend-component-sourcing.md plus a Covers: line naming this file; validate with Test-FrontendComponentSourcingPreflight.ps1 -RequireKnownPoolMention. Reviewed exception: add {file, reason} to docs/preflight/component-baseline.json.`);
}

if (failures.length > 0) {
  console.error('COMPONENT_SOURCING_PREFLIGHT=fail');
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`COMPONENT_SOURCING_PREFLIGHT=pass (${components.length} components: ${baselineFiles.size} baselined, ${components.length - baselineFiles.size} record-covered; ${records.length} records)`);
