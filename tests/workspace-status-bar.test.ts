/**
 * Renders the status line to markup so the two misleading states Codex found on #197 stay
 * fixed in the component itself, not only in the helpers it calls: a green "Synced" before
 * any sync ran, and a clean reconciliation reported as a disagreement.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkspaceStatusBar, type GitHubSyncState } from '../src/components/workspace/WorkspaceStatusBar';
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
