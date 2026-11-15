/**
 * Pure board-attention helpers: the "Needs you" predicate and filter, the
 * GitHub-sourced Inbox dispatch-contract banner, and the settled-move
 * announce / ink decisions. Kept free of React so node --test can import them.
 */

import type { Announcements, UniqueIdentifier } from '@dnd-kit/core';
import { requiresDispatchContractBeforeWorkStarts, validateDispatchMetadata } from './dispatch-contract';
import type { Task, TaskStatus } from './types';

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

/**
 * The status bar's "gated in Inbox" count: GitHub-sourced, dispatch-blocked Inbox
 * cards in this workspace, the same cards the move gate holds and the card's
 * Contract chip marks.
 */
export function countGatedInbox<T extends AttentionTask>(tasks: readonly T[], workspaceId?: string): number {
  return workspaceScopedTasks(tasks, workspaceId).filter(isDispatchBlockedInbox).length;
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

export interface SettleMoveInput {
  /** The PATCH was accepted. */
  ok: boolean;
  /** No newer move of this card was started while this PATCH was in flight. */
  isLatestMove: boolean;
  /** The card's status in the store when the PATCH answered (null if the card is gone). */
  currentStatus: TaskStatus | null;
  /** Where the card was when this move started. */
  originStatus: TaskStatus;
  targetStatus: TaskStatus;
  title: string;
  laneName: (status: TaskStatus) => string;
}

export interface SettleMoveDecision {
  /** Put the card back here, or leave the store alone (null). */
  revertTo: TaskStatus | null;
  /** The "ink drying" cross-fade, the success cue. */
  playInk: boolean;
  /** Spoken by the board's polite status region (success only). */
  successAnnouncement: string | null;
  /** Shown in the assertive "Move not saved" alert (failure only); the one channel for it. */
  failureMessage: string | null;
}

/**
 * How a move settles once its PATCH answers. Only the latest move of a card may
 * settle it: an older move's answer is ignored. A failed move rolls back to its
 * origin only while the card still sits in the optimistic target; if the card has
 * moved since (an SSE update, or another client), the newer state wins and is
 * not overwritten.
 */
export function decideSettledMove(input: SettleMoveInput): SettleMoveDecision {
  const { ok, isLatestMove, currentStatus, originStatus, targetStatus, title, laneName } = input;
  if (!isLatestMove) {
    return { revertTo: null, playInk: false, successAnnouncement: null, failureMessage: null };
  }
  if (ok) {
    return { revertTo: null, playInk: true, successAnnouncement: `Moved ${title} to ${laneName(targetStatus)}.`, failureMessage: null };
  }
  if (currentStatus === targetStatus) {
    return {
      revertTo: originStatus,
      playInk: false,
      successAnnouncement: null,
      failureMessage: `${title} was not moved. It stayed in ${laneName(originStatus)}.`,
    };
  }
  return {
    revertTo: null,
    playInk: false,
    successAnnouncement: null,
    failureMessage: currentStatus
      ? `${title} was not moved to ${laneName(targetStatus)}. It is in ${laneName(currentStatus)}.`
      : `${title} was not moved to ${laneName(targetStatus)}.`,
  };
}

/**
 * Per-card move sequence numbers. begin() is called at each optimistic move;
 * isLatest() tells a PATCH answer whether a newer move of the same card started
 * while it was in flight (then the answer must not settle the card).
 */
export function createMoveSequencer() {
  const latest = new Map<string, number>();
  return {
    begin(taskId: string): number {
      const seq = (latest.get(taskId) ?? 0) + 1;
      latest.set(taskId, seq);
      return seq;
    },
    isLatest(taskId: string, seq: number): boolean {
      return latest.get(taskId) === seq;
    },
  };
}

export type RailTone = 'neutral' | 'active' | 'needs-you' | 'warn' | 'done';

/** The card's 3 px status rail. Orange only for cards the dispatch gate holds. */
export function railToneFor(task: Pick<AttentionTask, 'github_source' | 'status' | 'dispatch_blockers'>): RailTone {
  if (isDispatchBlockedInbox(task)) return 'warn';
  switch (task.status) {
    case 'review':
      return 'needs-you';
    case 'done':
      return 'done';
    case 'in_progress':
    case 'testing':
      return 'active';
    default:
      return 'neutral';
  }
}

/** The synchronous dispatch gate moveTask applies before any optimistic update. */
export function isGatedByDispatchContract(
  task: Pick<Task, 'github_source' | 'dispatch_metadata'>,
  targetStatus: TaskStatus,
): boolean {
  return Boolean(task.github_source)
    && requiresDispatchContractBeforeWorkStarts(targetStatus)
    && !validateDispatchMetadata(task.dispatch_metadata).canDispatch;
}

export type MoveDecision = 'stay' | 'gated' | 'move';

/** One decision for both the drop announcement and moveTask, so they cannot disagree. */
export function decideMove(task: Pick<Task, 'status' | 'github_source' | 'dispatch_metadata'>, targetStatus: TaskStatus): MoveDecision {
  if (task.status === targetStatus) return 'stay';
  if (isGatedByDispatchContract(task, targetStatus)) return 'gated';
  return 'move';
}

/**
 * dnd-kit live-region text for the board. A drop is announced as "Moving", never
 * "Moved": the result is only known after the PATCH (decideSettledMove). A move
 * the dispatch gate refuses is announced as refused.
 */
export function buildBoardAnnouncements({
  tasks,
  resolveTargetStatus,
  laneLabel,
}: {
  tasks: readonly Pick<Task, 'id' | 'title' | 'status' | 'github_source' | 'dispatch_metadata'>[];
  resolveTargetStatus: (overId: string) => TaskStatus | null;
  laneLabel: (status: TaskStatus) => string;
}): Announcements {
  const titleOf = (id: UniqueIdentifier) => tasks.find((task) => task.id === id)?.title ?? 'task';
  const laneOf = (overId: UniqueIdentifier | undefined) => {
    if (overId == null) return null;
    const status = resolveTargetStatus(String(overId));
    return status ? laneLabel(status) : null;
  };

  return {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) => {
      const lane = laneOf(over?.id);
      return lane ? `${titleOf(active.id)} is over ${lane}.` : `${titleOf(active.id)} is not over a lane.`;
    },
    onDragEnd: ({ active, over }) => {
      const lane = laneOf(over?.id);
      if (!lane) return `${titleOf(active.id)} was dropped outside the board.`;
      const task = tasks.find((candidate) => candidate.id === active.id);
      const target = over ? resolveTargetStatus(String(over.id)) : null;
      if (task && target) {
        const decision = decideMove(task, target);
        if (decision === 'stay') return `${task.title} stayed in ${lane}.`;
        if (decision === 'gated') return `${task.title} cannot move to ${lane} yet: the dispatch contract is incomplete.`;
      }
      return `Moving ${titleOf(active.id)} to ${lane}.`;
    },
    onDragCancel: ({ active }) => `Move cancelled. ${titleOf(active.id)} stayed where it was.`,
  };
}

/**
 * With "Needs you" on, moving a card to a status that no longer needs Captain
 * (Review -> Done, say) removes it, and its focused drag handle, from the board.
 * dnd-kit cannot restore focus to a node that is gone, so the caller moves focus
 * to the board region instead of letting it fall to the document.
 */
export function moveLeavesNeedsYouFilter(
  task: Pick<AttentionTask, 'github_source' | 'status' | 'dispatch_blockers'>,
  targetStatus: TaskStatus,
  needsYouOnly: boolean,
): boolean {
  return needsYouOnly && !needsCaptain({ ...task, status: targetStatus });
}
