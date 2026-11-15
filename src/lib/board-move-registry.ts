/**
 * One board move controller per workspace, kept outside React so a pending save,
 * its "Saving…" state and its outcome survive the board unmounting (a tab switch)
 * and a second move of the card is still refused on remount (#194).
 *
 * Server facts are fed to the controllers here, at their source: SSE events
 * (taskStreamHandlers), task refetches and dialog-save responses (reportServerTask[s]).
 */

import { createMoveController, type MoveController, type PatchStatusResult, type ServerStatus } from './board-move-controller';
import { useMissionControl } from './store';
import type { Task, TaskStatus } from './types';

const TASK_STATUSES: readonly TaskStatus[] = ['planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'done'];
export const isTaskStatus = (value: unknown): value is TaskStatus =>
  typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);

/** PATCH a card's status; non-OK answers carry the server's error text. Throws on network errors and aborts. */
export async function patchTaskStatus(taskId: string, status: TaskStatus, signal: AbortSignal): Promise<PatchStatusResult> {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: isTaskStatus(data?.status) ? data.status : null, updatedAt: data?.updated_at ?? null };
  return { ok: false, error: typeof data?.error === 'string' && data.error ? data.error : `The server answered HTTP ${res.status}` };
}

/** Read a card's status from the server; null when the read fails. */
export async function readTaskStatus(taskId: string, signal?: AbortSignal): Promise<ServerStatus | null> {
  const res = await fetch(`/api/tasks/${taskId}`, { signal, cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return isTaskStatus(data?.status) ? { status: data.status, updatedAt: data?.updated_at ?? null } : null;
}

const controllers = new Map<string, MoveController>();

/** The controller for a workspace, created on first use and kept for the page's lifetime. */
export function getBoardMoveController(workspaceId: string): MoveController {
  let controller = controllers.get(workspaceId);
  if (!controller) {
    controller = createMoveController({
      getStatus: (taskId) => useMissionControl.getState().tasks.find((task) => task.id === taskId)?.status ?? null,
      setStatus: (taskId, status) => useMissionControl.getState().updateTaskStatus(taskId, status),
      patchStatus: patchTaskStatus,
      readStatus: (taskId, signal) => readTaskStatus(taskId, signal),
    });
    controllers.set(workspaceId, controller);
  }
  return controller;
}

/** Tests only: forget every controller. */
export function resetBoardMoveControllers(): void {
  controllers.clear();
}

type ServerTask = Pick<Task, 'id' | 'status' | 'workspace_id'> & { updated_at?: string };

/** Tell the card's workspace controller what the server says about it. */
export function reportServerTask(task: ServerTask): void {
  if (!task || !isTaskStatus(task.status)) return;
  controllers.get(task.workspace_id)?.observeServerStatus(task.id, task.status, task.updated_at ?? null);
}

export function reportServerTasks(tasks: readonly ServerTask[]): void {
  for (const task of tasks) reportServerTask(task);
}

/**
 * The task stream's handlers: report the server status first, then write the store.
 * useSSE wraps these; tests drive them with the real store.
 */
export function taskStreamHandlers(onUpdated?: (task: Task) => void) {
  return {
    onTaskCreated: (task: Task) => {
      reportServerTask(task);
      useMissionControl.getState().addTask(task);
    },
    onTaskUpdated: (task: Task) => {
      reportServerTask(task);
      useMissionControl.getState().updateTask(task);
      onUpdated?.(task);
    },
  };
}
