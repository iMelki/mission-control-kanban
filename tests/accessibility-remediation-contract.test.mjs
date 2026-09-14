/**
 * Source-level contract for the #150 / #152 remediation hunks re-applied on
 * 2026-09-14 from the unpushed 2026-08-30 clone (see
 * docs/a11y-baseline-2026-08-24.md and OPEN_TASKS.md for the defect map).
 *
 * This is a text contract, not a measurement: it pins the shapes that the
 * a11y probe and axe were measuring so a refactor cannot silently restore the
 * old markup. The proof that the defects are gone is the caller-faithful probe
 * sweep on a production serve, which this test does not replace.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('#150: settings fields reuse the shared Input focus contract', () => {
  const input = source('src/components/ui/input.tsx');
  const settings = source('src/app/settings/page.tsx');

  assert.match(input, /data-slot="input"/);
  assert.match(input, /focus-visible:ring-2 focus-visible:ring-mc-accent/);
  assert.match(input, /transition-colors/);
  assert.doesNotMatch(input, /transition-\[[^\]]*box-shadow/);
  assert.match(input, /aria-\[invalid=true\]:border-mc-accent-red/);
  assert.equal([...settings.matchAll(/<Input\b/g)].length, 4);
  // The old shared className suppressed the outline with no replacement ring.
  assert.doesNotMatch(settings, /focus:outline-none/);
});

test('#152 nested-interactive / #150 lead: task cards expose sibling open and reorder buttons', () => {
  const queue = source('src/components/MissionQueue.tsx');
  const taskCard = queue.slice(queue.indexOf('function TaskCard('));

  assert.match(taskCard, /data-task-card/);
  assert.match(taskCard, /data-task-drag-handle/);
  assert.match(taskCard, /data-task-open/);
  // The card wrapper is no longer a clickable role="button" around the
  // dnd-kit handle (axe nested-interactive, MissionQueue.tsx:480 on dev).
  assert.doesNotMatch(taskCard, /role="button"/);
  // The drag handle used to be opacity-0 lifted only by group-hover, so a
  // keyboard user could focus a labelled, invisible control (#150 lead).
  const handle = taskCard.slice(taskCard.indexOf('data-task-drag-handle'), taskCard.indexOf('</button>'));
  assert.match(handle, /focus-visible:opacity-100/);
  assert.match(handle, /focus-visible:ring-2/);
  // The timestamp keeps the solid muted token landed in e3de15d (#151).
  assert.match(taskCard, /text-\[10px\] text-mc-text-muted/);
  assert.doesNotMatch(taskCard, /text-mc-text-secondary\/60/);
});

test('#152 scrollable-region-focusable: the board scroller and live feed are keyboard-scrollable', () => {
  const queue = source('src/components/MissionQueue.tsx');
  const liveFeed = source('src/components/LiveFeed.tsx');

  assert.match(queue, /aria-label="Mission queue board"/);
  assert.match(liveFeed, /aria-label="Live feed events"/);
  for (const [name, text] of [['MissionQueue', queue], ['LiveFeed', liveFeed]]) {
    const region = text.slice(text.indexOf('role="region"'));
    assert.ok(region.length > 0, `${name} declares a role="region" scroll container`);
    assert.match(region.slice(0, 400), /tabIndex=\{0\}/, `${name} region is focusable`);
    assert.match(region.slice(0, 400), /focus-visible:ring-2/, `${name} region shows a focus ring`);
  }
});

test('#152 link-name and env-diagnostics group are named', () => {
  const header = source('src/components/Header.tsx');
  const diagnostics = source('src/components/runtime/RuntimeConfigTemplateGallery.tsx');

  assert.match(header, /aria-label="Back to all workspaces"/);
  // aria-label on a bare <div> is prohibited (generic role); the group role
  // makes the existing label legitimate.
  assert.match(diagnostics, /role="group"/);
});

test('the runtime UI smoke locates cards by the new open button, not the removed role', () => {
  const smoke = source('scripts/smoke-runtime-ui.js');

  assert.doesNotMatch(smoke, /li > \[role="button"\]/);
  assert.equal([...smoke.matchAll(/li \[data-task-open\]/g)].length, 2);
});
