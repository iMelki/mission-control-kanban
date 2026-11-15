/**
 * Board-attention behaviour for mission-control-kanban#194: Needs you count and
 * filter, GitHub-sourced Inbox banner gating, and announce-after-PATCH /
 * ink-after-saved-move. Helpers are pure so this file runs under node --test.
 *
 * Named tests must appear by name in the CI job log.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { mock } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DISPATCH_CONTRACT_INBOX_CHIP_LABEL,
  DISPATCH_CONTRACT_INBOX_GUIDANCE,
  NEEDS_YOU_ACCESSIBLE_NAME,
  applyNeedsYouFilter,
  buildBoardAnnouncements,
  countGatedInbox,
  countNeedsYou,
  createAnnouncementQueue,
  ANNOUNCEMENT_TTL_MS,
  settledSaveFailureIds,
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
import {
  MOVE_READ_TIMEOUT_MS,
  MOVE_SAVE_TIMEOUT_MS,
  OUTCOME_REPLAY_MS,
  createMoveController,
  type MoveOutcome,
  type PatchStatusResult,
  type ServerStatus,
} from '../src/lib/board-move-controller';
import {
  applyServerTasks,
  getBoardMoveController,
  mergeServerTasks,
  reportServerTasks,
  resetBoardMoveControllers,
  taskStreamHandlers,
} from '../src/lib/board-move-registry';
import { useMissionControl } from '../src/lib/store';
import { planDialogStatus } from '../src/lib/task-dialog-save';
import { validateDispatchMetadata } from '../src/lib/dispatch-contract';
import type { DispatchMetadata, Task, TaskStatus } from '../src/lib/types';

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

// --- Rounds 2 and 3 of the independent review: drop decision, server reconciliation, timeouts,
// server facts at the source, dialog status, unmount, retry, announcements ---

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Let pending promise callbacks run (fake timers do not advance microtasks). */
async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

const T0 = '2026-11-15T10:00:00.000Z';
const T1 = '2026-11-15T10:00:01.000Z';
const T2 = '2026-11-15T10:00:02.000Z';

/** A board store plus a controller, for the controller's own rules. */
function board(initial: TaskStatus, options: {
  patch?: (status: TaskStatus, signal: AbortSignal) => Promise<PatchStatusResult>;
  read?: (signal: AbortSignal) => Promise<ServerStatus | null>;
  saveTimeoutMs?: number;
  readTimeoutMs?: number;
} = {}) {
  const card = { id: 'a', title: 'A', status: initial, updated_at: T0, github_source: undefined, dispatch_metadata: undefined };
  const outcomes: MoveOutcome[] = [];
  const pendingLog: boolean[] = [];
  const controller = createMoveController({
    getStatus: () => card.status,
    setStatus: (_id, status) => { card.status = status; },
    patchStatus: (_id, status, signal) => (options.patch ?? (async () => ({ ok: true as const, status, updatedAt: T1 })))(status, signal),
    readStatus: (_id, signal) => (options.read ?? (async () => null))(signal),
    saveTimeoutMs: options.saveTimeoutMs,
    readTimeoutMs: options.readTimeoutMs ?? 50,
  });
  controller.setOutcomeListener((outcome) => outcomes.push(outcome));
  controller.subscribe(() => pendingLog.push(controller.isSaving('a')));
  /** A server status for the card while it saves (what the SSE/refetch sources report). */
  const serverPush = (status: TaskStatus, updatedAt = T1) => { card.status = status; controller.observeServerStatus('a', status, updatedAt); };
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
  const first = b.controller.recordDrop(b.card, 'assigned');
  assert.equal(first, 'move');
  void b.controller.start(b.card, 'assigned');
  assert.equal(b.controller.isSaving('a'), true);
  assert.equal(announcements.onDragEnd(onDragEndArgs('assigned')), 'Moving A to Assigned.');
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
  const b = board('inbox', { patch: async () => ({ ok: false, error: 'Validation failed' }), read: async () => ({ status: 'inbox', updatedAt: T0 }) });
  await b.controller.start(b.card, 'assigned');
  assert.equal(b.card.status, 'inbox');
  assert.equal(b.outcomes[0].kind, 'not-saved');
});

