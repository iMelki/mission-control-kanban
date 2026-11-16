/**
 * Board move controller (#194). Owns the save of a card's status after a drop,
 * free of React so tests/board-attention.test.ts can drive it. One controller per
 * workspace lives in src/lib/board-move-registry.ts, outside the board component, so
 * a pending save (and its outcome) survives the board unmounting.
 *
 * Rules:
 * - Moves of one card are serialized: while a card's save is in flight, a new move
 *   of that card is refused (decide() returns 'saving').
 * - Server facts come in at their source (SSE events, task refetches, dialog-save
 *   responses -> observeServerStatus), never inferred from store diffs, because an
 *   optimistic write and a server write look the same in the store.
 * - The client never guesses after a failed or ambiguous save. A non-OK answer, a
 *   network error or a timeout re-reads the task and adopts the server's status,
 *   unless a newer server status arrived while the read was in flight. If the read
 *   fails, the card shows the newest server-confirmed status and the outcome is:
 *   "saved" when that is the target; "superseded" when the card reached the target
 *   and a later lane followed (ownSave when this save's OK answer says so; for a lost
 *   answer the server only reported the target, which may be another client's write,
 *   so ownSave is false); "not-saved" when the server reported another lane and never
 *   the target; and "unknown" (the UI offers a retry) when no server news came.
 * - A save that never answers is aborted after MOVE_SAVE_TIMEOUT_MS, and a re-read
 *   after MOVE_READ_TIMEOUT_MS, so a hung request cannot lock the card.
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

/** A status as the server reported it, with its updated_at when known. */
export interface ServerStatus {
  status: TaskStatus;
  updatedAt?: string | null;
}

export type PatchStatusResult = { ok: true; status: TaskStatus | null; updatedAt?: string | null } | { ok: false; error: string };

export type MoveOutcome =
  /** The server has the card in the target lane (PATCH OK, or the re-read / an SSE update says so). */
  | { kind: 'saved'; taskId: string; title: string; status: TaskStatus }
  /** The server answered and the card is not in the target lane. */
  | { kind: 'not-saved'; taskId: string; title: string; status: TaskStatus; target: TaskStatus; error: string }
  /** The save failed and the re-read failed too: the card shows the last confirmed status. */
  | { kind: 'unknown'; taskId: string; title: string; status: TaskStatus; target: TaskStatus; error: string }
  /**
   * The card reached the target lane, and a later server change moved it on to `status`. Not a
   * failure.
   * - `ownSave` true: this save's PATCH answered OK with the target, so this client moved it.
   *   `confirmed` is false when neither the re-read nor updated_at proves that `status` is newer
   *   than the save: the card shows it, but its current lane is unconfirmed.
   * - `ownSave` false: the PATCH answer was lost, and the server only reported the target while
   *   it was in flight. That report may be another client's write; with no request id or version
   *   from the server it cannot be tied to this save, so the move is not claimed and `confirmed`
   *   is always false.
   */
  | { kind: 'superseded'; taskId: string; title: string; status: TaskStatus; target: TaskStatus; confirmed: boolean; ownSave: boolean };

export interface MoveControllerDeps {
  /** The card's status in the board store right now. */
  getStatus(taskId: string): TaskStatus | null;
  /**
   * Write the card's status to the board store. A reconciled (server-confirmed) write passes
   * the server's updated_at so the store copy carries it and a stale refetch cannot undo it;
   * the optimistic write passes none.
   */
  setStatus(taskId: string, status: TaskStatus, updatedAt?: string | null): void;
  /** PATCH the status. Must honour the signal; may throw on network errors. */
  patchStatus(taskId: string, status: TaskStatus, signal: AbortSignal): Promise<PatchStatusResult>;
  /** GET the task from the server; null or a throw means the read failed. */
  readStatus(taskId: string, signal: AbortSignal): Promise<ServerStatus | null>;
  saveTimeoutMs?: number;
  readTimeoutMs?: number;
}

class MoveTimeoutError extends Error {
  constructor(ms: number) {
    super(`No answer from the server after ${Math.round(ms / 1000)} s`);
  }
}

