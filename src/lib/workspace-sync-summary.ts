import type { MckN8nSyncStatusResponse } from './types';

const SYNC_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatSyncTimestamp(value?: string): string {
  if (!value) {
    return 'never';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'unknown time';
  }

  return SYNC_TIMESTAMP_FORMATTER.format(parsed);
}

export function formatSyncCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatReconciliationSuffix(summary: Record<string, unknown>): string {
  const statusReconciled = formatSyncCount(summary.status_reconciled);
  const driftWarnings = formatSyncCount(summary.upstream_drift_warnings);
  if (statusReconciled === 0 && driftWarnings === 0) {
    return '';
  }

  return `, ${statusReconciled} status reconciled, ${driftWarnings} upstream drift warning${driftWarnings === 1 ? '' : 's'}`;
}

export type GitHubSyncNoteGroups = {
  /** Unresolved disagreements: GitHub and MCK still differ and a person has to pick a side. */
  drift: string[];
  /** Status moves MCK already made to match GitHub; informational, nothing left to resolve. */
  reconciled: string[];
};

const MAX_NOTES_PER_GROUP = 3;

export function extractGitHubSyncNoteGroups(payload: Record<string, unknown>): GitHubSyncNoteGroups {
  const details = Array.isArray(payload.details) ? payload.details : [];
  const groups: GitHubSyncNoteGroups = { drift: [], reconciled: [] };

  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const detailRecord = detail as Record<string, unknown>;
    const group = detailRecord.action === 'drift'
      ? groups.drift
      : detailRecord.action === 'status_reconcile'
        ? groups.reconciled
        : null;
    if (!group || group.length >= MAX_NOTES_PER_GROUP) continue;

    const issue = typeof detailRecord.issue === 'string' ? `${detailRecord.issue}: ` : '';
    const reason = typeof detailRecord.reason === 'string'
      ? detailRecord.reason
      : String(detailRecord.action);
    group.push(`${issue}${reason}`);
  }

  return groups;
}

export type SyncSummaryChip = {
  kind: 'unlinked' | 'idle' | 'syncing' | 'error' | 'attention' | 'ok';
  label: string;
};

/**
 * The single chip the status line shows below `md`. A workspace that has never
 * synced in this tab is "Not synced yet", never "Synced": a green check before the
 * first sync would claim a result nobody has produced.
 */
export function presentSyncSummaryChip(input: {
  hasProject: boolean;
  syncState: 'idle' | 'syncing' | 'success' | 'error';
  attention: number;
}): SyncSummaryChip {
  const toReview = `${input.attention} to review`;
  if (!input.hasProject) {
    return input.attention > 0 ? { kind: 'attention', label: toReview } : { kind: 'unlinked', label: 'GitHub status' };
  }
  if (input.syncState === 'error') return { kind: 'error', label: 'Sync failed' };
  if (input.syncState === 'syncing') return { kind: 'syncing', label: 'Syncing…' };
  if (input.attention > 0) return { kind: 'attention', label: toReview };
  if (input.syncState === 'idle') return { kind: 'idle', label: 'Not synced yet' };
  return { kind: 'ok', label: 'Synced' };
}

/** Daily "HH:MM" times the n8n schedule recorded with its last run. */
export function readN8nScheduleTimes(status: MckN8nSyncStatusResponse['latest']): string[] {
  const cadence = status?.raw_payload?.scheduleCadence;
  if (!cadence || typeof cadence !== 'object' || Array.isArray(cadence)) {
    return [];
  }

  const schedule = (cadence as Record<string, unknown>).schedule;
  return Array.isArray(schedule) ? schedule.map((item) => String(item)) : [];
}

export function formatSyncCadence(status: MckN8nSyncStatusResponse['latest']): string {
  const cadence = status?.raw_payload?.scheduleCadence;
  if (!cadence || typeof cadence !== 'object' || Array.isArray(cadence)) {
    return 'configured schedule';
  }

  const cadenceRecord = cadence as Record<string, unknown>;
  const schedule = readN8nScheduleTimes(status).join(', ');
  const timezone = typeof cadenceRecord.timezone === 'string' ? cadenceRecord.timezone : '';

  return [schedule, timezone].filter(Boolean).join(' ') || 'configured schedule';
}

/**
 * Plain-language meaning of a status note, so the operator does not need to read
 * github-project-sync.ts to know what a warning asks of them. Returns undefined
 * for notes that already read as a complete sentence (status moves MCK made).
 */
export function explainSyncNote(note: string): string | undefined {
  const localDone = note.match(/Local task is Done while GitHub Project Status is (.+?)\.?$/);
  if (localDone) {
    return `GitHub still lists this issue as open (Status: ${localDone[1]}). MCK never reopens a Done card by itself, so the card and GitHub disagree. Decide which side is right, then move the local card or update GitHub.`;
  }

  if (/Status Blocked has no first-class MCK column/.test(note)) {
    return 'MCK has no Blocked column, so the card keeps the column it is already in. Nothing is wrong; the warning only says the two boards cannot show this state the same way.';
  }

  return undefined;
}