test('save and re-read both fail with no server news: the card shows the last confirmed lane and offers a retry', async () => {
  const b = board('inbox', { patch: async () => { throw new TypeError('Failed to fetch'); }, read: async () => { throw new TypeError('Failed to fetch'); } });
  await b.controller.start(b.card, 'assigned');
  assert.equal(b.card.status, 'inbox');
  const outcome = b.outcomes[0];
  assert.equal(outcome.kind, 'unknown');
  assert.equal(outcome.kind === 'unknown' && outcome.target, 'assigned');
});

test('a successful PATCH after conflicting server news re-reads instead of trusting either one', async () => {
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => ({ status: 'assigned', updatedAt: T2 }) });
  const run = b.controller.start(b.card, 'assigned');
  b.serverPush('review', T1);
  patch.resolve({ ok: true, status: 'assigned', updatedAt: T1 });
  await run;
  assert.equal(b.card.status, 'assigned');
  assert.equal(b.outcomes[0].kind, 'saved');
});

test("a save's own SSE broadcast arriving before its response does not trigger a re-read", async () => {
  let reads = 0;
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => { reads++; return { status: 'assigned', updatedAt: T1 }; } });
  const run = b.controller.start(b.card, 'assigned');
  b.serverPush('assigned', T1);
  patch.resolve({ ok: true, status: 'assigned', updatedAt: T1 });
  await run;
  assert.equal(reads, 0);
  assert.equal(b.outcomes[0].kind, 'saved');
});

test('a stale server report (older updated_at) does not override a newer confirmed status', async () => {
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => { throw new Error('offline'); } });
  const run = b.controller.start(b.card, 'assigned');
  b.controller.observeServerStatus('a', 'assigned', T2); // the save's echo
  b.controller.observeServerStatus('a', 'inbox', T0); // a refetch that left the server before the save
  patch.reject(new Error('connection reset'));
  await run;
  assert.equal(b.card.status, 'assigned');
  assert.equal(b.outcomes[0].kind, 'saved');
});

test('the re-read does not overwrite a newer SSE status that arrived while it was in flight', async () => {
  const read = deferred<ServerStatus | null>();
  const b = board('inbox', { patch: async () => { throw new Error('connection reset'); }, read: () => read.promise, readTimeoutMs: 1000 });
  const run = b.controller.start(b.card, 'assigned');
  await flush();
  b.serverPush('review', T2); // another client moved it while the GET was in flight
  read.resolve({ status: 'inbox', updatedAt: T0 }); // the GET left the server earlier
  await run;
  assert.equal(b.card.status, 'review');
  assert.equal(b.outcomes[0].kind, 'not-saved');
});

test('fake timers: a save that never answers is aborted at 15 s, then reconciled from the server', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let aborted = false;
    const b = board('inbox', {
      saveTimeoutMs: undefined,
      patch: (_status, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); })),
      read: async () => ({ status: 'inbox', updatedAt: T0 }),
      readTimeoutMs: MOVE_READ_TIMEOUT_MS,
    });
    const run = b.controller.start(b.card, 'assigned');
    mock.timers.tick(MOVE_SAVE_TIMEOUT_MS - 1);
    await flush();
    assert.equal(b.controller.isSaving('a'), true);
    assert.equal(aborted, false);
    mock.timers.tick(1);
    await flush();
    await run;
    assert.equal(MOVE_SAVE_TIMEOUT_MS, 15_000);
    assert.equal(aborted, true);
    assert.equal(b.controller.isSaving('a'), false);
    assert.equal(b.card.status, 'inbox');
    assert.match(b.outcomes[0].kind === 'not-saved' ? b.outcomes[0].error : '', /No answer from the server after 15 s/);
  } finally {
    mock.timers.reset();
  }
});

