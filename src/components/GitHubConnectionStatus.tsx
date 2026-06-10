'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Github, Loader2 } from 'lucide-react';

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

export function GitHubConnectionStatus() {
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

  const status = diagnostics?.status ?? 'missing_token';
  const ok = status === 'ok';
  const limited = status === 'limited';

  return (
    <div className="flex items-center gap-2 rounded border border-mc-border/70 bg-mc-bg-secondary/70 px-3 py-1.5 text-xs text-mc-text-secondary">
      <Github className="size-4 text-mc-accent-cyan" />
      {loading && !diagnostics ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          <span>Checking GitHub…</span>
        </>
      ) : (
        <>
          {ok ? (
            <CheckCircle2 className="size-3 text-emerald-300" />
          ) : (
            <AlertTriangle className={`size-3 ${limited ? 'text-amber-300' : 'text-rose-300'}`} />
          )}
          <span className="font-medium text-mc-text">
            {ok ? 'GitHub connected' : limited ? 'GitHub limited' : 'GitHub setup needed'}
          </span>
          <span>
            {diagnostics?.viewer_login ? `@${diagnostics.viewer_login}` : diagnostics?.token_source ?? 'no token'}
          </span>
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
