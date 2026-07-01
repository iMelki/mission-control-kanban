import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import type { TaskDependencySummary } from '@/lib/types';

export function listTaskDependencies(taskId: string) {
  const blocked_by = queryAll<TaskDependencySummary>(
    `SELECT d.id, d.task_id, d.blocked_by_task_id, d.note, d.created_at,
            t.title as blocked_by_title, t.status as blocked_by_status
     FROM task_dependencies d
     JOIN tasks t ON t.id = d.blocked_by_task_id
     WHERE d.task_id = ?
     ORDER BY d.created_at DESC`,
    [taskId]
  );
  const blocking = queryAll<TaskDependencySummary>(
    `SELECT d.id, d.task_id, d.blocked_by_task_id, d.note, d.created_at,
            t.title as blocking_title, t.status as blocking_status
     FROM task_dependencies d
     JOIN tasks t ON t.id = d.task_id
     WHERE d.blocked_by_task_id = ?
     ORDER BY d.created_at DESC`,
    [taskId]
  );
  return { blocked_by, blocking };
}

export function listTaskDependenciesForTasks(taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, ReturnType<typeof listTaskDependencies>>();
  const placeholders = taskIds.map(() => '?').join(', ');
  const blockedRows = queryAll<TaskDependencySummary>(
    `SELECT d.id, d.task_id, d.blocked_by_task_id, d.note, d.created_at,
            t.title as blocked_by_title, t.status as blocked_by_status
     FROM task_dependencies d
     JOIN tasks t ON t.id = d.blocked_by_task_id
     WHERE d.task_id IN (${placeholders})
     ORDER BY d.created_at DESC`,
    taskIds
  );
  const blockingRows = queryAll<TaskDependencySummary>(
    `SELECT d.id, d.task_id, d.blocked_by_task_id, d.note, d.created_at,
            t.title as blocking_title, t.status as blocking_status
     FROM task_dependencies d
     JOIN tasks t ON t.id = d.task_id
     WHERE d.blocked_by_task_id IN (${placeholders})
     ORDER BY d.created_at DESC`,
    taskIds
  );
  const grouped = new Map<string, { blocked_by: TaskDependencySummary[]; blocking: TaskDependencySummary[] }>();
  for (const taskId of taskIds) grouped.set(taskId, { blocked_by: [], blocking: [] });
  for (const row of blockedRows) grouped.get(row.task_id)?.blocked_by.push(row);
  for (const row of blockingRows) grouped.get(row.blocked_by_task_id)?.blocking.push(row);
  return grouped;
}

export function listDependencyCandidates(taskId: string, workspaceId: string) {
  return queryAll<{ id: string; title: string; status: string }>(
    `SELECT id, title, status FROM tasks
     WHERE workspace_id = ? AND id <> ?
     ORDER BY updated_at DESC, title ASC
     LIMIT 100`,
    [workspaceId, taskId]
  );
}

function dependencyExists(taskId: string, blockedByTaskId: string) {
  return Boolean(queryOne<{ id: string }>(
    'SELECT id FROM task_dependencies WHERE task_id = ? AND blocked_by_task_id = ?',
    [taskId, blockedByTaskId]
  ));
}

export function wouldCreateDependencyCycle(taskId: string, blockedByTaskId: string) {
  const seen = new Set<string>();
  const stack = [blockedByTaskId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (current === taskId) return true;
    seen.add(current);
    const nextRows = queryAll<{ blocked_by_task_id: string }>(
      'SELECT blocked_by_task_id FROM task_dependencies WHERE task_id = ?',
      [current]
    );
    stack.push(...nextRows.map((row) => row.blocked_by_task_id));
  }
  return false;
}

export function addTaskDependency(taskId: string, blockedByTaskId: string, note?: string) {
  if (taskId === blockedByTaskId) throw new Error('A task cannot block itself.');
  const task = queryOne<{ workspace_id: string }>('SELECT workspace_id FROM tasks WHERE id = ?', [taskId]);
  const blocker = queryOne<{ workspace_id: string }>('SELECT workspace_id FROM tasks WHERE id = ?', [blockedByTaskId]);
  if (!task || !blocker) throw new Error('Task or blocker was not found.');
  if (task.workspace_id !== blocker.workspace_id) throw new Error('Dependencies must stay within the same workspace.');
  if (dependencyExists(taskId, blockedByTaskId)) throw new Error('Dependency already exists.');
  if (wouldCreateDependencyCycle(taskId, blockedByTaskId)) throw new Error('Dependency would create a cycle.');
  const id = uuidv4();
  run(
    `INSERT INTO task_dependencies (id, task_id, blocked_by_task_id, note, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, taskId, blockedByTaskId, note || null, new Date().toISOString()]
  );
  return { id, ...listTaskDependencies(taskId) };
}

export function removeTaskDependency(taskId: string, dependencyId: string) {
  run('DELETE FROM task_dependencies WHERE id = ? AND task_id = ?', [dependencyId, taskId]);
  return listTaskDependencies(taskId);
}
