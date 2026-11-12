/**
 * Pure board-attention helpers: the "Needs you" predicate and filter, the
 * GitHub-sourced Inbox dispatch-contract banner, and the settled-move
 * announce / ink decisions. Kept free of React so node --test can import them.
 */

import type { Task } from './types';

export type AttentionTask = Pick<
  Task,
  'id' | 'status' | 'workspace_id' | 'github_source' | 'dispatch_blockers'
>;

/** Constant accessible name for the Needs you control. The count is not part of it. */
export const NEEDS_YOU_ACCESSIBLE_NAME = 'Needs you';

/**
 * Guidance that used to sit as a paragraph on the card face. It now lives on
 * the compact chip's tooltip and in the task detail view.
 */
export const DISPATCH_CONTRACT_INBOX_GUIDANCE =
  'Still in Inbox until the Dispatch Contract is complete. Open the task to fill scope, tests, and rollback.';

/** One-word, color-coded status shown on the card in place of the instruction paragraph. */
export const DISPATCH_CONTRACT_INBOX_CHIP_LABEL = 'Contract';

/**
 * Only GitHub-sourced work is held by the dispatch contract (moveTask and the PATCH
 * route gate on github_source). Local tasks also carry dispatch_blockers from the API,
 * but nothing blocks them, so they must not count as waiting on Captain.
 */
export function isDispatchBlockedInbox(task: Pick<AttentionTask, 'github_source' | 'status' | 'dispatch_blockers'>): boolean {
  return Boolean(task.github_source) && task.status === 'inbox' && (task.dispatch_blockers?.length ?? 0) > 0;
}

/**
 * The Inbox dispatch-contract banner / compact chip is shown only for
 * GitHub-sourced, dispatch-blocked Inbox work. Locally created tasks never show it.
 */
export function showsDispatchContractInboxBanner(
  task: Pick<AttentionTask, 'github_source' | 'status' | 'dispatch_blockers'> | null | undefined,
): boolean {
  if (!task) return false;
  return isDispatchBlockedInbox(task);
}

/** Review work and GitHub-sourced dispatch-blocked Inbox work wait on Captain. */
export function needsCaptain(task: Pick<AttentionTask, 'github_source' | 'status' | 'dispatch_blockers'>): boolean {
  return task.status === 'review' || isDispatchBlockedInbox(task);
}

export function workspaceScopedTasks<T extends { workspace_id: string }>(
  tasks: readonly T[],
  workspaceId?: string,
): T[] {
  return workspaceId ? tasks.filter((task) => task.workspace_id === workspaceId) : [...tasks];
}

/** Review plus GitHub-sourced dispatch-blocked Inbox, scoped to a workspace. */
export function needsYouTasks<T extends AttentionTask>(
  tasks: readonly T[],
  workspaceId?: string,
): T[] {
  return workspaceScopedTasks(tasks, workspaceId).filter(needsCaptain);
}

export function countNeedsYou<T extends AttentionTask>(
  tasks: readonly T[],
  workspaceId?: string,
): number {
  return needsYouTasks(tasks, workspaceId).length;
}

/**
 * When `needsYouOnly` is on, keep only Review and GitHub-sourced dispatch-blocked
 * Inbox cards in the workspace. When it is off, return the scoped list unchanged.
 */
export function applyNeedsYouFilter<T extends AttentionTask>(
  tasks: readonly T[],
  needsYouOnly: boolean,
  workspaceId?: string,
): T[] {
  const scoped = workspaceScopedTasks(tasks, workspaceId);
  return needsYouOnly ? scoped.filter(needsCaptain) : scoped;
}

export type BoardLoadPhase = 'pending' | 'ready' | 'error';

/**
 * Count text spoken beside the constant "Needs you" name (aria-describedby or a
 * polite live region). Never folded into the accessible name.
 */
export function presentNeedsYouCountDescription(phase: BoardLoadPhase, count: number): string {
  if (phase === 'pending') return 'loading';
  if (phase === 'error') return 'unavailable';
  return String(count);
}

export interface SettledMoveOutcome {
  announcement: string;
  playInk: boolean;
  revert: boolean;
}

/**
 * Announce-after-PATCH / ink-after-saved-move. The success cue (ink fade and
 * "Moved …") only fires when the server accepted the change. A failed PATCH
 * announces that the card stayed and asks the caller to revert.
 */
export function settledMoveOutcome(
  ok: boolean,
  title: string,
  targetLane: string,
  originLane: string,
): SettledMoveOutcome {
  if (ok) {
    return {
      announcement: `Moved ${title} to ${targetLane}.`,
      playInk: true,
      revert: false,
    };
  }
  return {
    announcement: `${title} was not moved. It stayed in ${originLane}.`,
    playInk: false,
    revert: true,
  };
}
