/**
 * Whether the task dialog may send a status with its save (#194). The dialog's form
 * is a snapshot taken when it opened; if a board move of the card was still saving
 * then, the snapshot holds the optimistic lane. Sending it after the wait could
 * re-apply a failed move or overwrite someone else's change, so:
 *
 * - status not changed in the dialog: do not send it at all;
 * - status changed: re-read the server status, and refuse if the card moved since
 *   the dialog opened (or the read fails), so the user decides with current facts.
 */

import { MOVE_READ_TIMEOUT_MS, withTimeout } from './board-move-controller';
import type { TaskStatus } from './types';

export type DialogStatusPlan =
  | { action: 'omit' }
  | { action: 'send'; status: TaskStatus }
  | { action: 'refuse'; message: string };

export async function planDialogStatus({
  openedStatus,
  formStatus,
  readServerStatus,
  laneName,
  readTimeoutMs = MOVE_READ_TIMEOUT_MS,
}: {
  /** The card's status when the dialog opened (the form's starting value). */
  openedStatus: TaskStatus;
  /** The status the form holds now. */
  formStatus: TaskStatus;
  /** The server's status now; null when the read fails. Must honour the signal. */
  readServerStatus: (signal: AbortSignal) => Promise<TaskStatus | null>;
  laneName: (status: TaskStatus) => string;
  /** The read is aborted (and the save refused) after this long, so Save never hangs. */
  readTimeoutMs?: number;
}): Promise<DialogStatusPlan> {
  if (formStatus === openedStatus) return { action: 'omit' };
  let server: TaskStatus | null = null;
  try {
    server = await withTimeout(readTimeoutMs, readServerStatus);
  } catch {
    server = null;
  }
  if (!server) {
    return { action: 'refuse', message: 'Could not confirm the card\'s current status, so its status was not changed. Try saving again.' };
  }
  if (server !== openedStatus) {
    return {
      action: 'refuse',
      message: `This card moved to ${laneName(server)} while the dialog was open, so its status was not changed. Close and reopen the dialog to change it.`,
    };
  }
  return { action: 'send', status: formStatus };
}
