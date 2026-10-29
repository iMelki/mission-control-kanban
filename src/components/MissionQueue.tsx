'use client';

import { useReducer, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Plus, AlertTriangle, Hand } from 'lucide-react';
import { Github } from '@/components/icons/BrandIcons';
import { BoardLane, type BoardLaneColumn } from '@/components/board/board-lane';
import { TaskCard, needsCaptain } from '@/components/board/task-card';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { presentBoardCount } from '@/lib/cockpit-load-state';
import { useMissionControl } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  requiresDispatchContractBeforeWorkStarts,
  summarizeDispatchContract,
  validateDispatchMetadata,
} from '@/lib/dispatch-contract';
import { resolveAgentRuntime } from '@/lib/agent-runtimes';
import type { AgentRuntimeType, Task, TaskStatus } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { GitHubImportModal } from './GitHubImportModal';

interface MissionQueueProps {
  workspaceId?: string;
}

type RuntimeFilter = 'all' | AgentRuntimeType | 'dispatch_off';

const RUNTIME_FILTERS: { id: RuntimeFilter; label: string }[] = [
  { id: 'all', label: 'All runtimes' },
  { id: 'manual', label: 'Manual' },
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'webhook', label: 'Webhook' },
  { id: 'dispatch_off', label: 'Dispatch off' },
];

