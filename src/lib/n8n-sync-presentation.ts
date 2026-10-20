import type { MckN8nSyncRun } from './types';

export type MckN8nSyncPresentation = {
  state: 'ok' | 'warning' | 'error';
  label: 'OK' | 'Review needed' | 'Attention needed';
  showMessage: boolean;
};

export function presentMckN8nSyncRun(
  run: Pick<MckN8nSyncRun, 'ok' | 'alert_level'>,
): MckN8nSyncPresentation {
  if (!run.ok || run.alert_level === 'error') {
    return { state: 'error', label: 'Attention needed', showMessage: true };
  }

  if (run.alert_level !== 'ok') {
    return { state: 'warning', label: 'Review needed', showMessage: true };
  }

  return { state: 'ok', label: 'OK', showMessage: false };
}

export type MckN8nSyncFreshness = {
  state: 'never' | 'fresh' | 'stale';
  /** Hours after which a run counts as missed: twice the longest gap in the schedule. */
  staleAfterHours: number;
  ageHours: number | null;
};

const HOUR_MS = 3_600_000;
const DEFAULT_LONGEST_GAP_HOURS = 24;

/** Longest wait between two consecutive runs of a daily "HH:MM" schedule, wrapping past midnight. */
export function longestScheduleGapHours(times: readonly string[]): number {
  const minutes = times
    .map((time) => time.match(/^(\d{1,2}):(\d{2})$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => Number(match[1]) * 60 + Number(match[2]))
    .sort((a, b) => a - b);

  if (minutes.length === 0) {
    return DEFAULT_LONGEST_GAP_HOURS;
  }

  let longest = minutes[0] + 24 * 60 - minutes[minutes.length - 1];
  for (let index = 1; index < minutes.length; index += 1) {
    longest = Math.max(longest, minutes[index] - minutes[index - 1]);
  }

  return longest / 60;
}

/**
 * An OK or warning verdict only describes the last run that reported. When the
 * schedule has not reported for two full intervals, the verdict is history, not
 * health, and the page must say so instead of showing a stale run as current.
 */
export function presentMckN8nSyncFreshness(input: {
  receivedAt?: string | null;
  schedule?: readonly string[];
  now?: Date;
}): MckN8nSyncFreshness {
  const staleAfterHours = longestScheduleGapHours(input.schedule ?? []) * 2;
  const received = input.receivedAt ? new Date(input.receivedAt).getTime() : Number.NaN;
  if (Number.isNaN(received)) {
    return { state: 'never', staleAfterHours, ageHours: null };
  }

  const ageHours = Math.max(0, ((input.now ?? new Date()).getTime() - received) / HOUR_MS);
  return { state: ageHours > staleAfterHours ? 'stale' : 'fresh', staleAfterHours, ageHours };
}

/** "5 hours", "3 days" - whole units, for a chip or a sentence. */
export function formatAgeHours(ageHours: number): string {
  if (ageHours < 1) return 'under an hour';
  if (ageHours < 48) {
    const hours = Math.round(ageHours);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.round(ageHours / 24);
  return `${days} days`;
}
