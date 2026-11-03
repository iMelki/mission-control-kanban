'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '@/lib/types';
import { TaskCard } from './task-card';

/**
 * Owned board lane primitive (mission-control-kanban#48, studio direction B).
 *
 * Lanes are neutral: identity is label + count + order, not a hue. The lane is
 * one fill step above the page (bg -> lane) and the cards one step above the
 * lane. When a card is carried over the lane, an accent insertion bar grows by
 * scaleX (it appears at full width at once under reduced motion) and the lane
 * gains an accent ring; the accent here is the drop target, one of its four uses.
 */

export interface BoardLaneColumn {
  id: TaskStatus;
  label: string;
}

interface BoardLaneProps {
  column: BoardLaneColumn;
  tasks: Task[];
  activeTaskId: string | null;
  /** True while a card from another lane is carried over this lane or its cards. */
  isDropTarget: boolean;
  inkTask: { id: string; key: number } | null;
  onCardClick: (task: Task) => void;
}

export function BoardLane({ column, tasks, activeTaskId, isDropTarget, inkTask, onCardClick }: BoardLaneProps) {
  const { setNodeRef } = useDroppable({ id: column.id });
  const isOver = isDropTarget;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.label} lane, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
      data-lane={column.id}
      data-drop-target={isOver ? 'true' : undefined}
      className={cn(
        'flex min-h-0 min-w-[232px] max-w-[300px] flex-1 flex-col rounded-lg bg-mc-bg-secondary',
        isOver && 'ring-2 ring-inset ring-mc-accent',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-mc-text-secondary">{column.label}</h3>
        <span className="min-w-6 rounded bg-mc-bg px-1.5 py-0.5 text-center text-xs tabular-nums text-mc-text-secondary">
          {tasks.length}
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {isOver && (
          <span
            aria-hidden="true"
            data-insert-bar
            className="mc-insert-bar pointer-events-none absolute left-2 right-2 top-0 z-10 h-0.5 rounded-full bg-mc-accent"
          />
        )}
        <ul className="min-h-0 flex-1 list-none space-y-2 overflow-y-auto px-2 pb-2 pt-1.5" aria-label={`${column.label} tasks`}>
          <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                onClick={() => onCardClick(task)}
                isActive={activeTaskId === task.id}
                inkKey={inkTask?.id === task.id ? inkTask.key : null}
              />
            ))}
          </SortableContext>
        </ul>
      </div>
    </section>
  );
}

function SortableTaskCard({
  task,
  onClick,
  isActive,
  inkKey,
}: {
  task: Task;
  onClick: () => void;
  isActive: boolean;
  inkKey: number | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <TaskCard
        task={task}
        onClick={onClick}
        isDragging={isDragging || isActive}
        inkKey={inkKey}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </li>
  );
}
