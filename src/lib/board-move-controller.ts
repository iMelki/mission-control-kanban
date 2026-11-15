/**
 * Board move controller (#194). Owns the save of a card's status after a drop,
 * free of React so tests/board-attention.test.ts can drive it.
 *
 * Rules:
 * - Moves of one card are serialized: while a card's save is in flight, a new move
 *   of that card is refused (decide() returns 'saving'), so every move starts from
 *   a status the client has no pending change for.
 * - The client never guesses after a failed or ambiguous save. A non-OK answer, a
 *   network error or a timeout re-reads the task from the server and adopts the
 *   server's status. Only if that read also fails does the card fall back to the
 *   last server-confirmed status (from the move's origin, a PATCH answer, or a
 *   status that arrived from elsewhere while the save was pending, such as an SSE
 *   task_updated or a dialog save). Then the outcome is "unknown" and the UI offers
 *   a retry.
 * - A save that never answers is aborted after MOVE_SAVE_TIMEOUT_MS and handled as
 *   ambiguous, so a hung request cannot lock the card until reload.
 */

import { decideMove, type MoveDecision } from './board-attention';
import type { Task, TaskStatus } from './types';

/**
 * How long a status PATCH may take before it is aborted and reconciled. Local saves
 * answer in well under a second; 15 s leaves room for a busy SQLite writer
 * (better-sqlite3 waits on SQLITE_BUSY) without leaving a card locked indefinitely.
 */
export const MOVE_SAVE_TIMEOUT_MS = 15_000;

/** How long the reconciling GET /api/tasks/:id may take before the card falls back. */
export const MOVE_READ_TIMEOUT_MS = 5_000;

export type PatchStatusResult = { ok: true; status: TaskStatus | null } | { ok: false; error: string };

export type MoveOutcome =
  /** The server has the card in the target lane (PATCH OK, or the re-read / an SSE update says so). */
  | { kind: 'saved'; taskId: string; title: string; status: TaskStatus }
  /** The server answered and the card is not in the target lane. */
  | { kind: 'not-saved'; taskId: string; title: string; status: TaskStatus; target: TaskStatus; error: string }
  /** The save failed and the re-read failed too: the card shows the last confirmed status. */
  | { kind: 'unknown'; taskId: string; title: string; status: TaskStatus; target: TaskStatus; error: string };

export interface MoveControllerDeps {
  /** The card's status in the board store right now. */
  getStatus(taskId: string): TaskStatus | null;
  /** Write the card's status to the board store (optimistic or reconciled). */
  setStatus(taskId: string, status: TaskStatus): void;
  /** PATCH the status. Must honour the signal; may throw on network errors. */
  patchStatus(taskId: string, status: TaskStatus, signal: AbortSignal): Promise<PatchStatusResult>;
  /** GET the task's status from the server; null or a throw means the read failed. */
  readStatus(taskId: string, signal: AbortSignal): Promise<TaskStatus | null>;
  onPendingChange(taskId: string, pending: boolean): void;
  /** Optional initial outcome listener; setOutcomeListener() replaces it. */
  onOutcome?: (outcome: MoveOutcome) => void;
  saveTimeoutMs?: number;
  readTimeoutMs?: number;
}

class MoveTimeoutError extends Error {
  constructor(ms: number) {
    super(`No answer from the server after ${Math.round(ms / 1000)} s`);
  }
}

/** Run with an AbortSignal that fires after `ms`; settles at the deadline even if `run` ignores the signal. */
async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new MoveTimeoutError(ms);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : 'The save did not complete');

export type MoveController = ReturnType<typeof createMoveController>;

