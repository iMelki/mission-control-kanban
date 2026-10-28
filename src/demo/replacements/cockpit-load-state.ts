// Demo build replacement for src/lib/cockpit-load-state.ts: identical except
// that the agent gateway badge reads "DEMO" instead of "OFFLINE".
import { presentConnection as presentRealConnection, type ConnectionPhase } from '@/lib/cockpit-load-state';

export * from '@/lib/cockpit-load-state';

export function presentConnection(phase: ConnectionPhase): ReturnType<typeof presentRealConnection> {
  if (phase === 'offline') {
    return {
      label: 'DEMO',
      ariaLabel: 'Demo mode: no agent gateway is connected',
      settled: true,
    };
  }
  return presentRealConnection(phase);
}
