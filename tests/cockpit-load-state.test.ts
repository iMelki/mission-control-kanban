/**
 * Regression for the 2026-08-31 stuck-cockpit class: pre-data diagnostics
 * must not present as settled fact. These assertions fail on the old
 * null-as-missing-token / empty-as-Showing-0/0 / SSE-as-ONLINE behavior.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isCockpitSettled,
  presentBoardCount,
  presentConnection,
  presentEventsEmpty,
} from '../src/lib/cockpit-load-state';
import { presentGitHubConnection, presentGitHubReadiness } from '../src/lib/github-readiness';

const srcRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'src');

function readSrc(rel: string): string {
  return readFileSync(path.join(srcRoot, rel), 'utf8');
}

test('null diagnostics is pending, not a settled missing-token verdict', () => {
  const presented = presentGitHubReadiness({ diagnostics: null, loading: true });
  assert.equal(presented.phase, 'pending');
  assert.equal(presented.assertsSettledFailure, false);
  assert.equal(presented.summary, 'Checking GitHub…');
  assert.doesNotMatch(presented.summary, /No token detected/);
  assert.equal(presented.rows.every((row) => row.state === 'pending'), true);
  assert.equal(
    presented.rows.some((row) => row.message.includes('Needs GH_GENERAL_TOKEN')),
    false,
  );
});

test('the old null-as-missing-token copy is the fixture this test refuses', () => {
  const oldNullMeansMissing = {
    summary: 'No token detected · 0/3 lanes ready',
    rows: [
      {
        message: 'Needs GH_GENERAL_TOKEN or GITHUB_TOKEN so MCK can read GitHub issues and Project fields.',
      },
    ],
  };
  const presented = presentGitHubReadiness({ diagnostics: null, loading: false });
  assert.notEqual(presented.summary, oldNullMeansMissing.summary);
  assert.notEqual(presented.rows[0]?.message, oldNullMeansMissing.rows[0]?.message);
});

test('missing_token after a completed fetch is allowed to settle as blocked', () => {
  const presented = presentGitHubReadiness({
    diagnostics: {
      status: 'missing_token',
      token_source: null,
      authenticated: false,
      project_read_available: false,
      message: 'No GitHub token is configured.',
    },
    loading: false,
  });
  assert.equal(presented.phase, 'ready');
  assert.equal(presented.assertsSettledFailure, true);
  assert.match(presented.summary, /No token detected/);
});

test('pending board copy is not Showing 0/0', () => {
  const pending = presentBoardCount('pending', 0, 0);
  assert.equal(pending.settled, false);
  assert.equal(pending.text, 'Loading board…');
  assert.notEqual(pending.text, 'Showing 0/0');

  const readyEmpty = presentBoardCount('ready', 0, 0);
  assert.equal(readyEmpty.settled, true);
  assert.equal(readyEmpty.text, 'Showing 0/0');

  const readyLoaded = presentBoardCount('ready', 588, 588);
  assert.equal(readyLoaded.text, 'Showing 588/588');
});

test('pending events copy is not No events yet', () => {
  const pending = presentEventsEmpty('pending');
  assert.equal(pending.settled, false);
  assert.notEqual(pending.text, 'No events yet');

  const ready = presentEventsEmpty('ready');
  assert.equal(ready.settled, true);
  assert.equal(ready.text, 'No events yet');
});

test('pending connection is not ONLINE or OFFLINE', () => {
  const pending = presentConnection('pending');
  assert.equal(pending.settled, false);
  assert.notEqual(pending.label, 'ONLINE');
  assert.notEqual(pending.label, 'OFFLINE');

  assert.equal(presentConnection('online').label, 'ONLINE');
  assert.equal(presentConnection('offline').label, 'OFFLINE');
});

test('workspace metadata alone does not settle the cockpit', () => {
  assert.equal(isCockpitSettled({ workspaceReady: true, boardPhase: 'pending' }), false);
  assert.equal(isCockpitSettled({ workspaceReady: true, boardPhase: 'error' }), false);
  assert.equal(isCockpitSettled({ workspaceReady: false, boardPhase: 'ready' }), false);
  assert.equal(isCockpitSettled({ workspaceReady: true, boardPhase: 'ready' }), true);
});

test('GitHub connection first paint is checking, not setup-needed', () => {
  const presented = presentGitHubConnection({ diagnostics: null, loading: false });
  assert.equal(presented.phase, 'pending');
  assert.equal(presented.title, 'Checking GitHub…');
  assert.notEqual(presented.title, 'GitHub setup needed');
});

test('call sites consume the extracted presenters (old inline copies cannot sneak back)', () => {
  const readiness = readSrc('components/GitHubReadinessCard.tsx');
  const connection = readSrc('components/GitHubConnectionStatus.tsx');
  const queue = readSrc('components/MissionQueue.tsx');
  const feed = readSrc('components/LiveFeed.tsx');
  const header = readSrc('components/Header.tsx');
  const page = readSrc('app/workspace/[slug]/page.tsx');
  const sse = readSrc('hooks/useSSE.ts');

  assert.match(readiness, /presentGitHubReadiness/);
  assert.match(connection, /presentGitHubConnection/);
  assert.match(queue, /presentBoardCount/);
  assert.match(feed, /presentEventsEmpty/);
  assert.match(header, /presentConnection/);
  assert.match(page, /isCockpitSettled/);
  assert.doesNotMatch(sse, /setIsOnline\(/);
});
