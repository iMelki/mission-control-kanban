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
import { createMoveController, type MoveOutcome, type PatchStatusResult } from '../src/lib/board-move-controller';
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

// --- Round-2 independent review of 0613e36: drop decision, server reconciliation, timeout, announcements ---

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A board store plus a controller wired the way MissionQueue wires it. */
function board(initial: TaskStatus, options: {
  patch?: (status: TaskStatus, signal: AbortSignal) => Promise<PatchStatusResult>;
  read?: (signal: AbortSignal) => Promise<TaskStatus | null>;
  saveTimeoutMs?: number;
} = {}) {
  const card = { id: 'a', title: 'A', status: initial, github_source: undefined, dispatch_metadata: undefined };
  const outcomes: MoveOutcome[] = [];
  const pendingLog: boolean[] = [];
  const controller = createMoveController({
    getStatus: () => card.status,
    setStatus: (_id, status) => { card.status = status; },
    patchStatus: (_id, status, signal) => (options.patch ?? (async () => ({ ok: true, status })))(status, signal),
    readStatus: (_id, signal) => (options.read ?? (async () => null))(signal),
    onPendingChange: (_id, isPending) => pendingLog.push(isPending),
    onOutcome: (outcome) => outcomes.push(outcome),
    saveTimeoutMs: options.saveTimeoutMs,
    readTimeoutMs: 50,
  });
  /** A status from the server while the save is pending (SSE task_updated): store write + observation. */
  const serverPush = (status: TaskStatus) => { card.status = status; controller.observeServerStatus('a', status); };
  return { card, controller, outcomes, pendingLog, serverPush };
}

function boardAnnouncements(b: ReturnType<typeof board>) {
  return buildBoardAnnouncements({
    tasks: [b.card],
    resolveTargetStatus: (id) => (id in LANES ? (id as TaskStatus) : null),
    laneLabel: (status) => LANES[status],
    isSaving: (id) => b.controller.isSaving(id),
    decisionFor: (id, target) => b.controller.recordedDecision(id, target),
  });
}

const onDragEndArgs = (overId: string) => ({ active: { id: 'a' }, over: { id: overId } }) as unknown as Parameters<NonNullable<ReturnType<typeof buildBoardAnnouncements>['onDragEnd']>>[0];

test('dnd-kit order (onDragEnd -> save starts -> announcement): a valid drop says "Moving", a drop while saving says "still being saved"', () => {
  const pendingPatch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => pendingPatch.promise });
  const announcements = boardAnnouncements(b);

  // 1. DndContext's onDragEnd prop: decide once, then the save starts (begin happens synchronously).
  const first = b.controller.recordDrop(b.card, 'assigned');
  assert.equal(first, 'move');
  void b.controller.start(b.card, 'assigned');
  assert.equal(b.controller.isSaving('a'), true);
  // 2. Then dnd-kit's announcement runs, in the same batch.
  assert.equal(announcements.onDragEnd(onDragEndArgs('assigned')), 'Moving A to Assigned.');

  // A second drop while the first save is pending is a real refusal.
  const second = b.controller.recordDrop(b.card, 'in_progress');
  assert.equal(second, 'saving');
  assert.equal(announcements.onDragEnd(onDragEndArgs('in_progress')), 'A is still being saved. It stayed in Assigned.');
  pendingPatch.resolve({ ok: true, status: 'assigned' });
});

test('without the recorded drop decision the announcement would wrongly say "still being saved" (guards the fix)', () => {
  const b = board('inbox', { patch: () => new Promise(() => {}) });
  void b.controller.start(b.card, 'assigned');
  const unrecorded = buildBoardAnnouncements({
    tasks: [{ ...b.card, status: 'inbox' }],
    resolveTargetStatus: (id) => id as TaskStatus,
    laneLabel: (status) => LANES[status],
    isSaving: (id) => b.controller.isSaving(id),
  });
  assert.match(unrecorded.onDragEnd(onDragEndArgs('assigned')) ?? '', /still being saved/);
  const queue = source('src/components/MissionQueue.tsx');
  assert.match(queue, /decisionFor: \(taskId, target\) => moveController\.recordedDecision\(taskId, target\)/);
  assert.match(queue, /runMove\(task, targetStatus, moveController\.recordDrop\(task, targetStatus\)\)/);
});

test('a saved move commits once, unlocks the card and reports "saved"', async () => {
  const b = board('inbox');
  await b.controller.start(b.card, 'assigned');
  assert.equal(b.card.status, 'assigned');
  assert.equal(b.controller.isSaving('a'), false);
  assert.deepEqual(b.pendingLog, [true, false]);
  assert.deepEqual(b.outcomes.map((o) => [o.kind, o.status]), [['saved', 'assigned']]);
});

test('a refused PATCH adopts the server status from the re-read, never a guess', async () => {
  const b = board('inbox', { patch: async () => ({ ok: false, error: 'Validation failed' }), read: async () => 'inbox' });
  await b.controller.start(b.card, 'assigned');
  assert.equal(b.card.status, 'inbox');
  assert.equal(b.outcomes[0].kind, 'not-saved');
});

test('the PATCH commits and SSE says target, then the response is lost: the card stays in target', async () => {
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => 'assigned' });
  const run = b.controller.start(b.card, 'assigned');
  b.serverPush('assigned'); // task_updated broadcast after the commit
  patch.reject(new TypeError('Failed to fetch'));
  await run;
  assert.equal(b.card.status, 'assigned');
  assert.equal(b.outcomes[0].kind, 'saved');
});

test('the same, with the re-read failing too: the SSE-confirmed target wins over the optimistic origin', async () => {
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => { throw new Error('offline'); } });
  const run = b.controller.start(b.card, 'assigned');
  b.serverPush('assigned');
  patch.reject(new Error('SQLITE_BUSY'));
  await run;
  assert.equal(b.card.status, 'assigned');
  assert.equal(b.outcomes[0].kind, 'saved');
});

