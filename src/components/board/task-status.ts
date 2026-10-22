import type { Task } from '@/lib/types';

/**
 * Status helpers for the board card (mission-control-kanban#48). Kept out of
 * task-card.tsx so that file exports only components (Fast Refresh, React
 * Doctor only-export-components).
 */

export type RailTone = 'neutral' | 'active' | 'needs-you' | 'warn' | 'done';

export function isDispatchBlockedInbox(task: Task): boolean {
  return task.status === 'inbox' && (task.dispatch_blockers?.length ?? 0) > 0;
}

/** Review work and dispatch-blocked Inbox work wait on Captain. */
export function needsCaptain(task: Task): boolean {
  return task.status === 'review' || isDispatchBlockedInbox(task);
}

export function railToneFor(task: Task): RailTone {
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
