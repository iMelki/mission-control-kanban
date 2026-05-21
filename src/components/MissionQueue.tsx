'use client';

import { useState } from 'react';
import { Plus, ChevronRight, GripVertical, AlertTriangle, Github } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { READINESS_LABELS, REVIEW_MODE_LABELS, RISK_LEVEL_LABELS } from '@/lib/dispatch-contract';
import type { Task, TaskStatus } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { GitHubImportModal } from './GitHubImportModal';
import { formatDistanceToNow } from 'date-fns';

interface MissionQueueProps {
  workspaceId?: string;
}

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'planning', label: '📋 PLANNING', color: 'border-t-mc-accent-purple' },
  { id: 'inbox', label: 'INBOX', color: 'border-t-mc-accent-pink' },
  { id: 'assigned', label: 'ASSIGNED', color: 'border-t-mc-accent-yellow' },
  { id: 'in_progress', label: 'IN PROGRESS', color: 'border-t-mc-accent' },
  { id: 'testing', label: 'TESTING', color: 'border-t-mc-accent-cyan' },
  { id: 'review', label: 'REVIEW', color: 'border-t-mc-accent-purple' },
  { id: 'done', label: 'DONE', color: 'border-t-mc-accent-green' },
];

export function MissionQueue({ workspaceId }: MissionQueueProps) {
  const { tasks, updateTaskStatus, addEvent } = useMissionControl();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGitHubImportModal, setShowGitHubImportModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const blockedInboxTasks = tasks.filter((task) => task.status === 'inbox' && (task.dispatch_blockers?.length ?? 0) > 0);

  const getTasksByStatus = (status: TaskStatus) =>
    tasks.filter((task) => task.status === status);

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    if (!draggedTask || draggedTask.status === targetStatus) {
      setDraggedTask(null);
      return;
    }

    // Optimistic update
    updateTaskStatus(draggedTask.id, targetStatus);

    // Persist to API
    try {
      const res = await fetch(`/api/tasks/${draggedTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      });

      if (res.ok) {
        // Add event
        addEvent({
          id: crypto.randomUUID(),
          type: targetStatus === 'done' ? 'task_completed' : 'task_status_changed',
          task_id: draggedTask.id,
          message: `Task \"${draggedTask.title}\" moved to ${targetStatus}`,
          created_at: new Date().toISOString(),
        });
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to move task');
        updateTaskStatus(draggedTask.id, draggedTask.status);
      }
    } catch (error) {
      console.error('Failed to update task status:', error);
      // Revert on error
      updateTaskStatus(draggedTask.id, draggedTask.status);
    }

    setDraggedTask(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-mc-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChevronRight className="size-4 text-mc-text-secondary" />
          <span className="text-sm font-medium uppercase tracking-wider">Mission Queue</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGitHubImportModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent-cyan text-mc-bg rounded text-sm font-medium hover:bg-mc-accent-cyan/90"
          >
            <Github className="size-4" />
            Import GitHub
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent-pink text-mc-bg rounded text-sm font-medium hover:bg-mc-accent-pink/90"
          >
            <Plus className="size-4" />
            New Task
          </button>
        </div>
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

      {/* Kanban Columns */}
      <div className="flex-1 flex gap-3 p-3 overflow-x-auto">
        {COLUMNS.map((column) => {
          const columnTasks = getTasksByStatus(column.id);
          return (
            <div
              key={column.id}
              className={`flex-1 min-w-[220px] max-w-[300px] flex flex-col bg-mc-bg rounded-lg border border-mc-border/50 border-t-2 ${column.color}`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              {/* Column Header */}
              <div className="p-2 border-b border-mc-border flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-mc-text-secondary">
                  {column.label}
                </span>
                <span className="text-xs bg-mc-bg-tertiary px-2 py-0.5 rounded text-mc-text-secondary">
                  {columnTasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onDragStart={handleDragStart}
                    onClick={() => setEditingTask(task)}
                    isDragging={draggedTask?.id === task.id}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <TaskModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} />
      )}
      {showGitHubImportModal && (
        <GitHubImportModal onClose={() => setShowGitHubImportModal(false)} workspaceId={workspaceId} />
      )}
      {editingTask && (
        <TaskModal task={editingTask} onClose={() => setEditingTask(null)} workspaceId={workspaceId} />
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onClick: () => void;
  isDragging: boolean;
}

function TaskCard({ task, onDragStart, onClick, isDragging }: TaskCardProps) {
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

  const pillClass = (tone: 'ready' | 'warn' | 'risk' | 'neutral') => {
    switch (tone) {
      case 'ready':
        return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
      case 'warn':
        return 'bg-amber-500/10 text-amber-300 border border-amber-500/30';
      case 'risk':
        return 'bg-rose-500/10 text-rose-300 border border-rose-500/30';
      default:
        return 'bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border/50';
    }
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      className={`group bg-mc-bg-secondary border rounded-lg cursor-pointer transition-all hover:shadow-lg hover:shadow-black/20 ${
        isDragging ? 'opacity-50 scale-95' : ''
      } ${isPlanning ? 'border-purple-500/40 hover:border-purple-500' : 'border-mc-border/50 hover:border-mc-accent/40'}`}
    >
        {/* Drag handle bar */}
        <div className="flex items-center justify-center py-1.5 border-b border-mc-border/30 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="size-4 text-mc-text-secondary/50 cursor-grab" />
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
          <div className="flex items-center gap-2 mb-3 py-1.5 px-2 bg-mc-bg-tertiary/50 rounded">
            <span className="text-base">{(task.assigned_agent as unknown as { avatar_emoji: string }).avatar_emoji}</span>
            <span className="text-xs text-mc-text-secondary truncate">
              {(task.assigned_agent as unknown as { name: string }).name}
            </span>
          </div>
        )}

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
          <span className="text-[10px] text-mc-text-secondary/60" suppressHydrationWarning>
            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
}
