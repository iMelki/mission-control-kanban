import type { LoadPhase } from './cockpit-load-state';

export interface GitHubDiagnostics {
  status: 'ok' | 'limited' | 'missing_token' | 'error';
  token_source: 'GH_GENERAL_TOKEN' | 'GITHUB_TOKEN' | null;
  authenticated: boolean;
  issue_read_available?: boolean;
  viewer_login?: string;
  project_read_available: boolean;
  project_count_visible?: number | null;
  project_probe_error?: string;
  message: string;
}

export type ReadinessState = 'pending' | 'ready' | 'limited' | 'blocked';

export interface ReadinessRow {
  label: string;
  state: ReadinessState;
  message: string;
}

export interface PresentedGitHubReadiness {
  phase: LoadPhase;
  summary: string;
  detail: string;
  rows: ReadinessRow[];
  readyCount: number;
  assertsSettledFailure: boolean;
}

const LANE_LABELS = ['Import preview', 'Dry-run write-back', 'Apply write-back'] as const;

function pendingRows(): ReadinessRow[] {
  return LANE_LABELS.map((label) => ({
    label,
    state: 'pending' as const,
    message: 'Checking this GitHub lane…',
  }));
}

function missingTokenRows(): ReadinessRow[] {
  return [
    {
      label: 'Import preview',
      state: 'blocked',
      message: 'Needs GH_GENERAL_TOKEN or GITHUB_TOKEN so MCK can read GitHub issues and Project fields.',
    },
    {
      label: 'Dry-run write-back',
      state: 'blocked',
      message: 'Needs GitHub auth to resolve linked issues and prepare a trustworthy write-back plan.',
    },
    {
      label: 'Apply write-back',
      state: 'blocked',
      message: 'Needs GitHub auth before MCK can post comments or update allowed Project fields.',
    },
  ];
}

function errorRows(message: string): ReadinessRow[] {
  return LANE_LABELS.map((label) => ({
    label,
    state: 'blocked' as const,
    message,
  }));
}

function authenticatedRows(diagnostics: GitHubDiagnostics): ReadinessRow[] {
  const projectState: ReadinessState = diagnostics.project_read_available ? 'ready' : 'limited';
  return [
    {
      label: 'Import preview',
      state: projectState,
      message: diagnostics.project_read_available
        ? 'Issue import plus GitHub Project field parsing are available.'
        : 'Issue reads should work, but Project field parsing may be incomplete without read:project.',
    },
    {
      label: 'Dry-run write-back',
      state: 'ready',
      message: 'MCK can prepare the local write-back plan without mutating GitHub.',
    },
    {
      label: 'Apply write-back',
      state: projectState,
      message: diagnostics.project_read_available
        ? 'Issue comments and allowed Project field updates are available.'
        : 'Issue comments may work, but Project field updates will be skipped or noisy.',
    },
  ];
}

export function presentGitHubReadiness(input: {
  diagnostics: GitHubDiagnostics | null;
  loading: boolean;
}): PresentedGitHubReadiness {
  const { diagnostics } = input;

  if (!diagnostics) {
    return {
      phase: 'pending',
      summary: 'Checking GitHub…',
      detail: 'Checking GitHub connectivity and Project field access.',
      rows: pendingRows(),
      readyCount: 0,
      assertsSettledFailure: false,
    };
  }

  if (diagnostics.status === 'missing_token') {
    const rows = missingTokenRows();
    return {
      phase: 'ready',
      summary: `No token detected · 0/${rows.length} lanes ready`,
      detail: diagnostics.message,
      rows,
      readyCount: 0,
      assertsSettledFailure: true,
    };
  }

  if (diagnostics.status === 'error' || !diagnostics.authenticated) {
    const rows = errorRows(diagnostics.message);
    return {
      phase: 'ready',
      summary: `GitHub check failed · 0/${rows.length} lanes ready`,
      detail: diagnostics.message,
      rows,
      readyCount: 0,
      assertsSettledFailure: true,
    };
  }

  const rows = authenticatedRows(diagnostics);
  const readyCount = rows.filter((row) => row.state === 'ready').length;
  const who = diagnostics.viewer_login
    ? `Using @${diagnostics.viewer_login}`
    : diagnostics.token_source ?? 'GitHub connected';

  return {
    phase: 'ready',
    summary: `${who} · ${readyCount}/${rows.length} lanes ready`,
    detail: diagnostics.message,
    rows,
    readyCount,
    assertsSettledFailure: false,
  };
}

export function presentGitHubConnection(input: {
  diagnostics: GitHubDiagnostics | null;
  loading: boolean;
}): { phase: LoadPhase; title: string; detail: string } {
  const { diagnostics } = input;
  if (!diagnostics) {
    return { phase: 'pending', title: 'Checking GitHub…', detail: '' };
  }
  if (diagnostics.status === 'ok') {
    return {
      phase: 'ready',
      title: 'GitHub connected',
      detail: diagnostics.viewer_login
        ? `@${diagnostics.viewer_login}`
        : diagnostics.token_source ?? '',
    };
  }
  if (diagnostics.status === 'limited') {
    return {
      phase: 'ready',
      title: 'GitHub limited',
      detail: diagnostics.viewer_login
        ? `@${diagnostics.viewer_login}`
        : diagnostics.token_source ?? '',
    };
  }
  return {
    phase: 'ready',
    title: 'GitHub setup needed',
    detail: diagnostics.token_source ?? 'no token',
  };
}
