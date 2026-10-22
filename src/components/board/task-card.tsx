'use client';

import type { useSortable } from '@dnd-kit/sortable';
import { AlertTriangle, GripVertical } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { EntityEmoji } from '@/components/ui/EntityEmoji';
import { DependencyBadges } from '@/components/DependencyBadges';
import { cn } from '@/lib/utils';
import { READINESS_LABELS, REVIEW_MODE_LABELS, RISK_LEVEL_LABELS } from '@/lib/dispatch-contract';
import { AGENT_RUNTIME_LABELS, resolveAgentRuntime } from '@/lib/agent-runtimes';
import type { Task } from '@/lib/types';
import { railToneFor, type RailTone } from './task-status';

/**
 * Owned board card primitive (mission-control-kanban#48, studio direction B).
 *
 * Identity by FILL: the card sits one step up the surface ladder
 * (bg -> lane -> card), so it reads as an object on the lane without relying on
 * a border that cannot reach 3:1 (WCAG 1.4.11). A 3 px left rail carries the
 * status tone. The accent appears on the rail only for work that needs Captain
 * (Review), which is the same signal as the board's "Needs you" chip, and for
 * the brief "ink drying" cross-fade after a move.
 */

const RAIL_CLASS: Record<RailTone, string> = {
  neutral: 'bg-mc-text-secondary',
  active: 'bg-mc-text',
  'needs-you': 'bg-mc-accent',
  warn: 'bg-mc-warn',
  done: 'bg-mc-success',
};

type PillTone = 'ready' | 'warn' | 'risk' | 'neutral';

// Pills are opaque (bg-mc-bg) so tone text clears 4.5:1 whatever surface the
// card sits on; a translucent tone fill over the card drops danger to 4.43:1.
function pillClass(tone: PillTone): string {
  switch (tone) {
    case 'ready':
      return 'bg-mc-bg text-mc-success border border-mc-success/40';
    case 'warn':
      return 'bg-mc-bg text-mc-warn border border-mc-warn/40';
    case 'risk':
      return 'bg-mc-bg text-mc-danger border border-mc-danger/40';
    default:
      return 'bg-mc-bg text-mc-text-secondary border border-mc-border';
  }
}

const PRIORITY_TEXT: Record<Task['priority'], string> = {
  low: 'text-mc-text-secondary',
  normal: 'text-mc-text-secondary',
  high: 'text-mc-warn',
  urgent: 'text-mc-danger',
};

const PRIORITY_DOT: Record<Task['priority'], string> = {
  low: 'bg-mc-border',
  normal: 'bg-mc-text-secondary',
  high: 'bg-mc-warn',
  urgent: 'bg-mc-danger',
};

export interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  isDragging?: boolean;
  isOverlay?: boolean;
  /** Changes on each settled move so the rail's ink cross-fade restarts. */
  inkKey?: number | null;
  dragAttributes?: ReturnType<typeof useSortable>['attributes'];
  dragListeners?: ReturnType<typeof useSortable>['listeners'];
}

