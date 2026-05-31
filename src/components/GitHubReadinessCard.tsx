'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Github, Loader2, RefreshCw } from 'lucide-react';

interface GitHubDiagnostics {
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

type ReadinessState = 'ready' | 'limited' | 'blocked';

interface ReadinessRow {
  label: string;
  state: ReadinessState;
  message: string;
}

function stateClassName(state: ReadinessState): string {
  switch (state) {
    case 'ready':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'limited':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    default:
      return 'border-rose-500/30 bg-rose-500/10 text-rose-100';
  }
}

function StateIcon({ state }: { state: ReadinessState }) {
  if (state === 'ready') {
    return <CheckCircle2 className="size-4 text-emerald-300" />;
  }

  return <AlertTriangle className={`size-4 ${state === 'limited' ? 'text-amber-300' : 'text-rose-300'}`} />;
}

function buildRows(diagnostics: GitHubDiagnostics | null): ReadinessRow[] {
  if (!diagnostics || diagnostics.status === 'missing_token') {
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

  if (diagnostics.status === 'error' || !diagnostics.authenticated) {
    return [
      {
        label: 'Import preview',
        state: 'blocked',
        message: diagnostics.message,
      },
      {
        label: 'Dry-run write-back',
        state: 'blocked',
        message: diagnostics.message,
      },
      {
        label: 'Apply write-back',
        state: 'blocked',
        message: diagnostics.message,
      },
    ];
  }

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

export function GitHubReadinessCard() {
  const [diagnostics, setDiagnostics] = useState<GitHubDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/github/diagnostics', { cache: 'no-store' });
      const payload = (await response.json()) as GitHubDiagnostics;
      setDiagnostics(payload);
    } catch (error) {
      setDiagnostics({
        status: 'error',
        token_source: null,
        authenticated: false,
        issue_read_available: false,
        project_read_available: false,
        message: error instanceof Error ? error.message : 'Unable to read GitHub diagnostics.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const rows = useMemo(() => buildRows(diagnostics), [diagnostics]);
  const readyCount = rows.filter((row) => row.state === 'ready').length;

  return (
    <div className="mx-3 mt-3 rounded-xl border border-mc-border bg-mc-bg-secondary/70 p-3 text-sm text-mc-text-secondary">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-2">
          <Github className="mt-0.5 size-5 text-mc-accent-cyan" />
          <div>
            <div className="font-semibold text-mc-text">GitHub import/write-back readiness</div>
            <p className="mt-1 text-xs">
              {diagnostics?.viewer_login ? `Using @${diagnostics.viewer_login}` : diagnostics?.token_source ?? 'No token detected'} · {readyCount}/3 lanes ready
            </p>
            <p className="mt-1 text-xs">{diagnostics?.message ?? 'Checking GitHub connectivity and Project field access.'}</p>
            {diagnostics?.project_probe_error ? (
              <p className="mt-1 text-xs text-amber-200">{diagnostics.project_probe_error}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-mc-border px-2 py-1 text-xs hover:bg-mc-bg disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Refresh
        </button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className={`rounded-lg border px-3 py-2 ${stateClassName(row.state)}`}>
            <div className="flex items-center gap-2 font-medium">
              <StateIcon state={row.state} />
              {row.label}
            </div>
            <p className="mt-1 text-xs opacity-90">{row.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
