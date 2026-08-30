import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('settings fields reuse the pinned Input focus contract', () => {
  const input = source('src/components/ui/input.tsx');
  const settings = source('src/app/settings/page.tsx');

  assert.match(input, /data-slot="input"/);
  assert.match(input, /focus-visible:ring-2 focus-visible:ring-mc-accent/);
  assert.match(input, /transition-colors/);
  assert.doesNotMatch(input, /transition-\[[^\]]*box-shadow/);
  assert.match(input, /aria-\[invalid=true\]:border-mc-accent-red/);
  assert.equal([...settings.matchAll(/<Input\b/g)].length, 4);
  assert.doesNotMatch(settings, /focus:outline-none/);
});

test('every workspace tab owns a mounted, inactive-hidden Radix panel', () => {
  const tabs = source('src/components/workspace/WorkspaceSectionTabs.tsx');
  const page = source('src/app/workspace/[slug]/page.tsx');

  assert.match(tabs, /<TabsContent/);
  assert.match(tabs, /forceMount/);
  assert.match(tabs, /hidden=!\{active\}|hidden=\{!active\}/);
  assert.match(tabs, /\{active \? children : null\}/);
  assert.equal([...page.matchAll(/<WorkspaceSectionContent\b/g)].length, 5);
});

test('task cards expose sibling open and reorder buttons', () => {
  const queue = source('src/components/MissionQueue.tsx');
  const taskCard = queue.slice(queue.indexOf('function TaskCard('));

  assert.match(taskCard, /data-task-card/);
  assert.match(taskCard, /data-task-drag-handle/);
  assert.match(taskCard, /data-task-open/);
  assert.match(queue, /aria-label="Mission queue board"/);
  assert.doesNotMatch(taskCard, /role="button"/);
  assert.doesNotMatch(taskCard, /text-mc-text-secondary\/60/);
});

test('navigation, diagnostics, scrolling, and offline contrast stay named', () => {
  const header = source('src/components/Header.tsx');
  const diagnostics = source('src/components/runtime/RuntimeConfigTemplateGallery.tsx');
  const table = source('src/components/ui/DataTable.tsx');
  const history = source('src/app/n8n-sync-history/page.tsx');
  const liveFeed = source('src/components/LiveFeed.tsx');
  const workspace = source('src/app/workspace/[slug]/page.tsx');

  assert.match(header, /aria-label="Back to all workspaces"/);
  assert.match(header, /bg-mc-accent-red\/20 border-mc-accent-red text-rose-200/);
  assert.match(diagnostics, /role="group"/);
  assert.match(table, /role="region"/);
  assert.match(history, /role="region"/);
  assert.match(liveFeed, /aria-label="Live feed events"/);
  assert.match(liveFeed, /tabIndex=\{0\}/);
  assert.match(table, /tabIndex=\{0\}/);
  assert.match(history, /tabIndex=\{0\}/);
  assert.doesNotMatch(workspace, /text-mc-text-secondary\/70/);
});

test('a11y self-proof parses painted shadow components and rejects contraction', () => {
  const probe = source('scripts/probe-surface-a11y.mjs');

  assert.match(probe, /shadow\.split\(\/,[^\n]+\.some/);
  assert.match(probe, /selfproof contracted outer shadow/);
  assert.match(probe, /authored color-contrast target/);
  assert.match(probe, /runAxeScan\(page, '#__a11y_selfproof'\)/);
  assert.match(probe, /delegatedRules: contextSelector \? \[\] : \['color-contrast'\]/);
  assert.match(probe, /selfproof repaired image/);
  assert.match(probe, /injectedFocusPass\.coverage\.population === 4/);
});
