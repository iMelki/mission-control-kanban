export type LocalControlGroup =
  | 'work-cockpits'
  | 'memory-agents'
  | 'automation-health'
  | 'readiness';

export type LocalControlHealthState = 'ok' | 'limited' | 'attention' | 'unknown';

export type LocalControlHealthSource = 'self' | 'github' | 'openclaw' | 'n8n-sync' | 'link-only';

export interface LocalControlSurface {
  id: string;
  name: string;
  description: string;
  group: LocalControlGroup;
  href: string;
  detailHref?: string;
  mode: 'internal' | 'local' | 'diagnostic';
  healthSource: LocalControlHealthSource;
  displayUrl: string;
}

export interface LocalControlHealth {
  state: LocalControlHealthState;
  label: string;
  detail: string;
}

export const LOCAL_CONTROL_GROUP_LABELS: Record<LocalControlGroup, string> = {
  'work-cockpits': 'Work Cockpits',
  'memory-agents': 'Memory and Agents',
  'automation-health': 'Automation Health',
  readiness: 'Readiness',
};

export const LOCAL_CONTROL_SURFACES: LocalControlSurface[] = [
  {
    id: 'mck-assistants',
    name: 'MCK Assistants',
    description: 'GitHub Project cockpit and local task board.',
    group: 'work-cockpits',
    href: '/workspace/assistants',
    detailHref: '/n8n-sync-history',
    mode: 'internal',
    healthSource: 'self',
    displayUrl: 'current host /workspace/assistants',
  },
  {
    id: 'mission-control',
    name: 'Mission Control',
    description: 'Broader operator dashboard and Dev Service Manager UI.',
    group: 'work-cockpits',
    href: 'http://127.0.0.1:3001',
    mode: 'local',
    healthSource: 'link-only',
    displayUrl: '127.0.0.1:3001',
  },
  {
    id: 'command-center',
    name: 'Command Center',
    description: 'Preferred launcher and app surface registry handoff.',
    group: 'work-cockpits',
    href: 'http://127.0.0.1:3088',
    mode: 'local',
    healthSource: 'link-only',
    displayUrl: '127.0.0.1:3088',
  },
  {
    id: 'memsys-console',
    name: 'MemSys Web Console',
    description: 'Memory-system bootstrap, source setup, and recovery.',
    group: 'memory-agents',
    href: 'http://127.0.0.1:5111',
    mode: 'local',
    healthSource: 'link-only',
    displayUrl: '127.0.0.1:5111',
  },
  {
    id: 'openclaw-status',
    name: 'OpenClaw Status',
    description: 'MCK-owned runtime connectivity probe.',
    group: 'memory-agents',
    href: '/api/openclaw/status',
    detailHref: '/api/openclaw/sessions',
    mode: 'diagnostic',
    healthSource: 'openclaw',
    displayUrl: '/api/openclaw/status',
  },
  {
    id: 'hermes-native',
    name: 'Hermes Native',
    description: 'Windows messaging gateway dashboard.',
    group: 'memory-agents',
    href: 'http://127.0.0.1:9119',
    mode: 'local',
    healthSource: 'link-only',
    displayUrl: '127.0.0.1:9119',
  },
  {
    id: 'n8n-sync-history',
    name: 'MCK Sync History',
    description: 'Latest scheduled GitHub Project sync result.',
    group: 'automation-health',
    href: '/n8n-sync-history',
    detailHref: '/api/n8n/mck-sync-status?limit=5',
    mode: 'internal',
    healthSource: 'n8n-sync',
    displayUrl: '/n8n-sync-history',
  },
  {
    id: 'n8n-local',
    name: 'n8n Local',
    description: 'Workflow runner for projects-ops sync and alerts.',
    group: 'automation-health',
    href: 'http://127.0.0.1:5678',
    mode: 'local',
    healthSource: 'link-only',
    displayUrl: '127.0.0.1:5678',
  },
  {
    id: 'projects-ops-health',
    name: 'Health Reports',
    description: 'Recurring health evidence is routed through projects-ops and MCK sync history.',
    group: 'automation-health',
    href: '/n8n-sync-history',
    mode: 'internal',
    healthSource: 'link-only',
    displayUrl: 'projects-ops reports via sync history',
  },
  {
    id: 'github-diagnostics',
    name: 'GitHub Diagnostics',
    description: 'Token, issue read, and Project field readiness.',
    group: 'readiness',
    href: '/api/github/diagnostics',
    mode: 'diagnostic',
    healthSource: 'github',
    displayUrl: '/api/github/diagnostics',
  },
  {
    id: 'managed-sync-route',
    name: 'Managed Sync Route',
    description: 'Repo dev and Docker-backed scheduled sync use mck.host:3021.',
    group: 'readiness',
    href: '/workspace/assistants',
    detailHref: '/n8n-sync-history',
    mode: 'internal',
    healthSource: 'self',
    displayUrl: '3021 / mck.host:3021',
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapGitHubDiagnosticsToHealth(payload: unknown): LocalControlHealth {
  const diagnostics = asRecord(payload);
  const status = String(diagnostics.status ?? 'error');
  const viewer = typeof diagnostics.viewer_login === 'string' ? diagnostics.viewer_login : '';

  if (status === 'ok') {
    return {
      state: 'ok',
      label: 'Ready',
      detail: viewer ? `Authenticated as @${viewer}` : 'GitHub issue and Project reads are available.',
    };
  }

  if (status === 'limited') {
    return {
      state: 'limited',
      label: 'Limited',
      detail: String(diagnostics.message ?? 'Issue reads are available; Project fields may be limited.'),
    };
  }

  return {
    state: 'attention',
    label: status === 'missing_token' ? 'Token needed' : 'Check needed',
    detail: String(diagnostics.message ?? 'GitHub diagnostics are not ready.'),
  };
}

export function mapOpenClawStatusToHealth(payload: unknown): LocalControlHealth {
  const status = asRecord(payload);
  const connected = Boolean(status.connected);
  const sessionsCount = asNumber(status.sessions_count);

  if (connected && !status.error) {
    return {
      state: 'ok',
      label: 'Connected',
      detail: `${sessionsCount} session${sessionsCount === 1 ? '' : 's'} visible`,
    };
  }

  if (connected && status.error) {
    return {
      state: 'limited',
      label: 'Limited',
      detail: String(status.error),
    };
  }

  if ('connected' in status) {
    return {
      state: 'attention',
      label: 'Offline',
      detail: String(status.error ?? 'OpenClaw gateway is not connected.'),
    };
  }

  return {
    state: 'unknown',
    label: 'Unknown',
    detail: 'OpenClaw status has not been checked yet.',
  };
}

export function mapN8nSyncStatusToHealth(payload: unknown): LocalControlHealth {
  const status = asRecord(payload);
  const latest = asRecord(status.latest);
  if (!status.latest) {
    return {
      state: 'unknown',
      label: 'No runs',
      detail: 'No MCK sync run has been recorded yet.',
    };
  }

  const ok = Boolean(latest.ok);
  const alertLevel = String(latest.alert_level ?? 'unknown');
  const summary = asRecord(latest.summary);
  const updated = asNumber(summary.updated);
  const errors = asNumber(summary.errors);

  if (!ok || alertLevel === 'error') {
    return {
      state: 'attention',
      label: 'Attention',
      detail: `${updated} updated, ${errors} error${errors === 1 ? '' : 's'}`,
    };
  }

  if (alertLevel === 'warning') {
    return {
      state: 'limited',
      label: 'Warning',
      detail: `${updated} updated; review latest sync warning.`,
    };
  }

  return {
    state: 'ok',
    label: 'OK',
    detail: `${updated} updated, ${errors} errors`,
  };
}

export function getDefaultHealthForSurface(surface: LocalControlSurface): LocalControlHealth {
  if (surface.healthSource === 'self') {
    return {
      state: 'ok',
      label: 'Ready',
      detail: 'Current MCK surface is running.',
    };
  }

  return {
    state: 'unknown',
    label: surface.healthSource === 'link-only' ? 'Link' : 'Checking',
    detail: surface.healthSource === 'link-only'
      ? 'Open to inspect'
      : 'Waiting for the local diagnostic endpoint.',
  };
}

export function mapHealthPayload(source: LocalControlHealthSource, payload: unknown): LocalControlHealth {
  switch (source) {
    case 'github':
      return mapGitHubDiagnosticsToHealth(payload);
    case 'openclaw':
      return mapOpenClawStatusToHealth(payload);
    case 'n8n-sync':
      return mapN8nSyncStatusToHealth(payload);
    case 'self':
      return getDefaultHealthForSurface({ healthSource: 'self' } as LocalControlSurface);
    default:
      return getDefaultHealthForSurface({ healthSource: 'link-only' } as LocalControlSurface);
  }
}