test('fake timers: a re-read that hangs gives up at 5 s and the card falls back to the confirmed lane', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const b = board('inbox', {
      patch: async () => { throw new TypeError('Failed to fetch'); },
      read: () => new Promise(() => {}),
      readTimeoutMs: MOVE_READ_TIMEOUT_MS,
    });
    const run = b.controller.start(b.card, 'assigned');
    await flush();
    mock.timers.tick(MOVE_READ_TIMEOUT_MS - 1);
    await flush();
    assert.equal(b.controller.isSaving('a'), true);
    mock.timers.tick(1);
    await flush();
    await run;
    assert.equal(MOVE_READ_TIMEOUT_MS, 5_000);
    assert.equal(b.controller.isSaving('a'), false);
    assert.equal(b.card.status, 'inbox');
    assert.equal(b.outcomes[0].kind, 'unknown');
  } finally {
    mock.timers.reset();
  }
});

test('fake timers: settled-move messages are appended, kept for 8 s, then pruned', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let shown: readonly { id: number; text: string }[] = [];
    const queue = createAnnouncementQueue({ onChange: (entries) => { shown = entries; } });
    queue.announce('Moved A to Assigned.');
    mock.timers.tick(1000);
    queue.announce('Moved B to Review.'); // a second card's move does not replace the first
    assert.deepEqual(shown.map((e) => e.text), ['Moved A to Assigned.', 'Moved B to Review.']);
    mock.timers.tick(ANNOUNCEMENT_TTL_MS - 1000);
    assert.deepEqual(shown.map((e) => e.text), ['Moved B to Review.']);
    mock.timers.tick(1000);
    assert.deepEqual(shown, []);
    assert.equal(ANNOUNCEMENT_TTL_MS, 8_000);
  } finally {
    mock.timers.reset();
  }
});

/** Real wiring: the app's zustand store, the workspace registry and the SSE handlers, with fetch stubbed. */
async function withRealBoard(run: (ctx: { patch: Deferred<Response>; reads: () => number; }) => Promise<void>, readResponse: () => Promise<Response>) {
  const originalFetch = globalThis.fetch;
  const patch = deferred<Response>();
  let reads = 0;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PATCH') return patch.promise;
    reads++;
    return readResponse();
  }) as typeof fetch;
  resetBoardMoveControllers();
  try {
    await run({ patch, reads: () => reads });
  } finally {
    globalThis.fetch = originalFetch;
    resetBoardMoveControllers();
    useMissionControl.getState().setTasks([]);
  }
}

const realTask = (status: TaskStatus, updatedAt = T0) => ({
  id: 'real-1', title: 'Real card', status, priority: 'normal', workspace_id: 'ws-real', business_id: 'default', created_at: T0, updated_at: updatedAt,
}) as Task;

test('real wiring: the save commits, its SSE echo carries the target (same as the optimistic lane), the response and the re-read are lost: the card stays in target', async () => {
  await withRealBoard(async ({ patch }) => {
    useMissionControl.getState().setTasks([realTask('inbox')]);
    const controller = getBoardMoveController('ws-real');
    const outcomes: MoveOutcome[] = [];
    controller.setOutcomeListener((o) => outcomes.push(o));
    const run = controller.start(useMissionControl.getState().tasks[0], 'assigned');
    assert.equal(useMissionControl.getState().tasks[0].status, 'assigned'); // optimistic
    // The server commits and broadcasts task_updated with the target status, through the real SSE handler.
    taskStreamHandlers().onTaskUpdated(realTask('assigned', T1));
    patch.reject(new TypeError('Failed to fetch')); // the PATCH response is lost
    await run;
    assert.equal(useMissionControl.getState().tasks[0].status, 'assigned');
    assert.equal(outcomes[0].kind, 'saved');
  }, async () => { throw new TypeError('Failed to fetch'); });
});

