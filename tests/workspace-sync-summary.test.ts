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
import { explainSyncNote, readN8nScheduleTimes } from '../src/lib/workspace-sync-summary';
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
