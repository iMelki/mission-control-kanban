export type GitHubDiagnosticsStatus = 'ok' | 'limited' | 'missing_token' | 'error';
export type GitHubDiagnosticsTokenSource = 'GH_GENERAL_TOKEN' | 'GITHUB_TOKEN' | null;

export interface GitHubDiagnosticsPayload {
  status: GitHubDiagnosticsStatus;
  token_source: GitHubDiagnosticsTokenSource;
  authenticated: boolean;
  issue_read_available: boolean;
  project_read_available: boolean;
  viewer_login?: string;
  project_count_visible?: number | null;
  project_probe_error?: string;
  message: string;
}

export function buildMissingTokenDiagnostics(): GitHubDiagnosticsPayload {
  return {
    status: 'missing_token',
    token_source: null,
    authenticated: false,
    issue_read_available: false,
    project_read_available: false,
    project_count_visible: null,
    message: 'Set GH_GENERAL_TOKEN or GITHUB_TOKEN before using GitHub import and Project-field reads.',
  };
}

export function buildGitHubDiagnosticsPayload(input: {
  tokenSource: Exclude<GitHubDiagnosticsTokenSource, null>;
  viewerLogin?: string;
  projectReadAvailable: boolean;
  projectCountVisible?: number | null;
  projectProbeError?: string;
}): GitHubDiagnosticsPayload {
  const projectReadAvailable = input.projectReadAvailable;

  return {
    status: projectReadAvailable ? 'ok' : 'limited',
    token_source: input.tokenSource,
    authenticated: true,
    issue_read_available: true,
    viewer_login: input.viewerLogin ?? 'unknown',
    project_read_available: projectReadAvailable,
    project_count_visible: input.projectCountVisible ?? null,
    project_probe_error: input.projectProbeError,
    message: projectReadAvailable
      ? 'GitHub issue reads and Project field reads are available.'
      : 'GitHub issue reads are available, but Project field reads failed. Check read:project scope before relying on Project-backed import or write-back.',
  };
}

export function buildGitHubDiagnosticsError(input: {
  tokenSource: GitHubDiagnosticsTokenSource;
  message: string;
}): GitHubDiagnosticsPayload {
  return {
    status: 'error',
    token_source: input.tokenSource,
    authenticated: false,
    issue_read_available: false,
    project_read_available: false,
    project_count_visible: null,
    message: input.message,
  };
}

export function formatGitHubProbeError(error: unknown): string {
  const candidate = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const detail = typeof candidate?.stderr === 'string' && candidate.stderr.trim()
    ? candidate.stderr
    : typeof candidate?.stdout === 'string' && candidate.stdout.trim()
      ? candidate.stdout
      : typeof candidate?.message === 'string'
        ? candidate.message
        : 'GitHub probe failed.';

  return detail.replace(/\s+/g, ' ').trim();
}
