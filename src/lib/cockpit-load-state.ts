/**
 * Cockpit load presentation. The 2026-08-31 gauntlet row found ~3/13 loads
 * painting a complete pre-data board as if it had settled: "Showing 0/0",
 * "No events yet", and a confident ONLINE/OFFLINE badge.
 *
 * Pending is a phase. Empty-after-load is a phase. They must not share copy.
 */

export type LoadPhase = 'pending' | 'ready' | 'error';
export type ConnectionPhase = 'pending' | 'online' | 'offline';

export function presentBoardCount(
  phase: LoadPhase,
  visibleCount: number,
  totalCount: number,
): { text: string; settled: boolean } {
  if (phase === 'pending') {
    return { text: 'Loading board…', settled: false };
  }
  if (phase === 'error') {
    return { text: 'Board failed to load', settled: false };
  }
  return { text: `Showing ${visibleCount}/${totalCount}`, settled: true };
}

export function presentEventsEmpty(phase: LoadPhase): { text: string; settled: boolean } {
  if (phase === 'pending') {
    return { text: 'Loading events…', settled: false };
  }
  if (phase === 'error') {
    return { text: 'Events failed to load', settled: false };
  }
  return { text: 'No events yet', settled: true };
}

export function presentConnection(phase: ConnectionPhase): {
  label: string;
  ariaLabel: string;
  settled: boolean;
} {
  if (phase === 'pending') {
    return {
      label: 'Checking',
      ariaLabel: 'Connection status still checking',
      settled: false,
    };
  }
  if (phase === 'online') {
    return {
      label: 'ONLINE',
      ariaLabel: 'Connection online',
      settled: true,
    };
  }
  return {
    label: 'OFFLINE',
    ariaLabel: 'Connection offline',
    settled: true,
  };
}

export function isCockpitSettled(input: {
  workspaceReady: boolean;
  boardPhase: LoadPhase;
}): boolean {
  return input.workspaceReady && input.boardPhase === 'ready';
}
