'use client';

import { useReducer, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, ChevronRight, GripVertical, AlertTriangle } from 'lucide-react';
import { Github } from '@/components/icons/BrandIcons';
import { EntityEmoji } from '@/components/ui/EntityEmoji';
import { presentBoardCount } from '@/lib/cockpit-load-state';
import { useMissionControl } from '@/lib/store';
import {
  READINESS_LABELS,
  REVIEW_MODE_LABELS,
  RISK_LEVEL_LABELS,
  requiresDispatchContractBeforeWorkStarts,
  summarizeDispatchContract,
  validateDispatchMetadata,
} from '@/lib/dispatch-contract';
import { AGENT_RUNTIME_LABELS, resolveAgentRuntime } from '@/lib/agent-runtimes';
import type { AgentRuntimeType, Task, TaskStatus } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { GitHubImportModal } from './GitHubImportModal';
import { GitHubConnectionStatus } from './GitHubConnectionStatus';
import { GitHubReadinessCard } from './GitHubReadinessCard';
import { DependencyBadges } from './DependencyBadges';
import { formatDistanceToNow } from 'date-fns';

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

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'planning', label: 'PLANNING', color: 'border-t-mc-accent-purple' },
  { id: 'inbox', label: 'INBOX', color: 'border-t-mc-accent-pink' },
  { id: 'assigned', label: 'ASSIGNED', color: 'border-t-mc-accent-yellow' },
  { id: 'in_progress', label: 'IN PROGRESS', color: 'border-t-mc-accent' },
  { id: 'testing', label: 'TESTING', color: 'border-t-mc-accent-cyan' },
  { id: 'review', label: 'REVIEW', color: 'border-t-mc-accent-purple' },
  { id: 'done', label: 'DONE', color: 'border-t-mc-accent-green' },
];

const COLUMN_IDS = new Set<string>(COLUMNS.map((column) => column.id));

interface MissionQueueUiState {
  showCreateModal: boolean;
  showGitHubImportModal: boolean;
  editingTask: Task | null;
  dropError: string | null;
  runtimeFilter: RuntimeFilter;
}

type MissionQueueUiAction =
  | { type: 'open_create_modal' }
  | { type: 'close_create_modal' }
  | { type: 'open_github_import_modal' }
  | { type: 'close_github_import_modal' }
  | { type: 'edit_task'; task: Task }
  | { type: 'clear_editing_task' }
  | { type: 'set_drop_error'; error: string | null }
  | { type: 'set_runtime_filter'; filter: RuntimeFilter };