test('an SSE update to another lane while the save is pending is adopted when the save fails', async () => {
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => null });
  const run = b.controller.start(b.card, 'assigned');
  b.serverPush('review');
  patch.resolve({ ok: false, error: 'Conflict' });
  await run;
  assert.equal(b.card.status, 'review');
  assert.equal(b.outcomes[0].kind, 'unknown');
});

test('save and re-read both fail with no server news: the card shows the last confirmed lane and offers a retry', async () => {
  const b = board('inbox', { patch: async () => { throw new TypeError('Failed to fetch'); }, read: async () => { throw new TypeError('Failed to fetch'); } });
  await b.controller.start(b.card, 'assigned');
  assert.equal(b.card.status, 'inbox');
  const outcome = b.outcomes[0];
  assert.equal(outcome.kind, 'unknown');
  assert.equal(outcome.kind === 'unknown' && outcome.target, 'assigned');
  const queue = source('src/components/MissionQueue.tsx');
  assert.match(queue, /retry: \{ taskId: outcome\.taskId, target: outcome\.target \}/);
  assert.match(queue, /Retry move/);
});

test('a save that never answers times out, unlocks the card and reconciles from the server', async () => {
  let aborted = false;
  const b = board('inbox', {
    saveTimeoutMs: 30,
    patch: (_status, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); })),
    read: async () => 'inbox',
  });
  await b.controller.start(b.card, 'assigned');
  assert.equal(aborted, true);
  assert.equal(b.controller.isSaving('a'), false);
  assert.equal(b.card.status, 'inbox');
  assert.equal(b.outcomes[0].kind, 'not-saved');
  assert.match(b.outcomes[0].kind === 'not-saved' ? b.outcomes[0].error : '', /No answer from the server/);
});

test('a hung save that ignores the abort signal still unlocks at the deadline', async () => {
  const b = board('inbox', { saveTimeoutMs: 30, patch: () => new Promise(() => {}), read: async () => 'assigned' });
  await b.controller.start(b.card, 'assigned');
  assert.equal(b.controller.isSaving('a'), false);
  assert.equal(b.outcomes[0].kind, 'saved');
});

test('the save timeout is a documented 15 s constant and the PATCH carries its AbortSignal', () => {
  const controllerSource = source('src/lib/board-move-controller.ts');
  assert.match(controllerSource, /export const MOVE_SAVE_TIMEOUT_MS = 15_000;/);
  assert.match(source('src/components/MissionQueue.tsx'), /body: JSON\.stringify\(\{ status \}\),\n\s+signal,/);
});

test('a dialog save of a card waits for its pending drag save (waitForIdle)', async () => {
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise });
  void b.controller.start(b.card, 'assigned');
  let dialogSaved = false;
  const dialog = b.controller.waitForIdle('a').then(() => { dialogSaved = true; });
  await Promise.resolve();
  assert.equal(dialogSaved, false);
  patch.resolve({ ok: true, status: 'assigned' });
  await dialog;
  assert.equal(dialogSaved, true);
  assert.match(source('src/components/TaskModal.tsx'), /if \(currentTask && beforeSave\) await beforeSave\(currentTask\.id\);\n\s+const url = currentTask/);
  assert.match(source('src/components/MissionQueue.tsx'), /beforeSave=\{\(taskId\) => moveController\.waitForIdle\(taskId\)\}/);
});

test('a card whose save is pending is shown busy', () => {
  const card = source('src/components/board/task-card.tsx');
  assert.match(card, /aria-busy=\{isSaving \|\| undefined\}/);
  assert.match(card, /data-task-saving/);
  assert.match(source('src/components/board/board-lane.tsx'), /isSaving=\{savingTaskIds\?\.has\(task\.id\) \?\? false\}/);
});

test('each move outcome is spoken once, and successes are appended rather than replaced', () => {
  const queue = source('src/components/MissionQueue.tsx');
  // Gated drops: dnd-kit's polite announcement only. Failed saves: the alert only.
  assert.match(queue, /role=\{dropError\.kind === 'save-failed' \? 'alert' : undefined\}/);
  assert.match(queue, /dropError\.kind === 'gated' \? 'Dispatch move blocked' : 'Move not saved'/);
  // "Showing x/y" is plain text, not a second live region.
  assert.doesNotMatch(queue, /role="status">\s*\{presentBoardCount/);
  // One polite region that appends each success; a new move does not clear an earlier one.
  assert.match(queue, /aria-relevant="additions"/);
  assert.match(queue, /setMoveAnnouncements\(\(previous\) => \[\.\.\.previous\.slice\(-4\), \{ id, text \}\]\)/);
  assert.doesNotMatch(queue, /setMoveAnnouncement\(''\)/);
});

test('a successful PATCH after other server news re-reads instead of trusting either one', async () => {
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => 'assigned' });
  const run = b.controller.start(b.card, 'assigned');
  b.serverPush('inbox'); // a stale refetch lands mid-save and overwrites the optimistic lane
  patch.resolve({ ok: true, status: 'assigned' });
  await run;
  assert.equal(b.card.status, 'assigned');
  assert.equal(b.outcomes[0].kind, 'saved');
});

test("a save's own SSE broadcast arriving before its response does not trigger a re-read", async () => {
  let reads = 0;
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => { reads++; return 'assigned'; } });
  const run = b.controller.start(b.card, 'assigned');
  b.serverPush('assigned');
  patch.resolve({ ok: true, status: 'assigned' });
  await run;
  assert.equal(reads, 0);
  assert.equal(b.outcomes[0].kind, 'saved');
});
