'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Github } from '@/components/icons/BrandIcons';
import { fetchWithBudget } from '@/lib/fetch-budget';
import {
  presentGitHubReadiness,
  type GitHubDiagnostics,
  type ReadinessState,
} from '@/lib/github-readiness';

function stateClassName(state: ReadinessState): string {
  switch (state) {
    case 'ready':
      return 'border-mc-success/30 bg-mc-success/10 text-mc-success';
    case 'limited':
      return 'border-mc-warn/30 bg-mc-warn/10 text-mc-warn';
    case 'pending':
      return 'border-mc-border bg-mc-bg-tertiary/40 text-mc-text-secondary';
    default:
      return 'border-mc-danger/30 bg-mc-danger/10 text-mc-danger';
  }
}

function StateIcon({ state }: { state: ReadinessState }) {
  if (state === 'ready') {
    return <CheckCircle2 className="size-4 text-mc-success" />;
  }
  if (state === 'pending') {
    return <Loader2 className="size-4 animate-spin text-mc-text-secondary" />;
  }

  return <AlertTriangle className={`size-4 ${state === 'limited' ? 'text-mc-warn' : 'text-mc-danger'}`} />;
}

export function GitHubReadinessCard() {
  const [diagnostics, setDiagnostics] = useState<GitHubDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetchWithBudget('/api/github/diagnostics');
      if (!response.ok) {
        throw new Error(`GitHub diagnostics request failed (${response.status})`);
      }
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

  const presented = useMemo(
    () => presentGitHubReadiness({ diagnostics, loading }),
    [diagnostics, loading],
  );

  return (
    <div
      className="mx-3 mt-3 rounded-xl border border-mc-border bg-mc-bg-secondary/70 p-3 text-sm text-mc-text-secondary"
      data-readiness-phase={presented.phase}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-2">
          <Github className="mt-0.5 size-5 text-mc-accent-cyan" />
          <div>
            <div className="font-semibold text-mc-text">GitHub import/write-back readiness</div>
            <p className="mt-1 text-xs" role="status">
              {presented.summary}
            </p>
            <p className="mt-1 text-xs">{presented.detail}</p>
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
        {presented.rows.map((row) => (
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