test('reportServerTasks routes each task to its own workspace controller only', async () => {
  const originalFetch = globalThis.fetch;
  const patches: Deferred<Response>[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PATCH') { const d = deferred<Response>(); patches.push(d); return d.promise; }
    throw new TypeError('Failed to fetch'); // every re-read fails: cards fall back to what was reported
  }) as typeof fetch;
  resetBoardMoveControllers();
  try {
    useMissionControl.getState().setTasks([
      { ...realTask('inbox'), id: 'card-a', workspace_id: 'ws-a' },
      { ...realTask('inbox'), id: 'card-b', workspace_id: 'ws-b' },
    ]);
    const a = getBoardMoveController('ws-a');
    const b = getBoardMoveController('ws-b');
    const runA = a.start(useMissionControl.getState().tasks[0], 'assigned');
    const runB = b.start(useMissionControl.getState().tasks[1], 'assigned');
    reportServerTasks([
      { id: 'card-a', status: 'review', workspace_id: 'ws-a', updated_at: T1 },
      { id: 'card-b', status: 'done', workspace_id: 'ws-b', updated_at: T1 },
      { id: 'card-a', status: 'testing', workspace_id: 'ws-b', updated_at: T2 }, // wrong workspace: not ws-a's news
    ]);
    for (const d of patches) d.reject(new TypeError('Failed to fetch'));
    await Promise.all([runA, runB]);
    const statusOf = (id: string) => useMissionControl.getState().tasks.find((t) => t.id === id)?.status;
    assert.equal(statusOf('card-a'), 'review');
    assert.equal(statusOf('card-b'), 'done');
  } finally {
    globalThis.fetch = originalFetch;
    resetBoardMoveControllers();
    useMissionControl.getState().setTasks([]);
  }
});

test('stale server data is not written over newer store data (SSE events and refetch merges)', () => {
  resetBoardMoveControllers();
  try {
    const store = useMissionControl.getState();
    store.setTasks([realTask('review', T2)]);
    taskStreamHandlers().onTaskUpdated(realTask('inbox', T1)); // delayed, older event
    assert.equal(useMissionControl.getState().tasks[0].status, 'review');
    taskStreamHandlers().onTaskUpdated(realTask('done', '2026-11-15T10:00:03.000Z'));
    assert.equal(useMissionControl.getState().tasks[0].status, 'done');
    // A refetch that left the server before that event keeps the store's newer copy.
    applyServerTasks([realTask('inbox', T0), { ...realTask('assigned', T1), id: 'real-2' }]);
    assert.deepEqual(useMissionControl.getState().tasks.map((t) => [t.id, t.status]), [['real-1', 'done'], ['real-2', 'assigned']]);
    // SQLite-format timestamps compare as UTC too.
    assert.equal(mergeServerTasks([realTask('done', '2026-11-15 10:00:05')], [realTask('inbox', '2026-11-15T10:00:04.000Z')])[0].status, 'done');
  } finally {
    useMissionControl.getState().setTasks([]);
  }
});

test('reports with an equal timestamp and status are not server news (no re-read)', async () => {
  let reads = 0;
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => { reads++; return { status: 'inbox', updatedAt: T0 }; } });
  const run = b.controller.start(b.card, 'assigned');
  b.controller.observeServerStatus('a', 'inbox', T0); // the origin re-reported unchanged (a poll)
  patch.resolve({ ok: true, status: 'assigned', updatedAt: T1 });
  await run;
  assert.equal(reads, 0); // with the bug this counted as conflicting news and forced a re-read
  assert.equal(b.outcomes[0].kind, 'saved');
  assert.equal(b.card.status, 'assigned');
});