/** Run with an AbortSignal that fires after `ms`; settles at the deadline even if `run` ignores the signal. */
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
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

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * A server updated_at as epoch ms, or NaN when unknown or unparsable (never "provably
 * newer"). SQLite's datetime('now') writes UTC as "YYYY-MM-DD HH:MM:SS" with no zone,
 * which Date.parse would read as local time; it is parsed as UTC here.
 */
export function serverTimeOf(updatedAt: string | null | undefined): number {
  if (!updatedAt) return Number.NaN;
  return Date.parse(SQLITE_DATETIME.test(updatedAt) ? `${updatedAt.replace(' ', 'T')}Z` : updatedAt);
}
const timeOf = serverTimeOf;

/**
 * How long an outcome that landed while the board was unmounted may still be announced
 * when it mounts again. Failures are kept as alerts regardless (see failures below).
 */
export const OUTCOME_REPLAY_MS = 30_000;

/** A failed save the board shows as an alert until it is resolved or dismissed. */
export interface SaveFailure {
  taskId: string;
  title: string;
  /** Where the card is now. */
  status: TaskStatus;
  /** Where the move tried to put it. */
  target: TaskStatus;
  error: string;
  /** The outcome was unknown (no server answer): the move can be retried. */
  retryable: boolean;
}

export type MoveController = ReturnType<typeof createMoveController>;

export function createMoveController(deps: MoveControllerDeps) {
  const saveTimeoutMs = deps.saveTimeoutMs ?? MOVE_SAVE_TIMEOUT_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? MOVE_READ_TIMEOUT_MS;
  const pending = new Map<string, Promise<void>>();
  /** Last server-confirmed status per card, with its updated_at time (kept across moves). */
  const confirmed = new Map<string, { status: TaskStatus; time: number }>();
  /** Bumped on every server status observed for a card, so a slower re-read cannot overwrite it. */
  const serverSeq = new Map<string, number>();
  /** The latest server status that arrived from elsewhere while a card's save was in flight. */
  const observedDuringSave = new Map<string, TaskStatus>();
  /** The lane each in-flight save is writing. */
  const pendingTargets = new Map<string, TaskStatus>();
  /**
   * The server reported the save's target lane while the save was in flight (latest report).
   * If the PATCH answer is lost, this shows the card reached the target (by this save or another
   * client's), so the outcome is a neutral "superseded", not "not-saved". Kept separately because
   * observedDuringSave holds only the latest status, which may already be a later lane.
   */
  const targetSeenDuringSave = new Map<string, ServerStatus>();
  const dropDecisions = new Map<string, { target: TaskStatus; decision: MoveDecision }>();
  const pendingListeners = new Set<() => void>();
  let savingSnapshot: ReadonlySet<string> = new Set();
  let outcomeListener: ((outcome: MoveOutcome) => void) | null = null;
  const undelivered: { outcome: MoveOutcome; at: number }[] = [];
  /** Unresolved failures, one per card, kept here so they survive the board unmounting. */
  let failures: readonly SaveFailure[] = [];
  const notify = () => {
    for (const listener of pendingListeners) listener();
  };
  const setFailures = (next: readonly SaveFailure[]) => {
    failures = next;
    notify();
  };

  const setPending = (taskId: string, run: Promise<void> | null) => {
    if (run) pending.set(taskId, run); else pending.delete(taskId);
    savingSnapshot = new Set(pending.keys());
    notify();
  };

  const report = (outcome: MoveOutcome) => {
    // Record the failure first (or clear it on success), whether or not a board is listening.
    const others = failures.filter((failure) => failure.taskId !== outcome.taskId);
    if (outcome.kind === 'saved' || outcome.kind === 'superseded') {
      if (others.length !== failures.length) setFailures(others);
    } else {
      setFailures([...others, {
        taskId: outcome.taskId,
        title: outcome.title,
        status: outcome.status,
        target: outcome.target,
        error: outcome.error,
        retryable: outcome.kind === 'unknown',
      }]);
    }
    if (outcomeListener) outcomeListener(outcome); else undelivered.push({ outcome, at: Date.now() });
  };

  /** Record a server-confirmed status; an unknown updated_at keeps the time already held. */
  const confirm = (taskId: string, status: TaskStatus, updatedAt?: string | null) => {
    const time = timeOf(updatedAt);
    const held = confirmed.get(taskId);
    confirmed.set(taskId, { status, time: Number.isNaN(time) ? (held?.time ?? Number.NEGATIVE_INFINITY) : time });
  };

  async function reconcile(
    task: Pick<Task, 'id' | 'title'>,
    target: TaskStatus,
    error: string,
    /** What this save's own (successful) answer said, to weigh against other confirmations. */
    fallback: ServerStatus | null = null,
    /** The PATCH gave no answer (network error, timeout), so the server may have saved it anyway. */
    answerLost = false,
  ): Promise<MoveOutcome> {
    const seqBefore = serverSeq.get(task.id) ?? 0;
    let server: ServerStatus | null = null;
    try {
      server = await withTimeout(readTimeoutMs, (signal) => deps.readStatus(task.id, signal));
    } catch {
      server = null;
    }
    const newerArrived = (serverSeq.get(task.id) ?? 0) !== seqBefore;
    const latest = confirmed.get(task.id)!;
    // This save's own PATCH answered OK with the target lane: the move did save, whatever the
    // card shows now. A different lane after that is a later change, not a failed move.
    const ownSave = fallback !== null && fallback.status === target ? fallback : null;
    // Its answer lost, the server reported the target while it was in flight: the card reached
    // the target, but maybe by another client's write, so this is not proof of this save. A
    // non-OK answer never counts: the server said this save failed.
    // (Read after the re-read, so a report of the target that arrived during it counts too.)
    const targetSeen = !ownSave && answerLost ? (targetSeenDuringSave.get(task.id) ?? null) : null;
    const reached = { kind: 'superseded', taskId: task.id, title: task.title, target, confirmed: false, ownSave: false } as const;
    // A server status that arrived during the read wins unless the read is provably newer.
    if (server && (!newerArrived || timeOf(server.updatedAt) > latest.time)) {
      confirm(task.id, server.status, server.updatedAt);
      deps.setStatus(task.id, server.status, server.updatedAt);
      if (server.status === target) return { kind: 'saved', taskId: task.id, title: task.title, status: server.status };
      // The read left after the PATCH answered, so its lane is the one that followed the save.
      if (ownSave) return { kind: 'superseded', taskId: task.id, title: task.title, status: server.status, target, confirmed: true, ownSave: true };
      if (targetSeen) return { ...reached, status: server.status };
      return { kind: 'not-saved', taskId: task.id, title: task.title, status: server.status, target, error };
    }
    // No usable answer from the read: show the newest status the server confirmed, comparing
    // this save's own answer (if any) with confirmations from elsewhere by updated_at.
    // Weighed by updated_at even if a status arrived during the read: that status can be
    // older than this save's own answer.
    const fallbackWins = fallback !== null && !(timeOf(fallback.updatedAt) < latest.time)
      && !(newerArrived && Number.isNaN(timeOf(fallback.updatedAt)));
    const keep = fallbackWins ? fallback.status : latest.status;
    if (fallbackWins) confirm(task.id, fallback.status, fallback.updatedAt);
    if (fallbackWins) deps.setStatus(task.id, keep, fallback.updatedAt);
    else if (deps.getStatus(task.id) !== keep) deps.setStatus(task.id, keep);
    if (keep === target) return { kind: 'saved', taskId: task.id, title: task.title, status: keep };
    if (ownSave) {
      // The save happened; the card shows a server status from elsewhere. Only an updated_at
      // provably newer than the save's own answer says that status came after the save.
      const confirmed = timeOf(ownSave.updatedAt) < latest.time;
      return { kind: 'superseded', taskId: task.id, title: task.title, status: keep, target, confirmed, ownSave: true };
    }
    if (targetSeen) return { ...reached, status: keep };
    // The server told us where the card is (another client, a refetch): not a guess, no retry.
    if (newerArrived || observedDuringSave.has(task.id)) {
      return { kind: 'not-saved', taskId: task.id, title: task.title, status: keep, target, error };
    }
    return { kind: 'unknown', taskId: task.id, title: task.title, status: keep, target, error };
  }

  return {
    isSaving(taskId: string): boolean {
      return pending.has(taskId);
    },

    /** For useSyncExternalStore: notified whenever a card starts or stops saving, or failures change. */
    subscribe(listener: () => void): () => void {
      pendingListeners.add(listener);
      return () => {
        pendingListeners.delete(listener);
      };
    },

    /** Unresolved save failures (a stable reference between changes). */
    getFailuresSnapshot(): readonly SaveFailure[] {
      return failures;
    },

    /** The user dismissed these alerts, retried the move, or there is nothing left to retry. */
    removeFailures(taskIds: readonly string[]): void {
      const removed = new Set(taskIds);
      const next = failures.filter((failure) => !removed.has(failure.taskId));
      if (next.length !== failures.length) setFailures(next);
    },

    /** The ids of cards with a save in flight (a stable reference between changes). */
    getSavingSnapshot(): ReadonlySet<string> {
      return savingSnapshot;
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

    /**
     * Where outcomes go. With no listener (the board is unmounted) they are kept and
     * delivered, in order, as soon as a listener is set again.
     */
    setOutcomeListener(listener: ((outcome: MoveOutcome) => void) | null): void {
      outcomeListener = listener;
      if (!listener) return;
      // Failures are already kept as alerts; only recent outcomes are replayed, so a stale
      // "Moved ..." is not announced on a much later remount.
      const now = Date.now();
      while (undelivered.length > 0) {
        const { outcome, at } = undelivered.shift()!;
        if (now - at <= OUTCOME_REPLAY_MS) listener(outcome);
      }
    },

    /**
     * A card status reported by the server: an SSE event, a task refetch or a dialog-save
     * response. Called at the source, including when it equals the optimistic lane (the
     * save's own broadcast). Reports older (by updated_at) than the one held are ignored.
     */
    observeServerStatus(taskId: string, status: TaskStatus, updatedAt?: string | null): void {
      const held = confirmed.get(taskId);
      if (held) {
        const time = timeOf(updatedAt);
        if (time < held.time) return; // older than what is held (NaN, unknown, is never "older")
        // Same time (or unknown time) and the same status: the controller already holds it.
        if ((time === held.time || Number.isNaN(time)) && status === held.status) return;
      }
      confirm(taskId, status, updatedAt);
      if (!pending.has(taskId)) return;
      serverSeq.set(taskId, (serverSeq.get(taskId) ?? 0) + 1);
      observedDuringSave.set(taskId, status);
      if (status === pendingTargets.get(taskId)) targetSeenDuringSave.set(taskId, { status, updatedAt });
    },

    /** Resolves once the card has no save in flight (the dialog waits on this before its own save). */
    waitForIdle(taskId: string): Promise<void> {
      return pending.get(taskId) ?? Promise.resolve();
    },

    /** Start a move the caller decided as 'move'. Resolves when the outcome has been reported. */
    start(task: Pick<Task, 'id' | 'title' | 'status'> & { updated_at?: string }, target: TaskStatus): Promise<void> {
      // Confirmed writes advance the store's updated_at, but optimistic writes, a fallback to the
      // last confirmed status (no updated_at) and server reports that reach this controller
      // without writing the store do not, so the store copy can be older than what is held here.
      // A newer confirmation held from an earlier save of this card must survive this move's start.
      const held = confirmed.get(task.id);
      const storeTime = timeOf(task.updated_at);
      if (!held || held.status !== task.status || !(held.time > storeTime)) {
        confirmed.set(task.id, { status: task.status, time: Number.isNaN(storeTime) ? Number.NEGATIVE_INFINITY : storeTime });
      }
      observedDuringSave.delete(task.id);
      targetSeenDuringSave.delete(task.id);
      serverSeq.delete(task.id);
      pendingTargets.set(task.id, target);
      deps.setStatus(task.id, target);
      const run = (async () => {
        let outcome: MoveOutcome;
        try {
          const result = await withTimeout(saveTimeoutMs, (signal) => deps.patchStatus(task.id, target, signal));
          const observed = observedDuringSave.get(task.id);
          if (result.ok && observed !== undefined && observed !== (result.status ?? target)) {
            // Conflicting server news arrived while saving (a refetch, another client), so the
            // order is unknown: settle on what the server says now, falling back to this answer.
            // (This save's own SSE broadcast matches the answer and needs no re-read.)
            outcome = await reconcile(task, target, 'The board changed while saving', { status: result.status ?? target, updatedAt: result.updatedAt });
          } else if (result.ok) {
            const status = result.status ?? target;
            confirm(task.id, status, result.updatedAt);
            deps.setStatus(task.id, status, result.updatedAt);
            outcome = status === target
              ? { kind: 'saved', taskId: task.id, title: task.title, status }
              : { kind: 'not-saved', taskId: task.id, title: task.title, status, target, error: 'The server kept a different status' };
          } else {
            outcome = await reconcile(task, target, result.error);
          }
        } catch (error) {
          outcome = await reconcile(task, target, messageOf(error), null, true);
        }
        observedDuringSave.delete(task.id);
        targetSeenDuringSave.delete(task.id);
        pendingTargets.delete(task.id);
        serverSeq.delete(task.id);
        setPending(task.id, null);
        report(outcome);
      })();
      setPending(task.id, run);
      return run;
    },
  };
}
