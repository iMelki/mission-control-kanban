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