test('the board controller survives unmount: same instance per workspace, pending save still refused, outcome delivered on remount', async () => {
  resetBoardMoveControllers();
  try {
    assert.equal(getBoardMoveController('ws-x'), getBoardMoveController('ws-x'));
    const patch = deferred<PatchStatusResult>();
    const b = board('inbox', { patch: () => patch.promise });
    b.controller.setOutcomeListener(null); // the board unmounted (tab switch)
    const run = b.controller.start(b.card, 'assigned');
    // Remounted board: same controller, the card is still saving and a second move is refused.
    assert.equal(b.controller.decide(b.card, 'in_progress'), 'saving');
    patch.resolve({ ok: true, status: 'assigned', updatedAt: T1 });
    await run;
    assert.deepEqual(b.outcomes, []); // nobody listening yet
    const late: MoveOutcome[] = [];
    b.controller.setOutcomeListener((o) => late.push(o)); // the board mounts again
    assert.deepEqual(late.map((o) => o.kind), ['saved']);
  } finally {
    resetBoardMoveControllers();
  }
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
});

test('dialog status: unchanged -> not sent; changed and card still where it opened -> sent; moved meanwhile or unreadable -> refused', async () => {
  const laneName = (status: TaskStatus) => LANES[status];
  let reads = 0;
  assert.deepEqual(
    await planDialogStatus({ openedStatus: 'assigned', formStatus: 'assigned', readServerStatus: async () => { reads++; return 'inbox'; }, laneName }),
    { action: 'omit' },
  );
  assert.equal(reads, 0); // the stale optimistic status is simply not sent
  assert.deepEqual(
    await planDialogStatus({ openedStatus: 'assigned', formStatus: 'review', readServerStatus: async () => 'assigned', laneName }),
    { action: 'send', status: 'review' },
  );
  const moved = await planDialogStatus({ openedStatus: 'assigned', formStatus: 'review', readServerStatus: async () => 'inbox', laneName });
  assert.equal(moved.action, 'refuse');
  assert.match(moved.action === 'refuse' ? moved.message : '', /moved to Inbox while the dialog was open/);
  assert.equal((await planDialogStatus({ openedStatus: 'assigned', formStatus: 'review', readServerStatus: async () => null, laneName })).action, 'refuse');
});

test('save failures live in the controller: one per card, kept while unmounted, cleared on success; moot ones detected only once loaded', async () => {
  let fail = true;
  const b = board('inbox', {
    patch: async (status) => { if (fail) throw new TypeError('Failed to fetch'); return { ok: true, status, updatedAt: T2 }; },
    read: async () => { throw new TypeError('Failed to fetch'); },
  });
  b.controller.setOutcomeListener(null); // board unmounted: failures must still be kept
  await b.controller.start(b.card, 'assigned');
  assert.deepEqual(b.controller.getFailuresSnapshot().map((f) => [f.taskId, f.retryable, f.target]), [['a', true, 'assigned']]);
  await b.controller.start(b.card, 'assigned'); // fails again: still one alert for the card
  assert.equal(b.controller.getFailuresSnapshot().length, 1);
  fail = false;
  await b.controller.start(b.card, 'assigned'); // the retry saves: the alert goes
  assert.deepEqual(b.controller.getFailuresSnapshot(), []);
  const failures = [{ taskId: 'a', target: 'assigned' as TaskStatus, retryable: true }, { taskId: 'b', target: 'review' as TaskStatus, retryable: true }];
  assert.deepEqual(settledSaveFailureIds(failures, [{ id: 'a', status: 'assigned' }, { id: 'b', status: 'inbox' }], true), ['a']);
  assert.deepEqual(settledSaveFailureIds(failures, [], false), []); // still loading: not "deleted"
  assert.deepEqual(settledSaveFailureIds(failures, [], true), ['a', 'b']);
  assert.deepEqual(settledSaveFailureIds([{ taskId: 'c', target: 'done', retryable: false }], [], true), []);
});

