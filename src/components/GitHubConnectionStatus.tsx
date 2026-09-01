'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Github } from '@/components/icons/BrandIcons';
import { fetchWithBudget } from '@/lib/fetch-budget';
import {
  presentGitHubConnection,
  type GitHubDiagnostics,
} from '@/lib/github-readiness';

export function GitHubConnectionStatus() {
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
    () => presentGitHubConnection({ diagnostics, loading }),
    [diagnostics, loading],
  );
  const checking = presented.phase === 'pending';
  const ok = diagnostics?.status === 'ok';
  const limited = diagnostics?.status === 'limited';

  return (
    <div
      className="flex items-center gap-2 rounded border border-mc-border/70 bg-mc-bg-secondary/70 px-3 py-1.5 text-xs text-mc-text-secondary"
      data-github-connection-phase={presented.phase}
    >
      <Github className="size-4 text-mc-accent-cyan" />
      {checking ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          <span role="status">{presented.title}</span>
        </>
      ) : (
        <>
          {ok ? (
            <CheckCircle2 className="size-3 text-emerald-300" />
          ) : (
            <AlertTriangle className={`size-3 ${limited ? 'text-amber-300' : 'text-rose-300'}`} />
          )}
          <span className="font-medium text-mc-text">{presented.title}</span>
          {presented.detail ? <span>{presented.detail}</span> : null}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded border border-mc-border px-2 py-0.5 text-[11px] hover:bg-mc-bg disabled:opacity-50"
            title={diagnostics?.project_probe_error ?? diagnostics?.message}
          >
            {loading ? 'Checking' : 'Check'}
          </button>
        </>
      )}
    </div>
  );
}
