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
  buildBoardAnnouncements,
  countGatedInbox,
  countNeedsYou,
  createMoveSequencer,
  decideSettledMove,
  decideMove,
  isDispatchBlockedInbox,
  isGatedByDispatchContract,
  moveLeavesNeedsYouFilter,
  needsCaptain,
  needsYouTasks,
  presentNeedsYouCountDescription,
  railToneFor,
  showsDispatchContractInboxBanner,
  workspaceScopedTasks,
  type AttentionTask,
} from '../src/lib/board-attention';
import { validateDispatchMetadata } from '../src/lib/dispatch-contract';
import type { DispatchMetadata, TaskStatus } from '../src/lib/types';

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

const settleLane = (status: TaskStatus) => ({ inbox: 'Inbox', assigned: 'Assigned', in_progress: 'In progress', review: 'Review' } as Record<string, string>)[status] ?? status;

test('Settled move announces and plays ink only after a successful PATCH', () => {
  const decision = decideSettledMove({
    ok: true, isLatestMove: true, currentStatus: 'review', originStatus: 'in_progress', targetStatus: 'review', title: 'Ship the board', laneName: settleLane,
  });
  assert.deepEqual(decision, { revertTo: null, playInk: true, successAnnouncement: 'Moved Ship the board to Review.', failureMessage: null });
});

