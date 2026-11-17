/**
 * Renders the status line to markup so the two misleading states Codex found on #197 stay
 * fixed in the component itself, not only in the helpers it calls: a green "Synced" before
 * any sync ran, and a clean reconciliation reported as a disagreement.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SyncNotesBody, WorkspaceStatusBar, type GitHubSyncState } from '../src/components/workspace/WorkspaceStatusBar';
import type { Workspace } from '../src/lib/types';

const linked = { id: 'asimtop', github_project_owner: 'iMelki', github_project_number: 8 } as Workspace;
const unlinked = { id: 'default', github_project_owner: null, github_project_number: null } as unknown as Workspace;

function render(workspace: Workspace, githubSync: GitHubSyncState): string {
  return renderToStaticMarkup(
    createElement(WorkspaceStatusBar, { workspace, githubSync, n8nSync: null, gatedInboxCount: 0, onSyncNow: () => {} }),
  );
}

test('before any sync the mobile chip is neutral "Not synced yet", never a green "Synced"', () => {
  const html = render(linked, { state: 'idle' });
  assert.doesNotMatch(html, />Synced</);
  assert.match(html, /Not synced yet/);
});

test('after a successful sync the chip says "Synced"', () => {
  const html = render(linked, {
    state: 'success',
    counts: { imported: 0, updated: 3, moved: 0, statusReconciled: 0, driftWarnings: 0 },
  });
  assert.match(html, />Synced</);
});

test('a workspace without a Project still renders the status line', () => {
  const html = render(unlinked, { state: 'idle' });
  assert.match(html, /data-workspace-status-bar/);
  assert.match(html, /No GitHub Project linked/);
  assert.doesNotMatch(html, /Sync now/);
});

type NotesProps = Parameters<typeof SyncNotesBody>[0];

function renderNotes(props: Partial<NotesProps>): string {
  return renderToStaticMarkup(
    createElement(SyncNotesBody, {
      driftWarnings: 0,
      driftNotes: [],
      reconciledNotes: [],
      statusReconciled: 0,
      ...props,
    }),
  );
}

test('drawer notes for a reconciliation-only sync say nothing disagrees', () => {
  const html = renderNotes({
    statusReconciled: 2,
    reconciledNotes: ['x/y#1: moved to done', 'x/y#2: moved to done'],
    counts: { imported: 0, updated: 4, moved: 0, statusReconciled: 2, driftWarnings: 0 },
  });
  assert.doesNotMatch(html, /disagree/);
  assert.match(html, /MCK moved 2 cards to match GitHub\. Nothing to resolve\./);
  assert.match(html, /x\/y#1: moved to done/);
});

test('drawer notes for a mixed sync report only the drift as a disagreement', () => {
  const html = renderNotes({
    driftWarnings: 1,
    driftNotes: ['x/y#9: Local task is Done while GitHub Project Status is In progress.'],
    statusReconciled: 3,
    reconciledNotes: ['x/y#1: moved', 'x/y#2: moved', 'x/y#3: moved'],
  });
  assert.match(html, /GitHub and MCK disagree on 1 item\./);
  assert.match(html, /MCK moved 3 cards to match GitHub/);
  assert.match(html, /still lists this issue as open/);
});

test('drawer notes count drift by the sync total and flag a truncated list', () => {
  const html = renderNotes({ driftWarnings: 19, driftNotes: ['a: one', 'b: two', 'c: three'] });
  assert.match(html, /disagree on 19 items/);
  assert.match(html, /Showing the first 3 of 19\./);
  assert.doesNotMatch(html, /Nothing to resolve/);
});

test('drawer notes with nothing to report say so', () => {
  assert.match(renderNotes({}), /No status reconciliation or drift notes in the last sync\./);
});

test('on a narrow screen the Sync button is icon-only but keeps its accessible name', () => {
  const html = render(linked, { state: 'idle' });
  assert.match(html, /aria-label="Sync workspace now from GitHub Project"[^>]*>[\s\S]*?<span class="hidden sm:inline">Sync now<\/span>/);
});