const initialMissionQueueUiState: MissionQueueUiState = {
  showCreateModal: false,
  showGitHubImportModal: false,
  editingTask: null,
  dropError: null,
  runtimeFilter: 'all',
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
  } = uiState;

  const [activeTask, setActiveTask] = useState<Task | null>(null);

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

  const visibleTasks = tasks.filter(matchesRuntimeFilter);
  const blockedInboxTasks = visibleTasks.filter((task) => task.status === 'inbox' && (task.dispatch_blockers?.length ?? 0) > 0);
  const getTasksByStatus = (status: TaskStatus) =>
    visibleTasks.filter((task) => task.status === status);

  const resolveTargetStatus = (overId: string): TaskStatus | null => {
    if (COLUMN_IDS.has(overId)) return overId as TaskStatus;
    const overTask = tasks.find((task) => task.id === overId);
    return overTask ? overTask.status : null;
  };

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;

    const task = tasks.find((candidate) => candidate.id === active.id);
    if (!task) return;

    const targetStatus = resolveTargetStatus(String(over.id));
    if (!targetStatus) return;

    void moveTask(task, targetStatus);
  };

  const handleDragCancel = () => {
    setActiveTask(null);
  };

  return (
    // min-w-0 lets the board shrink inside the lg row instead of being crushed to a
    // 0px content box; the mobile min-height keeps the stacked board usable (#142).
    <div className="flex-1 min-w-0 min-h-[60vh] lg:min-h-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-mc-border flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChevronRight className="size-4 text-mc-text-secondary" />
          <span className="text-sm font-medium uppercase tracking-wider">Mission Queue</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <GitHubConnectionStatus />
          <button
            type="button"
            onClick={() => dispatchUi({ type: 'open_github_import_modal' })}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium border border-mc-accent/70 text-mc-accent hover:bg-mc-accent/10 active:scale-[0.98] transition-transform duration-fast"
          >
            <Github className="size-4" />
            Import GitHub
          </button>
          <button
            type="button"
            onClick={() => dispatchUi({ type: 'open_create_modal' })}
            className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90 active:scale-[0.98] transition-transform duration-fast"
          >
            <Plus className="size-4" />
            New Task
          </button>
        </div>
      </div>

      <GitHubReadinessCard />

      <div className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-mc-border/60 bg-mc-bg-secondary/60 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-mc-text-secondary">Runtime filter</span>
        {RUNTIME_FILTERS.map((filterOption) => (
          <button
            key={filterOption.id}
            type="button"
            onClick={() => dispatchUi({ type: 'set_runtime_filter', filter: filterOption.id })}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              runtimeFilter === filterOption.id
                ? 'border-mc-accent bg-mc-accent/20 text-mc-accent'
                : 'border-mc-border text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text'
            }`}
          >
            {filterOption.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-mc-text-secondary" role="status">
          {presentBoardCount(boardLoadStatus, visibleTasks.length, tasks.length).text}
        </span>
      </div>

      {blockedInboxTasks.length > 0 && (
        <div className="mx-3 mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 text-amber-300" />
            <div>
              <p className="font-medium">Inbox is acting as a safety gate for imported GitHub work.</p>
              <p className="mt-1 text-xs text-amber-100/90">
                {blockedInboxTasks.length} task{blockedInboxTasks.length === 1 ? '' : 's'} cannot move into
                active columns yet because the dispatch contract is incomplete. Open the card and fill
                allowed file scope, acceptance criteria, test requirements, impact, and rollback details.
              </p>
            </div>
          </div>
        </div>
      )}

      {dropError && (
        <div className="mx-3 mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 text-rose-300" />
            <div>
              <p className="font-medium">Dispatch move blocked</p>
              <p className="mt-1 text-xs text-rose-100/90">{dropError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Kanban Columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto overflow-y-hidden p-3">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={getTasksByStatus(column.id)}
              activeTaskId={activeTask?.id ?? null}
              onCardClick={(task) => dispatchUi({ type: 'edit_task', task })}
            />
          ))}
        </div>

        <DragOverlay>
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

interface KanbanColumnProps {
  column: { id: TaskStatus; label: string; color: string };
  tasks: Task[];
  activeTaskId: string | null;
  onCardClick: (task: Task) => void;
}

function KanbanColumn({ column, tasks, activeTaskId, onCardClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-h-0 min-w-[220px] max-w-[300px] flex flex-col bg-mc-bg rounded-lg border border-mc-border/50 border-t-2 transition-colors ${column.color} ${
        isOver ? 'ring-2 ring-mc-accent/50' : ''
      }`}
    >
      {/* Column Header */}
      <div className="p-2 border-b border-mc-border flex items-center justify-between">
        <span className="text-xs font-medium uppercase text-mc-text-secondary">
          {column.label}
        </span>
        <span className="text-xs bg-mc-bg-tertiary px-2 py-0.5 rounded text-mc-text-secondary">
          {tasks.length}
        </span>
      </div>

      {/* Tasks */}
      <ul className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 list-none" aria-label={`${column.label} tasks`}>
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onClick={() => onCardClick(task)}
              isActive={activeTaskId === task.id}
            />
          ))}
        </SortableContext>
      </ul>
    </div>
  );
}

function SortableTaskCard({ task, onClick, isActive }: { task: Task; onClick: () => void; isActive: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <TaskCard
        task={task}
        onClick={onClick}
        isDragging={isDragging || isActive}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </li>
  );
}

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  isDragging?: boolean;
  isOverlay?: boolean;
  dragAttributes?: ReturnType<typeof useSortable>['attributes'];
  dragListeners?: ReturnType<typeof useSortable>['listeners'];
}

