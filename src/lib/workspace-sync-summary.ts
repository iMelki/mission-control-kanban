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

export function extractGitHubSyncStatusNotes(payload: Record<string, unknown>): string[] {
  const details = Array.isArray(payload.details) ? payload.details : [];
  const notes: string[] = [];

  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const detailRecord = detail as Record<string, unknown>;
    if (detailRecord.action !== 'status_reconcile' && detailRecord.action !== 'drift') continue;

    const issue = typeof detailRecord.issue === 'string' ? `${detailRecord.issue}: ` : '';
    const reason = typeof detailRecord.reason === 'string'
      ? detailRecord.reason
      : String(detailRecord.action);
    notes.push(`${issue}${reason}`);

    if (notes.length === 3) break;
  }

  return notes;
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