test('Failed PATCH reverts, says the card stayed (alert only) and does not play ink', () => {
  const decision = decideSettledMove({
    ok: false, isLatestMove: true, currentStatus: 'review', originStatus: 'in_progress', targetStatus: 'review', title: 'Ship the board', laneName: settleLane,
  });
  assert.deepEqual(decision, {
    revertTo: 'in_progress',
    playInk: false,
    successAnnouncement: null,
    failureMessage: 'Ship the board was not moved. It stayed in In progress.',
  });
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
  // A description for the button, not a live region that speaks a bare number on every update.
  assert.match(queue, /<span id="needs-you-count" className="sr-only">/);
  assert.doesNotMatch(queue, /id="needs-you-count"[^>]*(aria-live|role=)/);
  assert.match(queue, /presentNeedsYouCountDescription\(boardLoadStatus, needsYouCount\)/);
  assert.match(queue, /decideSettledMove\(\{/);
  // The count and loading words must not be concatenated into the name.
  assert.doesNotMatch(button, /aria-label=\{?[`'"]Needs you.*\{needsYouCount\}/);
  assert.doesNotMatch(queue, /showing only these/);
});

// --- Independent review of 04d6a46 (third Low): rails, gated count, gate + announcements, rollback ---

const byId = (id: string) => fixtures.find((candidate) => candidate.id === id)!;

test('isDispatchBlockedInbox and needsCaptain hold only GitHub-sourced blocked Inbox work (fails without the github_source check)', () => {
  assert.equal(isDispatchBlockedInbox(byId('gh-inbox-blocked')), true);
  assert.equal(needsCaptain(byId('gh-inbox-blocked')), true);
  assert.equal(isDispatchBlockedInbox(byId('local-inbox-blocked')), false);
  assert.equal(needsCaptain(byId('local-inbox-blocked')), false);
  assert.equal(isDispatchBlockedInbox(byId('gh-inbox-ready')), false);
  assert.equal(needsCaptain(byId('review-a')), true);
  assert.equal(needsCaptain(byId('in-progress-a')), false);
});

test('railToneFor: warn only for gated GitHub Inbox, then status tones', () => {
  assert.equal(railToneFor(byId('gh-inbox-blocked')), 'warn');
  assert.equal(railToneFor(byId('local-inbox-blocked')), 'neutral');
  assert.equal(railToneFor(byId('gh-inbox-ready')), 'neutral');
  assert.equal(railToneFor(byId('review-a')), 'needs-you');
  assert.equal(railToneFor(byId('in-progress-a')), 'active');
  assert.equal(railToneFor(task({ id: 't', status: 'testing' })), 'active');
  assert.equal(railToneFor(task({ id: 'd', status: 'done' })), 'done');
  assert.equal(railToneFor(task({ id: 'a', status: 'assigned' })), 'neutral');
  // Blockers only gate Inbox: a GitHub Review card keeps the needs-you rail.
  assert.equal(railToneFor(task({ id: 'r', status: 'review', github_source: githubSource, dispatch_blockers: ['x'] })), 'needs-you');
});

const READY_CONTRACT: DispatchMetadata = {
  target_repo: 'iMelki/mission-control-kanban',
  project_workstream: 'Board',
  allowed_file_scope: ['src/components/**'],
  acceptance_criteria: ['Card moves'],
  test_requirements: ['npm run test:board-attention'],
  risk_level: 'low',
  readiness: 'ready_for_agent',
  review_mode: 'human_required',
  impact: 'UI only',
  rollback_plan: 'Revert the commit',
};

/** Build a card the way the API does: dispatch_blockers come from validateDispatchMetadata. */
function apiCard(id: string, workspace: string, github: boolean, contract: DispatchMetadata | undefined) {
  return {
    id,
    title: id,
    status: 'inbox' as TaskStatus,
    workspace_id: workspace,
    github_source: github ? githubSource : undefined,
    dispatch_metadata: contract,
    dispatch_blockers: validateDispatchMetadata(contract).blockers,
  };
}

test('"gated in Inbox" counts exactly the cards the move gate refuses, per workspace', () => {
  const cards = [
    apiCard('gh-no-contract-a', 'ws-a', true, undefined),
    apiCard('gh-ready-a', 'ws-a', true, READY_CONTRACT),
    apiCard('gh-partial-a', 'ws-a', true, { ...READY_CONTRACT, readiness: 'needs_grooming' }),
    apiCard('local-no-contract-a', 'ws-a', false, undefined),
    apiCard('gh-no-contract-b', 'ws-b', true, undefined),
  ];
  // The same fixtures feed both functions, and they must agree card by card.
  for (const card of cards) {
    assert.equal(isDispatchBlockedInbox(card), isGatedByDispatchContract(card, 'assigned'), card.id);
  }
  const refusedIn = (ws?: string) => cards.filter((card) => (!ws || card.workspace_id === ws) && isGatedByDispatchContract(card, 'assigned')).length;
  assert.equal(countGatedInbox(cards, 'ws-a'), refusedIn('ws-a'));
  assert.equal(countGatedInbox(cards, 'ws-a'), 2);
  assert.equal(countGatedInbox(cards, 'ws-b'), refusedIn('ws-b'));
  assert.equal(countGatedInbox(cards), refusedIn());
});

const LANES: Record<TaskStatus, string> = {
  planning: 'Planning',
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In progress',
  testing: 'Testing',
  review: 'Review',
  done: 'Done',
};

const gatedCard = { id: 'gh-1', title: 'Imported issue', status: 'inbox' as TaskStatus, github_source: githubSource };
const localCard = { id: 'local-1', title: 'Local note', status: 'inbox' as TaskStatus, github_source: undefined };

function dropEnd(cards: { id: string; title: string; status: TaskStatus; github_source?: typeof githubSource }[], activeId: string, overId: string | null) {
  const announcements = buildBoardAnnouncements({
    tasks: cards,
    resolveTargetStatus: (id) => (id in LANES ? (id as TaskStatus) : cards.find((card) => card.id === id)?.status ?? null),
    laneLabel: (status) => LANES[status],
  });
  return announcements.onDragEnd({
    active: { id: activeId },
    over: overId ? { id: overId } : null,
  } as unknown as Parameters<typeof announcements.onDragEnd>[0]);
}

test('a gated GitHub card is refused by the move gate and announced as refused, never as moving', () => {
  assert.equal(isGatedByDispatchContract(gatedCard, 'assigned'), true);
  assert.equal(decideMove(gatedCard, 'assigned'), 'gated');
  const spoken = dropEnd([gatedCard], gatedCard.id, 'assigned');
  assert.equal(spoken, 'Imported issue cannot move to Assigned yet: the dispatch contract is incomplete.');
  assert.doesNotMatch(spoken ?? '', /Mov(ed|ing)/);
});

test('a local card is not gated: the drop is announced as pending ("Moving"), not done', () => {
  assert.equal(isGatedByDispatchContract(localCard, 'assigned'), false);
  assert.equal(decideMove(localCard, 'assigned'), 'move');
  assert.equal(dropEnd([localCard], localCard.id, 'assigned'), 'Moving Local note to Assigned.');
  assert.equal(dropEnd([localCard], localCard.id, 'inbox'), 'Local note stayed in Inbox.');
  assert.equal(decideMove(localCard, 'inbox'), 'stay');
  assert.equal(dropEnd([localCard], localCard.id, null), 'Local note was dropped outside the board.');
});

/**
 * A miniature of MissionQueue's move path: optimistic update, then settle the PATCH
 * answer with the real sequencer and decideSettledMove against the live store.
 */
function moveHarness(initial: TaskStatus) {
  const store = { status: initial };
  const sequencer = createMoveSequencer();
  const spoken: string[] = [];
  const start = (target: TaskStatus) => {
    const origin = store.status;
    const seq = sequencer.begin('a');
    store.status = target; // optimistic
    return (ok: boolean) => {
      const decision = decideSettledMove({
        ok,
        isLatestMove: sequencer.isLatest('a', seq),
        currentStatus: store.status,
        originStatus: origin,
        targetStatus: target,
        title: 'A',
        laneName: (status) => LANES[status],
      });
      if (decision.revertTo) store.status = decision.revertTo;
      for (const text of [decision.successAnnouncement, decision.failureMessage]) if (text) spoken.push(text);
      return decision;
    };
  };
  return { store, start, spoken };
}

test('a failed PATCH rolls the card back to its original lane; a saved one settles in the target', () => {
  const failed = moveHarness('inbox');
  failed.start('assigned')(false);
  assert.equal(failed.store.status, 'inbox');
  assert.deepEqual(failed.spoken, ['A was not moved. It stayed in Inbox.']);

  const saved = moveHarness('inbox');
  saved.start('assigned')(true);
  assert.equal(saved.store.status, 'assigned');
  assert.deepEqual(saved.spoken, ['Moved A to Assigned.']);
});

test('race: an older move failing after a newer move succeeded does not snap the card back', () => {
  const h = moveHarness('inbox');
  const first = h.start('assigned'); // Inbox -> Assigned, PATCH pending
  const second = h.start('in_progress'); // Assigned -> In progress
  second(true);
  const late = first(false); // the first PATCH fails last
  assert.equal(late.revertTo, null);
  assert.equal(h.store.status, 'in_progress');
  assert.deepEqual(h.spoken, ['Moved A to In progress.']);
});

test('race: an SSE update while the PATCH is pending wins over the failed move\'s revert', () => {
  const h = moveHarness('inbox');
  const settle = h.start('assigned');
  h.store.status = 'review'; // task_updated from the server lands meanwhile
  const decision = settle(false);
  assert.equal(decision.revertTo, null);
  assert.equal(h.store.status, 'review');
  assert.deepEqual(h.spoken, ['A was not moved to Assigned. It is in Review.']);
});

test('a move out of the "Needs you" filter is detected so focus can fall back to the board', () => {
  assert.equal(moveLeavesNeedsYouFilter(byId('review-a'), 'done', true), true);
  assert.equal(moveLeavesNeedsYouFilter(byId('review-a'), 'done', false), false);
  assert.equal(moveLeavesNeedsYouFilter(byId('in-progress-a'), 'review', true), false);
  // A gated GitHub card moving within Inbox-blocked state stays in the filter.
  assert.equal(moveLeavesNeedsYouFilter(byId('gh-inbox-blocked'), 'inbox', true), false);
});

test('the drag handle opts out of browser touch scrolling so PointerSensor drags are not cancelled', () => {
  assert.match(source('src/components/board/task-card.tsx'), /data-task-drag-handle[\s\S]*?className="[^"]*\btouch-none\b/);
});

test('MissionQueue settles every PATCH answer through the sequencer and decideSettledMove, and applies its revert', () => {
  const queue = source('src/components/MissionQueue.tsx');
  assert.match(queue, /const seq = moveSequencer\.begin\(task\.id\);/);
  assert.match(queue, /isLatestMove: moveSequencer\.isLatest\(task\.id, seq\)/);
  assert.match(queue, /currentStatus: useMissionControl\.getState\(\)\.tasks/);
  assert.match(queue, /if \(decision\.revertTo\) updateTaskStatus\(task\.id, decision\.revertTo\);/);
  assert.match(queue, /settle\(true\)/);
  assert.match(queue, /settle\(false, /);
  // No direct revert to the drag-start status remains.
  assert.doesNotMatch(queue, /updateTaskStatus\(task\.id, task\.status\)/);
});

test('each move outcome has one announcement channel and a title that matches its cause', () => {
  const queue = source('src/components/MissionQueue.tsx');
  // Gated drops are spoken by dnd-kit's polite announcement; the box is only assertive for failed saves.
  assert.match(queue, /role=\{dropError\.kind === 'save-failed' \? 'alert' : undefined\}/);
  assert.match(queue, /dropError\.kind === 'gated' \? 'Dispatch move blocked' : 'Move not saved'/);
  // Failures do not also go to the polite region.
  assert.match(queue, /if \(decision\.successAnnouncement\) setMoveAnnouncement\(decision\.successAnnouncement\);/);
  assert.doesNotMatch(queue, /setMoveAnnouncement\(decision\.failureMessage/);
});