export function createMoveController(deps: MoveControllerDeps) {
  const saveTimeoutMs = deps.saveTimeoutMs ?? MOVE_SAVE_TIMEOUT_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? MOVE_READ_TIMEOUT_MS;
  const pending = new Map<string, Promise<void>>();
  const confirmed = new Map<string, TaskStatus>();
  /** The latest server status that arrived from elsewhere while a card's save was in flight. */
  const observedDuringSave = new Map<string, TaskStatus>();
  const dropDecisions = new Map<string, { target: TaskStatus; decision: MoveDecision }>();
  let outcomeListener: (outcome: MoveOutcome) => void = deps.onOutcome ?? (() => {});
  let ownWrite = false;

  const write = (taskId: string, status: TaskStatus) => {
    ownWrite = true;
    try {
      deps.setStatus(taskId, status);
    } finally {
      ownWrite = false;
    }
  };

  async function reconcile(
    task: Pick<Task, 'id' | 'title'>,
    target: TaskStatus,
    error: string,
    fallback: TaskStatus | null = null,
  ): Promise<MoveOutcome> {
    let serverStatus: TaskStatus | null = null;
    try {
      serverStatus = await withTimeout(readTimeoutMs, (signal) => deps.readStatus(task.id, signal));
    } catch {
      serverStatus = null;
    }
    if (serverStatus) {
      confirmed.set(task.id, serverStatus);
      if (deps.getStatus(task.id) !== serverStatus) write(task.id, serverStatus);
      return serverStatus === target
        ? { kind: 'saved', taskId: task.id, title: task.title, status: serverStatus }
        : { kind: 'not-saved', taskId: task.id, title: task.title, status: serverStatus, target, error };
    }
    // No answer from the server at all: show the last status it confirmed.
    const keep = fallback ?? confirmed.get(task.id)!;
    if (deps.getStatus(task.id) !== keep) write(task.id, keep);
    if (keep === target) return { kind: 'saved', taskId: task.id, title: task.title, status: keep };
    return { kind: 'unknown', taskId: task.id, title: task.title, status: keep, target, error };
  }

  return {
    isSaving(taskId: string): boolean {
      return pending.has(taskId);
    },

    /** The drop decision, from the card's state right now (before any save of this drop starts). */
    decide(task: Pick<Task, 'id' | 'status' | 'github_source' | 'dispatch_metadata'>, target: TaskStatus): MoveDecision {
      return decideMove(task, target, pending.has(task.id));
    },

    /**
     * Decide a drop once and remember it, so the action and the drop announcement use the
     * same decision. dnd-kit calls DndContext's onDragEnd (which starts the save) before
     * announcements.onDragEnd; re-deciding there would see the save and say "still being saved".
     */
    recordDrop(task: Pick<Task, 'id' | 'status' | 'github_source' | 'dispatch_metadata'>, target: TaskStatus): MoveDecision {
      const decision = decideMove(task, target, pending.has(task.id));
      dropDecisions.set(task.id, { target, decision });
      return decision;
    },

    /** The decision recorded for this card's latest drop on `target`, if any. */
    recordedDecision(taskId: string, target: TaskStatus): MoveDecision | undefined {
      const recorded = dropDecisions.get(taskId);
      return recorded && recorded.target === target ? recorded.decision : undefined;
    },

    /** A new drag of the card began: its previous drop's decision no longer applies. */
    forgetDrop(taskId: string): void {
      dropDecisions.delete(taskId);
    },

    setOutcomeListener(listener: (outcome: MoveOutcome) => void): void {
      outcomeListener = listener;
    },

    /** True while the controller itself is writing to the store (its writes are not server facts). */
    isOwnWrite(): boolean {
      return ownWrite;
    },

    /**
     * A status for a card that came from the server while its save is pending
     * (SSE task_updated, a dialog save, a refetch). It becomes the confirmed status.
     */
    observeServerStatus(taskId: string, status: TaskStatus): void {
      if (!ownWrite && pending.has(taskId)) {
        confirmed.set(taskId, status);
        observedDuringSave.set(taskId, status);
      }
    },

    /** Resolves once the card has no save in flight (the dialog waits on this before its own save). */
    waitForIdle(taskId: string): Promise<void> {
      return pending.get(taskId) ?? Promise.resolve();
    },

    /** Start a move the caller decided as 'move'. Resolves when the outcome has been reported. */
    start(task: Pick<Task, 'id' | 'title' | 'status'>, target: TaskStatus): Promise<void> {
      confirmed.set(task.id, task.status);
      observedDuringSave.delete(task.id);
      write(task.id, target);
      deps.onPendingChange(task.id, true);
      const run = (async () => {
        let outcome: MoveOutcome;
        try {
          const result = await withTimeout(saveTimeoutMs, (signal) => deps.patchStatus(task.id, target, signal));
          const observed = observedDuringSave.get(task.id);
          if (result.ok && observed !== undefined && observed !== (result.status ?? target)) {
            // Conflicting server news arrived while saving (a refetch, another client), so the
            // order is unknown: settle on what the server says now, falling back to this answer.
            // (This save's own SSE broadcast matches the answer and needs no re-read.)
            outcome = await reconcile(task, target, 'The board changed while saving', result.status ?? target);
          } else if (result.ok) {
            const status = result.status ?? target;
            confirmed.set(task.id, status);
            if (deps.getStatus(task.id) !== status) write(task.id, status);
            outcome = status === target
              ? { kind: 'saved', taskId: task.id, title: task.title, status }
              : { kind: 'not-saved', taskId: task.id, title: task.title, status, target, error: 'The server kept a different status' };
          } else {
            outcome = await reconcile(task, target, result.error);
          }
        } catch (error) {
          outcome = await reconcile(task, target, messageOf(error));
        }
        pending.delete(task.id);
        observedDuringSave.delete(task.id);
        deps.onPendingChange(task.id, false);
        outcomeListener(outcome);
      })();
      pending.set(task.id, run);
      return run;
    },
  };
}
