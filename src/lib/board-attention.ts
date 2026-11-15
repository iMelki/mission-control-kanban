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

export type MoveDecision = 'stay' | 'saving' | 'gated' | 'move';

/**
 * One decision for both the drop announcement and moveTask, so they cannot disagree.
 * `saving`: the card's previous move has not been answered yet (moves are serialized).
 */
export function decideMove(
  task: Pick<Task, 'status' | 'github_source' | 'dispatch_metadata'>,
  targetStatus: TaskStatus,
  isSaving = false,
): MoveDecision {
  if (task.status === targetStatus) return 'stay';
  if (isSaving) return 'saving';
  if (isGatedByDispatchContract(task, targetStatus)) return 'gated';
  return 'move';
}

/**
 * dnd-kit live-region text for the board. A drop is announced as "Moving", never
 * "Moved": the result is only known after the save answers (board-move-controller). A move
 * the dispatch gate refuses is announced as refused.
 */
export function buildBoardAnnouncements({
  tasks,
  resolveTargetStatus,
  laneLabel,
  isSaving = () => false,
  decisionFor = () => undefined,
}: {
  tasks: readonly Pick<Task, 'id' | 'title' | 'status' | 'github_source' | 'dispatch_metadata'>[];
  resolveTargetStatus: (overId: string) => TaskStatus | null;
  laneLabel: (status: TaskStatus) => string;
  /** The card's previous move is still being saved. */
  isSaving?: (taskId: string) => boolean;
  /**
   * The decision the board already made for this drop. dnd-kit calls DndContext's
   * onDragEnd (which starts the save) before announcements.onDragEnd, so recomputing
   * here would see the save just started and wrongly say "still being saved".
   */
  decisionFor?: (taskId: string, target: TaskStatus) => MoveDecision | undefined;
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
        const decision = decisionFor(task.id, target) ?? decideMove(task, target, isSaving(task.id));
        if (decision === 'stay') return `${task.title} stayed in ${lane}.`;
        if (decision === 'saving') return `${task.title} is still being saved. It stayed in ${laneLabel(task.status)}.`;
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

/** How long a settled-move message stays in the board's polite region (long enough to be spoken). */
export const ANNOUNCEMENT_TTL_MS = 8_000;

/**
 * The board's settled-move messages. Each message is appended (never replacing an
 * earlier one, so a second card's move cannot swallow the first card's "Moved ..."),
 * at most `max` are kept, and each is pruned `ttlMs` after it was added.
 */
export function createAnnouncementQueue({
  onChange,
  ttlMs = ANNOUNCEMENT_TTL_MS,
  max = 5,
}: {
  onChange: (entries: readonly { id: number; text: string }[]) => void;
  ttlMs?: number;
  max?: number;
}) {
  let entries: { id: number; text: string }[] = [];
  let nextId = 0;
  return {
    announce(text: string): void {
      const id = ++nextId;
      entries = [...entries.slice(-(max - 1)), { id, text }];
      onChange(entries);
      setTimeout(() => {
        entries = entries.filter((entry) => entry.id !== id);
        onChange(entries);
      }, ttlMs);
    },
  };
}

/** The parts of a failed save that decide whether its alert is moot. */
export interface SettleableFailure {
  taskId: string;
  target: TaskStatus;
  retryable: boolean;
}

/**
 * Retryable failures with nothing left to retry: the card has reached its target lane, or
 * (only once the board has finished loading, so an empty list during a reload does not
 * count) the card no longer exists.
 */
export function settledSaveFailureIds(
  list: readonly SettleableFailure[],
  tasks: readonly Pick<Task, 'id' | 'status'>[],
  boardLoaded: boolean,
): string[] {
  return list
    .filter((failure) => {
      if (!failure.retryable) return false;
      const card = tasks.find((task) => task.id === failure.taskId);
      if (!card) return boardLoaded;
      return card.status === failure.target;
    })
    .map((failure) => failure.taskId);
}