// Lanes are neutral (direction B): identity is label + count + order, not seven hues.
const COLUMNS: BoardLaneColumn[] = [
  { id: 'planning', label: 'Planning' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'testing', label: 'Testing' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

const COLUMN_IDS = new Set<string>(COLUMNS.map((column) => column.id));
const COLUMN_LABELS = new Map<string, string>(COLUMNS.map((column) => [column.id, column.label]));

// "Ink drying": how long the accent rail layer stays mounted after a move. A
// little longer than --duration-slower (360ms) so the fade always completes.
const INK_DRY_MS = 420;

interface MissionQueueUiState {
  showCreateModal: boolean;
  showGitHubImportModal: boolean;
  editingTask: Task | null;
  dropError: string | null;
  runtimeFilter: RuntimeFilter;
  needsYouOnly: boolean;
}

type MissionQueueUiAction =
  | { type: 'open_create_modal' }
  | { type: 'close_create_modal' }
  | { type: 'open_github_import_modal' }
  | { type: 'close_github_import_modal' }
  | { type: 'edit_task'; task: Task }
  | { type: 'clear_editing_task' }
  | { type: 'set_drop_error'; error: string | null }
  | { type: 'set_runtime_filter'; filter: RuntimeFilter }
  | { type: 'toggle_needs_you' };

const initialMissionQueueUiState: MissionQueueUiState = {
  showCreateModal: false,
  showGitHubImportModal: false,
  editingTask: null,
  dropError: null,
  runtimeFilter: 'all',
  needsYouOnly: false,
};

function missionQueueUiReducer(
  state: MissionQueueUiState,
  action: MissionQueueUiAction,
): MissionQueueUiState {
  switch (action.type) {
    case 'open_create_modal':
      return { ...state, showCreateModal: true };
    case 'close_create_modal':
      return { ...state, showCreateModal: false };
    case 'open_github_import_modal':
      return { ...state, showGitHubImportModal: true };
    case 'close_github_import_modal':
      return { ...state, showGitHubImportModal: false };
    case 'edit_task':
      return { ...state, editingTask: action.task };
    case 'clear_editing_task':
      return { ...state, editingTask: null };
    case 'set_drop_error':
      return { ...state, dropError: action.error };
    case 'set_runtime_filter':
      return { ...state, runtimeFilter: action.filter };
    case 'toggle_needs_you':
      return { ...state, needsYouOnly: !state.needsYouOnly };
    default:
      return state;
  }
}

export function MissionQueue({ workspaceId }: MissionQueueProps) {
  const { tasks, updateTaskStatus, addEvent, boardLoadStatus } = useMissionControl();
  const [uiState, dispatchUi] = useReducer(
    missionQueueUiReducer,
    initialMissionQueueUiState,
  );
  const {
    showCreateModal,
    showGitHubImportModal,
    editingTask,
    dropError,
    runtimeFilter,
    needsYouOnly,
  } = uiState;

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // The lane under the carried card, whether the pointer is over the lane itself
  // or over one of its cards (dnd-kit reports the card then, not the lane).
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const [inkTask, setInkTask] = useState<{ id: string; key: number } | null>(null);
  const inkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const matchesRuntimeFilter = (task: Task) => {
    if (runtimeFilter === 'all') return true;
    const runtime = resolveAgentRuntime(task.assigned_agent);
    if (runtimeFilter === 'dispatch_off') return Boolean(runtime.reason);
    return runtime.requested_type === runtimeFilter || runtime.effective_type === runtimeFilter;
  };

  const runtimeTasks = tasks.filter(matchesRuntimeFilter);
  const needsYouCount = runtimeTasks.filter(needsCaptain).length;
  const visibleTasks = needsYouOnly ? runtimeTasks.filter(needsCaptain) : runtimeTasks;
  const getTasksByStatus = (status: TaskStatus) =>
    visibleTasks.filter((task) => task.status === status);

  const taskTitle = (id: UniqueIdentifier) => tasks.find((task) => task.id === id)?.title ?? 'task';
  const laneLabel = (overId: UniqueIdentifier | undefined) => {
    if (overId == null) return null;
    const status = resolveTargetStatus(String(overId));
    return status ? COLUMN_LABELS.get(status) ?? status : null;
  };

  // Spoken through dnd-kit's polite live region. The move is always announced,
  // which is what reduced motion keeps when the tilt, lift and ink are gone.
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${taskTitle(active.id)}.`,
    onDragOver: ({ active, over }) => {
      const lane = laneLabel(over?.id);
      return lane ? `${taskTitle(active.id)} is over ${lane}.` : `${taskTitle(active.id)} is not over a lane.`;
    },
    onDragEnd: ({ active, over }) => {
      const lane = laneLabel(over?.id);
      if (!lane) return `${taskTitle(active.id)} was dropped outside the board.`;
      const task = tasks.find((candidate) => candidate.id === active.id);
      const target = over ? resolveTargetStatus(String(over.id)) : null;
      if (task && target && task.status === target) return `${task.title} stayed in ${lane}.`;
      // Same synchronous gate moveTask applies; never announce a move it refuses.
      if (task && target && isGatedByDispatchContract(task, target)) {
        return `${task.title} cannot move to ${lane} yet: the dispatch contract is incomplete.`;
      }
      return `Moved ${taskTitle(active.id)} to ${lane}.`;
    },
    onDragCancel: ({ active }) => `Move cancelled. ${taskTitle(active.id)} stayed where it was.`,
  };

  const dropAnimation: DropAnimation | null = reducedMotion
    ? null
    : {
        duration: 240,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }),
      };

  const markInkDrying = (taskId: string) => {
    if (inkTimer.current) clearTimeout(inkTimer.current);
    setInkTask((previous) => ({ id: taskId, key: (previous?.key ?? 0) + 1 }));
    inkTimer.current = setTimeout(() => setInkTask(null), INK_DRY_MS);
  };

  const resolveTargetStatus = (overId: string): TaskStatus | null => {
    if (COLUMN_IDS.has(overId)) return overId as TaskStatus;
    const overTask = tasks.find((task) => task.id === overId);
    return overTask ? overTask.status : null;
  };

  const isGatedByDispatchContract = (task: Task, targetStatus: TaskStatus) =>
    Boolean(task.github_source)
    && requiresDispatchContractBeforeWorkStarts(targetStatus)
    && !validateDispatchMetadata(task.dispatch_metadata).canDispatch;

  const moveTask = async (task: Task, targetStatus: TaskStatus) => {
    if (task.status === targetStatus) return;

    dispatchUi({ type: 'set_drop_error', error: null });

    if (task.github_source && requiresDispatchContractBeforeWorkStarts(targetStatus)) {
      const validation = validateDispatchMetadata(task.dispatch_metadata);
      if (!validation.canDispatch) {
        const summary = summarizeDispatchContract(task.dispatch_metadata);
        const message = `${task.title} cannot move to ${targetStatus.replace('_', ' ')} yet: ${summary.headline}.`;

        dispatchUi({ type: 'set_drop_error', error: `${message} ${validation.blockers.join('; ')}`.trim() });
        addEvent({
          id: crypto.randomUUID(),
          type: 'system',
          task_id: task.id,
          message,
          created_at: new Date().toISOString(),
        });
        return;
      }
    }

    // Optimistic update
    updateTaskStatus(task.id, targetStatus);
    markInkDrying(task.id);

    // Persist to API
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      });

      if (res.ok) {
        addEvent({
          id: crypto.randomUUID(),
          type: targetStatus === 'done' ? 'task_completed' : 'task_status_changed',
          task_id: task.id,
          message: `Task \"${task.title}\" moved to ${targetStatus}`,
          created_at: new Date().toISOString(),
        });
      } else {
        const data = await res.json().catch(() => ({}));
        dispatchUi({ type: 'set_drop_error', error: data.error || 'Failed to move task' });
        updateTaskStatus(task.id, task.status);
      }
    } catch (error) {
      console.error('Failed to update task status:', error);
      dispatchUi({
        type: 'set_drop_error',
        error: error instanceof Error ? error.message : 'Failed to update task status',
      });
      // Revert on error
      updateTaskStatus(task.id, task.status);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((candidate) => candidate.id === event.active.id);
    setActiveTask(task ?? null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverStatus(event.over ? resolveTargetStatus(String(event.over.id)) : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    setOverStatus(null);
    if (!over) return;

    const task = tasks.find((candidate) => candidate.id === active.id);
    if (!task) return;

    const targetStatus = resolveTargetStatus(String(over.id));
    if (!targetStatus) return;

    void moveTask(task, targetStatus);
  };

  const handleDragCancel = () => {
    setActiveTask(null);
    setOverStatus(null);
  };

  return (
    // min-w-0 lets the board shrink inside the lg row instead of being crushed to a
    // 0px content box (#142). Below lg the cockpit is one scrolling column, so the
    // queue must not clip: with real data the header blocks filled a clipped 60vh box
    // and left the lanes 24px tall. The board region carries its own mobile height
    // instead (lanes scroll inside it).
    <div className="flex-1 min-w-0 lg:min-h-0 flex flex-col lg:overflow-hidden">
      {/* Header: title, count, "Needs you" and actions on one row; the runtime filter joins it on wide screens and drops under it otherwise. */}
      <div className="px-3 py-2 border-b border-mc-border flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto flex min-w-0 flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-mc-text">Mission Queue</h2>
          <span className="text-xs text-mc-text-secondary" role="status">
            {presentBoardCount(boardLoadStatus, visibleTasks.length, tasks.length).text}
          </span>
          {/* The "needs Captain" answer in one glance: Review plus dispatch-blocked
              Inbox. One of the accent's four uses; pressing it filters the board. */}
          <button
            type="button"
            data-needs-you
            aria-pressed={needsYouOnly}
            onClick={() => dispatchUi({ type: 'toggle_needs_you' })}
            className={cn(
              'inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tabular-nums active:scale-[0.98] transition-transform duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-text focus-visible:ring-offset-2 focus-visible:ring-offset-mc-bg',
              needsYouOnly
                ? 'bg-mc-accent text-mc-accent-ink ring-2 ring-inset ring-mc-accent-ink/40'
                : needsYouCount > 0
                  ? 'bg-mc-accent text-mc-accent-ink'
                  : 'bg-mc-bg-tertiary text-mc-text-secondary',
            )}
          >
            <Hand aria-hidden="true" className="size-3.5" />
            <span>Needs you</span>
            <span aria-hidden="true">·</span>
            <span>{needsYouCount}</span>
            <span className="sr-only">{needsYouOnly ? ', showing only these' : ', press to show only these'}</span>
          </button>
        </div>
        <div role="group" aria-label="Runtime filter" className="order-last flex basis-full flex-wrap items-center gap-1.5 2xl:order-none 2xl:basis-auto">
          <span className="mr-1 text-xs uppercase tracking-wider text-mc-text-secondary">Runtime filter</span>
          {RUNTIME_FILTERS.map((filterOption) => (
            <button
              key={filterOption.id}
              type="button"
              aria-pressed={runtimeFilter === filterOption.id}
              onClick={() => dispatchUi({ type: 'set_runtime_filter', filter: filterOption.id })}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                runtimeFilter === filterOption.id
                  ? 'border-mc-text-secondary/60 bg-mc-bg-tertiary text-mc-text'
                  : 'border-mc-border text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text'
              }`}
            >
              {filterOption.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => dispatchUi({ type: 'open_github_import_modal' })}
            className="flex items-center gap-2 rounded border border-mc-text-secondary/60 px-3 py-1.5 text-sm font-medium text-mc-text hover:bg-mc-bg-tertiary active:scale-[0.98] transition-transform duration-fast"
          >
            <Github className="size-4" />
            Import GitHub
          </button>
          <button
            type="button"
            onClick={() => dispatchUi({ type: 'open_create_modal' })}
            className="flex items-center gap-2 rounded bg-mc-accent px-3 py-1.5 text-sm font-semibold text-mc-accent-ink hover:bg-mc-accent/90 active:scale-[0.98] transition-transform duration-fast"
          >
            <Plus className="size-4" />
            New Task
          </button>
        </div>
      </div>

      {dropError && (
        <div role="alert" className="mx-3 mt-3 rounded-lg bg-mc-bg-secondary px-3 py-2 text-sm text-mc-text ring-1 ring-inset ring-mc-danger/60">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 text-mc-danger" />
            <div className="min-w-0">
              <p className="font-medium">Dispatch move blocked</p>
              <p className="mt-1 text-xs text-mc-text [overflow-wrap:anywhere]">{dropError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Kanban Columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{ announcements }}
      >
        <div
          role="region"
          tabIndex={0}
          aria-label="Mission queue board"
          className="h-[75dvh] shrink-0 lg:h-auto lg:shrink lg:flex-1 lg:min-h-0 flex gap-3 overflow-x-auto overflow-y-hidden p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mc-accent"
        >
          {COLUMNS.map((column) => (
            <BoardLane
              key={column.id}
              column={column}
              tasks={getTasksByStatus(column.id)}
              activeTaskId={activeTask?.id ?? null}
              isDropTarget={activeTask !== null && overStatus === column.id && activeTask.status !== column.id}
              inkTask={inkTask}
              onCardClick={(task) => dispatchUi({ type: 'edit_task', task })}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          {activeTask ? <TaskCard task={activeTask} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      {/* Modals */}
      {showCreateModal && (
        <TaskModal onClose={() => dispatchUi({ type: 'close_create_modal' })} workspaceId={workspaceId} />
      )}
      {showGitHubImportModal && (
        <GitHubImportModal onClose={() => dispatchUi({ type: 'close_github_import_modal' })} workspaceId={workspaceId} />
      )}
      {editingTask && (
        <TaskModal task={editingTask} onClose={() => dispatchUi({ type: 'clear_editing_task' })} workspaceId={workspaceId} />
      )}
    </div>
  );
}