export function TaskCard({ task, onClick, isDragging, isOverlay, inkKey, dragAttributes, dragListeners }: TaskCardProps) {
  const isPlanning = task.status === 'planning';
  const blockers = task.dispatch_blockers ?? [];
  const readiness = task.dispatch_metadata?.readiness;
  const reviewMode = task.dispatch_metadata?.review_mode;
  const riskLevel = task.dispatch_metadata?.risk_level;
  const runtime = resolveAgentRuntime(task.assigned_agent);
  const runtimeTone: PillTone = runtime.effective_type === 'manual'
    ? 'neutral'
    : runtime.effective_type === 'openclaw'
      ? 'ready'
      : 'warn';
  const agent = task.assigned_agent as unknown as { name: string; avatar_emoji: string } | undefined;

  return (
    <div
      data-task-card
      data-rail-tone={railToneFor(task)}
      className={cn(
        'group relative w-full min-w-0 overflow-hidden rounded-md bg-mc-bg-tertiary pl-[var(--mc-rail-width)] text-left ring-1 ring-inset ring-mc-border/70 hover:ring-mc-text-secondary/50',
        isDragging && 'opacity-40',
        isOverlay && 'mc-note-lifted overflow-visible ring-mc-accent/70',
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[var(--mc-rail-width)]', RAIL_CLASS[railToneFor(task)])} />
      {inkKey != null && (
        <span
          key={inkKey}
          aria-hidden="true"
          data-rail-ink
          className="mc-rail-ink absolute inset-y-0 left-0 w-[var(--mc-rail-width)] bg-mc-accent"
        />
      )}

      {/* The reorder and open actions are sibling buttons. A clickable card
          wrapper around the dnd-kit handle creates nested interactive controls. */}
      {dragAttributes && dragListeners ? (
        <button
          type="button"
          data-task-drag-handle
          {...dragAttributes}
          {...dragListeners}
          aria-label={`Reorder task ${task.title}`}
          className="flex w-full cursor-grab items-center justify-center py-1.5 opacity-0 transition-opacity duration-fast hover:bg-mc-bg-secondary/60 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mc-accent active:cursor-grabbing group-hover:opacity-100"
        >
          <GripVertical className="size-4 text-mc-text-secondary" />
        </button>
      ) : (
        <div aria-hidden="true" className="flex items-center justify-center py-1.5">
          <GripVertical className="size-4 text-mc-text-secondary" />
        </div>
      )}

      <button
        type="button"
        data-task-open
        onClick={onClick}
        disabled={!onClick}
        aria-label={`Open task ${task.title}`}
        className="block w-full min-w-0 cursor-pointer px-3 pb-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mc-accent"
      >
        {/* Long unbroken tokens (URLs, branch names) must wrap, not widen the card. */}
        <h4 className="mb-3 line-clamp-3 text-sm font-medium leading-snug text-mc-text [overflow-wrap:anywhere]">
          {task.title}
        </h4>

        {isPlanning && (
          <div className="mb-3 flex items-center gap-2 rounded bg-mc-bg px-2.5 py-1.5">
            <span className="size-2 flex-shrink-0 rounded-full bg-mc-text-secondary animate-pulse" />
            <span className="text-xs font-medium text-mc-text-secondary">Continue planning</span>
          </div>
        )}

        {agent && (
          <div className="mb-3 min-w-0 rounded bg-mc-bg-secondary px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <EntityEmoji emoji={agent.avatar_emoji} hidden className="text-base" />
              <span className="min-w-0 truncate text-xs text-mc-text-secondary">{agent.name}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${pillClass(runtimeTone)}`}>
                {runtime.label || AGENT_RUNTIME_LABELS.manual}
              </span>
              {runtime.reason && (
                <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${pillClass('neutral')}`}>
                  Dispatch off
                </span>
              )}
            </div>
          </div>
        )}

        <DependencyBadges blockedBy={task.blocked_by} blocking={task.blocking} />

        {(readiness || reviewMode || riskLevel) && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {readiness && (
              <span className={`rounded px-2 py-1 text-[10px] font-medium ${task.dispatch_ready ? pillClass('ready') : pillClass('warn')}`}>
                {READINESS_LABELS[readiness]}
              </span>
            )}
            {reviewMode && (
              <span className={`rounded px-2 py-1 text-[10px] font-medium ${pillClass('neutral')}`}>
                {REVIEW_MODE_LABELS[reviewMode]}
              </span>
            )}
            {riskLevel && (
              <span className={`rounded px-2 py-1 text-[10px] font-medium ${['high', 'critical'].includes(riskLevel) ? pillClass('risk') : pillClass('warn')}`}>
                {RISK_LEVEL_LABELS[riskLevel]}
              </span>
            )}
          </div>
        )}

        {blockers.length > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded bg-mc-bg px-2.5 py-2 ring-1 ring-inset ring-mc-warn/40">
            <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0 text-mc-warn" />
            <div className="min-w-0 space-y-1">
              <span className="block text-[11px] text-mc-text line-clamp-2 [overflow-wrap:anywhere]">
                {blockers[0]}
                {blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ''}
              </span>
              {task.status === 'inbox' && (
                <span className="block text-[10px] text-mc-text-secondary">
                  Still in Inbox until the Dispatch Contract is complete. Open the task to fill scope, tests, and rollback.
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${PRIORITY_DOT[task.priority]}`} />
            <span className={`text-xs capitalize ${PRIORITY_TEXT[task.priority]}`}>{task.priority}</span>
          </div>
          <span className="text-[10px] text-mc-text-muted" suppressHydrationWarning>
            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
          </span>
        </div>
      </button>
    </div>
  );
}