test('queued outcomes older than OUTCOME_REPLAY_MS are not announced on a later remount', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(T0) });
  try {
    const b = board('inbox');
    b.controller.setOutcomeListener(null);
    await b.controller.start(b.card, 'assigned');
    mock.timers.tick(OUTCOME_REPLAY_MS + 1);
    const late: MoveOutcome[] = [];
    b.controller.setOutcomeListener((o) => late.push(o));
    assert.deepEqual(late, []);
  } finally {
    mock.timers.reset();
  }
});

for (const tz of ['America/New_York', 'Asia/Tokyo']) {
  test(`SQLite datetime('now') timestamps are read as UTC under TZ=${tz}: a newer remote move wins, an older one is ignored`, () => {
    const script = `
      const { serverTimeOf, createMoveController } = require('./src/lib/board-move-controller.ts');
      const t = serverTimeOf('2026-11-15 10:00:00');
      if (t !== Date.parse('2026-11-15T10:00:00Z')) throw new Error('parsed as local time: ' + new Date(t).toISOString());
      const card = { status: 'inbox' };
      const c = createMoveController({ getStatus: () => card.status, setStatus: (_i, s) => { card.status = s; },
        patchStatus: () => Promise.reject(new Error('connection reset')), readStatus: async () => null });
      c.setOutcomeListener(() => {});
      const run = c.start({ id: 'a', title: 'A', status: 'inbox', updated_at: '2026-11-15T10:00:00.000Z' }, 'assigned');
      c.observeServerStatus('a', 'assigned', '2026-11-15T10:00:01.000Z');
      c.observeServerStatus('a', 'review', '2026-11-15 10:00:02'); // newer, SQLite format
      c.observeServerStatus('a', 'inbox', '2026-11-15 10:00:00');  // older, SQLite format
      run.then(() => process.stdout.write(card.status));
    `;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { cwd: repoRoot, env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'review');
  });
}

test('a newer confirmation from an earlier save survives the next move (stale report after it is ignored)', async () => {
  const second = deferred<PatchStatusResult>();
  let call = 0;
  const b = board('inbox', {
    patch: async (status) => (++call === 1 ? { ok: true, status, updatedAt: T2 } : second.promise),
    read: async () => { throw new Error('offline'); },
  });
  await b.controller.start(b.card, 'assigned'); // Inbox (T0) -> Assigned, confirmed at T2
  assert.equal(b.card.status, 'assigned');
  // The store's updated_at is still T0; the next move must not forget the T2 confirmation.
  const run = b.controller.start(b.card, 'in_progress');
  b.controller.observeServerStatus('a', 'inbox', T0); // a delayed, stale Inbox report
  second.reject(new Error('connection reset'));
  await run;
  assert.equal(b.card.status, 'assigned');
});

test('when the recovery read fails, a newer SSE confirmation beats this save\'s older answer', async () => {
  const patch = deferred<PatchStatusResult>();
  const b = board('inbox', { patch: () => patch.promise, read: async () => { throw new Error('offline'); } });
  const run = b.controller.start(b.card, 'assigned');
  b.serverPush('review', '2026-11-15T10:00:03.000Z'); // SSE: Review at T3
  patch.resolve({ ok: true, status: 'assigned', updatedAt: T2 }); // the PATCH answered Assigned at T2
  await run;
  assert.equal(b.card.status, 'review');
  assert.equal(b.outcomes[0].kind, 'not-saved');
});

test('fake timers: the dialog\'s status re-read is bounded, so Save cannot hang', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let aborted = false;
    const plan = planDialogStatus({
      openedStatus: 'assigned',
      formStatus: 'review',
      readServerStatus: (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); })),
      laneName: (status) => LANES[status],
    });
    await flush();
    mock.timers.tick(MOVE_READ_TIMEOUT_MS);
    const result = await plan;
    assert.equal(aborted, true);
    assert.equal(result.action, 'refuse');
  } finally {
    mock.timers.reset();
  }
});
