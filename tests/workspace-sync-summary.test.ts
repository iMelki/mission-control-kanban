/**
 * The workspace page folds three banners into one status line. These pin the two
 * facts that line must never get wrong: a run that stopped reporting is stale (not
 * "Review needed"), and a drift warning keeps its plain-language meaning.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAgeHours,
  longestScheduleGapHours,
  presentMckN8nSyncFreshness,
} from '../src/lib/n8n-sync-freshness';
import {
  explainSyncNote,
  extractGitHubSyncNoteGroups,
  presentSyncSummaryChip,
  readN8nScheduleTimes,
} from '../src/lib/workspace-sync-summary';
import type { MckN8nSyncRun } from '../src/lib/types';

const NOW = new Date('2026-10-20T05:30:00.000Z');

test('longest gap of a twice-daily schedule is the overnight one', () => {
  assert.equal(longestScheduleGapHours(['09:00', '17:00']), 16);
  assert.equal(longestScheduleGapHours(['17:00', '09:00']), 16);
});

test('a single daily time waits a full day; no usable times falls back to a day', () => {
  assert.equal(longestScheduleGapHours(['09:00']), 24);
  assert.equal(longestScheduleGapHours([]), 24);
  assert.equal(longestScheduleGapHours(['soon', '25h']), 24);
});

test('a run from two months ago is stale against a 09:00/17:00 schedule', () => {
  const freshness = presentMckN8nSyncFreshness({
    receivedAt: '2026-08-14T06:37:00.000Z',
    schedule: ['09:00', '17:00'],
    now: NOW,
  });
  assert.equal(freshness.state, 'stale');
  assert.equal(freshness.staleAfterHours, 32);
  assert.equal(formatAgeHours(freshness.ageHours ?? 0), '67 days');
});

test('a run inside two intervals is fresh, and the boundary is not stale', () => {
  const fresh = presentMckN8nSyncFreshness({
    receivedAt: '2026-10-19T21:30:00.000Z',
    schedule: ['09:00', '17:00'],
    now: NOW,
  });
  assert.equal(fresh.state, 'fresh');

  const boundary = presentMckN8nSyncFreshness({
    receivedAt: '2026-10-18T21:30:00.000Z',
    schedule: ['09:00', '17:00'],
    now: NOW,
  });
  assert.equal(boundary.ageHours, 32);
  assert.equal(boundary.state, 'fresh');
});

test('no run, or an unreadable timestamp, is "never" rather than fresh', () => {
  assert.equal(presentMckN8nSyncFreshness({ receivedAt: null, now: NOW }).state, 'never');
  assert.equal(presentMckN8nSyncFreshness({ receivedAt: 'not a date', now: NOW }).state, 'never');
});

test('age labels use whole hours, then days', () => {
  assert.equal(formatAgeHours(0.2), 'under an hour');
  assert.equal(formatAgeHours(1), '1 hour');
  assert.equal(formatAgeHours(5.4), '5 hours');
  assert.equal(formatAgeHours(47), '47 hours');
  assert.equal(formatAgeHours(72), '3 days');
});

test('schedule times come from the recorded cadence and tolerate its absence', () => {
  const run = (raw: Record<string, unknown> | null) => ({ raw_payload: raw }) as MckN8nSyncRun;
  assert.deepEqual(
    readN8nScheduleTimes(run({ scheduleCadence: { schedule: ['09:00', '17:00'], timezone: 'Asia/Jerusalem' } })),
    ['09:00', '17:00'],
  );
  assert.deepEqual(readN8nScheduleTimes(run(null)), []);
  assert.deepEqual(readN8nScheduleTimes(run({ scheduleCadence: ['09:00'] })), []);
  assert.deepEqual(readN8nScheduleTimes(null), []);
});

test('the Done-versus-open drift note says GitHub is still open and who must decide', () => {
  const explained = explainSyncNote('iMelki/memsys#199: Local task is Done while GitHub Project Status is In progress.');
  assert.match(explained ?? '', /still lists this issue as open \(Status: In progress\)/);
  assert.match(explained ?? '', /never reopens a Done card/);
});

test('the Blocked drift note says nothing is broken; unknown notes get no gloss', () => {
  assert.match(
    explainSyncNote('x/y#1: GitHub Project Status Blocked has no first-class MCK column yet; local status is preserved.') ?? '',
    /Nothing is wrong/,
  );
  assert.equal(explainSyncNote('x/y#1: would move local status from inbox to review: reason'), undefined);
});

test('a payload with only reconciliation moves reports no drift', () => {
  const groups = extractGitHubSyncNoteGroups({
    details: [
      { action: 'status_reconcile', issue: 'x/y#1', reason: 'moved local status from inbox to done' },
      { action: 'status_reconcile', issue: 'x/y#2', reason: 'moved local status from review to done' },
    ],
  });
  assert.deepEqual(groups.drift, []);
  assert.equal(groups.reconciled.length, 2);
});

test('drift and reconciliation notes are grouped apart and each group stops at three', () => {
  const details = [
    ...Array.from({ length: 5 }, (_, index) => ({ action: 'drift', issue: `x/y#${index}`, reason: 'still open' })),
    ...Array.from({ length: 4 }, (_, index) => ({ action: 'status_reconcile', reason: `moved ${index}` })),
    { action: 'imported', reason: 'ignored' },
  ];
  const groups = extractGitHubSyncNoteGroups({ details });
  assert.equal(groups.drift.length, 3);
  assert.equal(groups.reconciled.length, 3);
  assert.equal(groups.drift[0], 'x/y#0: still open');
  assert.equal(groups.reconciled[0], 'moved 0');
  assert.deepEqual(extractGitHubSyncNoteGroups({}), { drift: [], reconciled: [] });
});

test('the mobile chip never says "Synced" before a sync has run', () => {
  assert.deepEqual(presentSyncSummaryChip({ hasProject: true, syncState: 'idle', attention: 0 }), { kind: 'idle', label: 'Not synced yet' });
  assert.deepEqual(presentSyncSummaryChip({ hasProject: true, syncState: 'success', attention: 0 }), { kind: 'ok', label: 'Synced' });
});

test('the mobile chip puts failures and warnings ahead of the sync state', () => {
  assert.equal(presentSyncSummaryChip({ hasProject: true, syncState: 'error', attention: 2 }).label, 'Sync failed');
  assert.equal(presentSyncSummaryChip({ hasProject: true, syncState: 'syncing', attention: 1 }).label, 'Syncing…');
  assert.equal(presentSyncSummaryChip({ hasProject: true, syncState: 'success', attention: 2 }).label, '2 to review');
  assert.equal(presentSyncSummaryChip({ hasProject: true, syncState: 'idle', attention: 1 }).label, '1 to review');
});

test('a workspace without a Project gets a neutral chip, or the review count', () => {
  assert.deepEqual(presentSyncSummaryChip({ hasProject: false, syncState: 'idle', attention: 0 }), { kind: 'unlinked', label: 'GitHub status' });
  assert.equal(presentSyncSummaryChip({ hasProject: false, syncState: 'idle', attention: 1 }).label, '1 to review');
});