function TaskCard({ task, onClick, isDragging, isOverlay, dragAttributes, dragListeners }: TaskCardProps) {
  const priorityStyles = {
    low: 'text-mc-text-secondary',
    normal: 'text-mc-accent',
    high: 'text-mc-accent-yellow',
    urgent: 'text-mc-accent-red',
  };

  const priorityDots = {
    low: 'bg-mc-text-secondary/40',
    normal: 'bg-mc-accent',
    high: 'bg-mc-accent-yellow',
    urgent: 'bg-mc-accent-red',
  };

  const isPlanning = task.status === 'planning';
  const blockers = task.dispatch_blockers ?? [];
  const readiness = task.dispatch_metadata?.readiness;
  const reviewMode = task.dispatch_metadata?.review_mode;
  const riskLevel = task.dispatch_metadata?.risk_level;
  const runtime = resolveAgentRuntime(task.assigned_agent);
  const runtimeTone = runtime.effective_type === 'manual'
    ? 'neutral'
    : runtime.effective_type === 'openclaw'
      ? 'ready'
      : 'warn';

  const pillClass = (tone: 'ready' | 'warn' | 'risk' | 'neutral') => {
    switch (tone) {
      case 'ready':
        return 'bg-mc-success/10 text-mc-success border border-mc-success/30';
      case 'warn':
        return 'bg-mc-warn/10 text-mc-warn border border-mc-warn/30';
      case 'risk':
        return 'bg-mc-danger/10 text-mc-danger border border-mc-danger/30';
      default:
        return 'bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border/50';
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && onClick) {
          event.preventDefault();
          onClick();
        }
      }}
      className={`group w-full bg-mc-bg-secondary border rounded-lg cursor-pointer text-left transition-[border-color,box-shadow] hover:shadow-lg hover:shadow-black/20 ${
        isDragging ? 'opacity-50 scale-95' : ''
      } ${isOverlay ? 'shadow-xl shadow-black/40' : ''} ${isPlanning ? 'border-purple-500/40 hover:border-purple-500' : 'border-mc-border/50 hover:border-mc-accent/40'}`}
    >
        {/* Drag handle bar */}
        <div
          {...(dragAttributes ?? {})}
          {...(dragListeners ?? {})}
          className="flex items-center justify-center py-1.5 border-b border-mc-border/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
          aria-label={`Reorder task ${task.title}`}
        >
          <GripVertical className="size-4 text-mc-text-secondary/50" />
        </div>

      {/* Card content */}
      <div className="p-4">
        {/* Title */}
        <h4 className="text-sm font-medium leading-snug line-clamp-2 mb-3">
          {task.title}
        </h4>

        {/* Planning mode indicator */}
        {isPlanning && (
          <div className="flex items-center gap-2 mb-3 py-2 px-3 bg-purple-500/10 rounded-md border border-purple-500/20">
            <div className="size-2 bg-purple-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-purple-400 font-medium">Continue planning</span>
          </div>
        )}

        {/* Assigned agent */}
        {task.assigned_agent && (
          <div className="mb-3 rounded bg-mc-bg-tertiary/50 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <EntityEmoji emoji={(task.assigned_agent as unknown as { avatar_emoji: string }).avatar_emoji} hidden className="text-base" />
              <span className="text-xs text-mc-text-secondary truncate">
                {(task.assigned_agent as unknown as { name: string }).name}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${pillClass(runtimeTone)}`}>
                {runtime.label || AGENT_RUNTIME_LABELS.manual}
              </span>
              {runtime.reason && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-mc-bg border border-mc-border/50 text-mc-text-secondary">
                  Dispatch off
                </span>
              )}
            </div>
          </div>
        )}

        <DependencyBadges blockedBy={task.blocked_by} blocking={task.blocking} />

        {(readiness || reviewMode || riskLevel) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {readiness && (
              <span className={`px-2 py-1 rounded text-[10px] font-medium ${task.dispatch_ready ? pillClass('ready') : pillClass('warn')}`}>
                {READINESS_LABELS[readiness]}
              </span>
            )}
            {reviewMode && (
              <span className={`px-2 py-1 rounded text-[10px] font-medium ${pillClass('neutral')}`}>
                {REVIEW_MODE_LABELS[reviewMode]}
              </span>
            )}
            {riskLevel && (
              <span className={`px-2 py-1 rounded text-[10px] font-medium ${['high', 'critical'].includes(riskLevel) ? pillClass('risk') : pillClass('warn')}`}>
                {RISK_LEVEL_LABELS[riskLevel]}
              </span>
            )}
          </div>
        )}

        {blockers.length > 0 && (
          <div className="flex items-start gap-2 mb-3 py-2 px-2.5 rounded-md border border-rose-500/20 bg-rose-500/10">
            <AlertTriangle className="size-3.5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="block text-[11px] text-rose-200 line-clamp-2">
                {blockers[0]}
                {blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ''}
              </span>
              {task.status === 'inbox' && (
                <span className="block text-[10px] text-amber-200/90">
                  Still in Inbox until the Dispatch Contract is complete. Open the task to fill scope, tests, and rollback.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Footer: priority + timestamp */}
        <div className="flex items-center justify-between pt-2 border-t border-mc-border/20">
          <div className="flex items-center gap-1.5">
            <div className={`size-1.5 rounded-full ${priorityDots[task.priority]}`} />
            <span className={`text-xs capitalize ${priorityStyles[task.priority]}`}>
              {task.priority}
            </span>
          </div>
          <span className="text-[10px] text-mc-text-muted" suppressHydrationWarning>
            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
}
