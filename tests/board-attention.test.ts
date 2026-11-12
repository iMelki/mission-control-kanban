/**
 * Board-attention behaviour for mission-control-kanban#194: Needs you count and
 * filter, GitHub-sourced Inbox banner gating, and announce-after-PATCH /
 * ink-after-saved-move. Helpers are pure so this file runs under node --test.
 *
 * Named tests must appear by name in the CI job log.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DISPATCH_CONTRACT_INBOX_CHIP_LABEL,
  DISPATCH_CONTRACT_INBOX_GUIDANCE,
  NEEDS_YOU_ACCESSIBLE_NAME,
  applyNeedsYouFilter,
  countNeedsYou,
  isDispatchBlockedInbox,
  needsCaptain,
  needsYouTasks,
  presentNeedsYouCountDescription,
  settledMoveOutcome,
  showsDispatchContractInboxBanner,
  workspaceScopedTasks,
  type AttentionTask,
} from '../src/lib/board-attention';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function source(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

const githubSource = {
  repo_owner: 'iMelki',
  repo_name: 'mission-control-kanban',
  issue_number: 12,
  issue_url: 'https://github.com/iMelki/mission-control-kanban/issues/12',
};

function task(partial: Partial<AttentionTask> & Pick<AttentionTask, 'id' | 'status'>): AttentionTask {
  return {
    workspace_id: 'ws-a',
    ...partial,
  };
}

const fixtures: AttentionTask[] = [
  task({ id: 'review-a', status: 'review' }),
  task({ id: 'gh-inbox-blocked', status: 'inbox', github_source: githubSource, dispatch_blockers: ['Scope is missing'] }),
  task({ id: 'local-inbox-blocked', status: 'inbox', dispatch_blockers: ['Scope is missing'] }),
  task({ id: 'gh-inbox-ready', status: 'inbox', github_source: githubSource, dispatch_blockers: [] }),
  task({ id: 'in-progress-a', status: 'in_progress' }),
  task({ id: 'review-other-ws', status: 'review', workspace_id: 'ws-b' }),
  task({
    id: 'gh-inbox-other-ws',
    status: 'inbox',
    workspace_id: 'ws-b',
    github_source: githubSource,
    dispatch_blockers: ['Tests are missing'],
  }),
];

test('Needs you count includes Review and GitHub-sourced dispatch-blocked Inbox, workspace-scoped', () => {
  const count = countNeedsYou(fixtures, 'ws-a');
  assert.equal(count, 2);

  const ids = needsYouTasks(fixtures, 'ws-a').map((item) => item.id).sort();
  assert.deepEqual(ids, ['gh-inbox-blocked', 'review-a']);

  assert.equal(needsCaptain(fixtures[0]!), true, 'Review counts');
  assert.equal(needsCaptain(fixtures[1]!), true, 'GitHub-sourced dispatch-blocked Inbox counts');
  assert.equal(isDispatchBlockedInbox(fixtures[1]!), true);
});

test('Needs you filter keeps only Review and GitHub-sourced dispatch-blocked Inbox in the workspace', () => {
  const filtered = applyNeedsYouFilter(fixtures, true, 'ws-a');
  assert.deepEqual(filtered.map((item) => item.id).sort(), ['gh-inbox-blocked', 'review-a']);

  const unfiltered = applyNeedsYouFilter(fixtures, false, 'ws-a');
  assert.deepEqual(
    unfiltered.map((item) => item.id).sort(),
    workspaceScopedTasks(fixtures, 'ws-a').map((item) => item.id).sort(),
  );
  assert.equal(unfiltered.some((item) => item.id === 'local-inbox-blocked'), true);
  assert.equal(filtered.some((item) => item.id === 'local-inbox-blocked'), false);
});

test('Needs you count excludes local Inbox tasks that have dispatch_blockers', () => {
  const local = fixtures.find((item) => item.id === 'local-inbox-blocked')!;
  assert.equal(Boolean(local.github_source), false);
  assert.equal((local.dispatch_blockers?.length ?? 0) > 0, true);
  assert.equal(isDispatchBlockedInbox(local), false);
  assert.equal(needsCaptain(local), false);
  assert.equal(countNeedsYou([local], 'ws-a'), 0);
});

test('Needs you count excludes Review and blocked Inbox from other workspaces', () => {
  const scoped = countNeedsYou(fixtures, 'ws-a');
  const otherReview = fixtures.find((item) => item.id === 'review-other-ws')!;
  const otherBlocked = fixtures.find((item) => item.id === 'gh-inbox-other-ws')!;
  assert.equal(needsCaptain(otherReview), true);
  assert.equal(needsCaptain(otherBlocked), true);
  assert.equal(scoped, 2);
  assert.equal(countNeedsYou(fixtures, 'ws-b'), 2);
  assert.equal(countNeedsYou(fixtures), 4, 'no workspace id counts every workspace');
  assert.equal(
    needsYouTasks(fixtures, 'ws-a').some((item) => item.workspace_id !== 'ws-a'),
    false,
  );
});

test('Dispatch-contract Inbox banner is shown only when the task has github_source', () => {
  const githubBlocked = fixtures.find((item) => item.id === 'gh-inbox-blocked')!;
  assert.equal(showsDispatchContractInboxBanner(githubBlocked), true);
  assert.equal(showsDispatchContractInboxBanner({ ...githubBlocked, dispatch_blockers: [] }), false);
  assert.equal(showsDispatchContractInboxBanner({ ...githubBlocked, status: 'review' }), false);
  assert.equal(DISPATCH_CONTRACT_INBOX_CHIP_LABEL, 'Contract');
  assert.match(DISPATCH_CONTRACT_INBOX_GUIDANCE, /Dispatch Contract is complete/);
});

test('Dispatch-contract Inbox banner is hidden for locally created Inbox tasks', () => {
  const local = fixtures.find((item) => item.id === 'local-inbox-blocked')!;
  assert.equal(showsDispatchContractInboxBanner(local), false);
  assert.equal(showsDispatchContractInboxBanner(undefined), false);
  assert.equal(showsDispatchContractInboxBanner(null), false);
});

test('Settled move announces and plays ink only after a successful PATCH', () => {
  const outcome = settledMoveOutcome(true, 'Ship the board', 'Review', 'In progress');
  assert.equal(outcome.announcement, 'Moved Ship the board to Review.');
  assert.equal(outcome.playInk, true);
  assert.equal(outcome.revert, false);
});

test('Failed PATCH announces the card stayed and does not play ink', () => {
  const outcome = settledMoveOutcome(false, 'Ship the board', 'Review', 'In progress');
  assert.equal(outcome.announcement, 'Ship the board was not moved. It stayed in In progress.');
  assert.equal(outcome.playInk, false);
  assert.equal(outcome.revert, true);
});

test('Needs you count description lives outside the accessible name', () => {
  assert.equal(NEEDS_YOU_ACCESSIBLE_NAME, 'Needs you');
  assert.equal(presentNeedsYouCountDescription('ready', 3), '3');
  assert.equal(presentNeedsYouCountDescription('ready', 0), '0');
  assert.equal(presentNeedsYouCountDescription('pending', 0), 'loading');
  assert.equal(presentNeedsYouCountDescription('error', 0), 'unavailable');
  assert.equal(NEEDS_YOU_ACCESSIBLE_NAME.includes('3'), false);
  assert.equal(NEEDS_YOU_ACCESSIBLE_NAME.includes('loading'), false);
});

test('Task card face uses a compact contract chip instead of the instruction paragraph', () => {
  const card = source('src/components/board/task-card.tsx');
  const face = card.slice(card.indexOf('export function TaskCard('));
  assert.doesNotMatch(
    face,
    /Still in Inbox until the Dispatch Contract is complete\. Open the task to fill scope, tests, and rollback\./,
  );
  assert.match(face, /data-dispatch-contract-chip/);
  assert.match(face, /showsDispatchContractInboxBanner\(task\)/);
  assert.match(face, /title=\{DISPATCH_CONTRACT_INBOX_GUIDANCE\}/);
  assert.match(face, /DISPATCH_CONTRACT_INBOX_CHIP_LABEL/);

  const detail = source('src/components/task-modal/DispatchContractSection.tsx');
  assert.match(detail, /showsDispatchContractInboxBanner\(currentTask\)/);
  assert.match(detail, /DISPATCH_CONTRACT_INBOX_GUIDANCE/);
  assert.match(detail, /data-dispatch-contract-guidance/);
});

test('Mission Queue runtime chips, Import GitHub and New Task have focus-visible rings', () => {
  const queue = source('src/components/MissionQueue.tsx');
  const focusToken = /focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent focus-visible:ring-offset-2 focus-visible:ring-offset-mc-bg/;

  const chip = queue.slice(queue.indexOf('data-runtime-filter-chip'));
  assert.match(chip.slice(0, 800), focusToken, 'runtime chips use the existing focus token');

  const importGithub = queue.slice(queue.indexOf('Import GitHub') - 600, queue.indexOf('Import GitHub'));
  assert.match(importGithub, focusToken, 'Import GitHub uses the existing focus token');

  const newTaskButton = queue.slice(queue.indexOf('New Task') - 500, queue.indexOf('New Task'));
  assert.match(newTaskButton, focusToken, 'New Task uses the existing focus token');
});

test('Needs you and runtime chips have 44px touch targets at a 375px viewport', () => {
  const queue = source('src/components/MissionQueue.tsx');
  const needsYou = queue.slice(queue.indexOf('data-needs-you'), queue.indexOf('data-needs-you') + 900);
  assert.match(needsYou, /min-h-11/, 'Needs you is at least Tailwind min-h-11 (44px)');
  assert.match(needsYou, /min-w-11/);
  assert.doesNotMatch(needsYou.slice(0, 500), /min-h-7/);

  const chip = queue.slice(queue.indexOf('data-runtime-filter-chip'), queue.indexOf('data-runtime-filter-chip') + 800);
  assert.match(chip, /min-h-11/, 'runtime chips are at least Tailwind min-h-11 (44px)');
  assert.match(chip, /min-w-11/);
});

test('Drag handle stays visible on coarse pointers', () => {
  const card = source('src/components/board/task-card.tsx');
  const handle = card.slice(card.indexOf('data-task-drag-handle'), card.indexOf('</button>'));
  assert.match(handle, /opacity-0/);
  assert.match(handle, /\[@media\(hover:none\)\]:opacity-100/);
  assert.match(handle, /focus-visible:opacity-100/);
});

test('Needs you has a constant accessible name with the count outside the name', () => {
  const queue = source('src/components/MissionQueue.tsx');
  const button = queue.slice(queue.indexOf('data-needs-you'), queue.indexOf('id="needs-you-count"') + 400);
  assert.match(button, /aria-label=\{NEEDS_YOU_ACCESSIBLE_NAME\}/);
  assert.match(button, /aria-describedby="needs-you-count"/);
  assert.match(queue, /id="needs-you-count"[^>]*aria-live="polite"/);
  assert.match(queue, /presentNeedsYouCountDescription\(boardLoadStatus, needsYouCount\)/);
  assert.match(queue, /settledMoveOutcome\(true,/);
  assert.match(queue, /settledMoveOutcome\(false,/);
  // The count and loading words must not be concatenated into the name.
  assert.doesNotMatch(button, /aria-label=\{?[`'"]Needs you.*\{needsYouCount\}/);
  assert.doesNotMatch(queue, /showing only these/);
});
