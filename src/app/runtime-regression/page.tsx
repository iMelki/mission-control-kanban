'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Activity, Camera, Clock, ExternalLink, RefreshCw, Terminal } from 'lucide-react';

interface RuntimeRegressionScreenshot {
  name: string;
  path: string;
  preview_url: string;
  size_bytes: number;
  updated_at: string;
}

interface RuntimeRegressionArtifact {
  name: string;
  path: string;
  updated_at: string;
  screenshot_count: number;
  screenshots: RuntimeRegressionScreenshot[];
  ci_run_url?: string;
}

interface RuntimeRegressionPayload {
  ok: boolean;
  latest: RuntimeRegressionArtifact | null;
  recent: boolean;
  latest_age_hours: number | null;
  artifact_root: string;
  local_command: string;
  ci_workflow: string;
  artifacts: RuntimeRegressionArtifact[];
}

function formatAge(hours: number | null) {
  if (hours === null) return 'unknown age';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes ago`;
  return `${hours.toFixed(1)} hours ago`;
}

export default function RuntimeRegressionPage() {
  const [payload, setPayload] = useState<RuntimeRegressionPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPayload = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/runtime/regression', { cache: 'no-store' });
      setPayload(await response.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPayload();
  }, []);

  const latest = payload?.latest ?? null;

  return (
    <main className="min-h-screen bg-mc-bg p-4 text-mc-text md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2 text-mc-accent">
              <Activity className="size-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.2em]">Runtime proof</span>
            </div>
            <h1 className="text-3xl font-bold">Runtime Regression Evidence</h1>
            <p className="mt-2 max-w-3xl text-sm text-mc-text-secondary">
              Operator-facing drilldown for the latest local runtime UI smoke artifacts. GitHub Actions artifacts still live on the workflow run; local screenshots stay under the ignored artifact directory.
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadPayload()}
            className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
          >
            <RefreshCw className="size-4" /> Refresh
          </button>
        </div>

        <section className={`rounded-lg border p-5 ${payload?.recent ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-amber-400/30 bg-amber-500/10'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm uppercase tracking-wide text-mc-text-secondary">Latest proof</div>
              <div className="mt-1 text-2xl font-semibold">{latest ? latest.name : 'No local artifact found'}</div>
            </div>
            <span className="rounded border border-mc-border bg-mc-bg px-3 py-1 text-sm">
              {payload?.recent ? 'Fresh' : latest ? 'Stale' : 'Missing'}
            </span>
          </div>
          {latest && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded border border-mc-border bg-mc-bg p-3">
                <div className="mb-1 flex items-center gap-2 text-xs uppercase text-mc-text-secondary"><Clock className="size-4" /> Updated</div>
                <div>{new Date(latest.updated_at).toLocaleString()}</div>
                <div className="text-xs text-mc-text-secondary">{formatAge(payload?.latest_age_hours ?? null)}</div>
              </div>
              <div className="rounded border border-mc-border bg-mc-bg p-3">
                <div className="mb-1 flex items-center gap-2 text-xs uppercase text-mc-text-secondary"><Camera className="size-4" /> Screenshots</div>
                <div className="text-2xl font-semibold">{latest.screenshot_count}</div>
              </div>
              <div className="rounded border border-mc-border bg-mc-bg p-3">
                <div className="mb-1 text-xs uppercase text-mc-text-secondary">Artifact path</div>
                <code className="break-all text-xs text-mc-accent">{latest.path}</code>
                {latest.ci_run_url && <a href={latest.ci_run_url} className="mt-2 inline-flex items-center gap-1 text-xs text-mc-accent hover:underline"><ExternalLink className="size-3" /> CI run</a>}
              </div>
            </div>
          )}
          {latest?.screenshots && latest.screenshots.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {latest.screenshots.map((screenshot) => (
                <figure key={screenshot.path} className="rounded border border-mc-border bg-mc-bg p-2">
                  <Image src={screenshot.preview_url} alt={screenshot.name} width={320} height={180} unoptimized className="aspect-video w-full rounded object-cover" />
                  <figcaption className="mt-2 truncate text-xs text-mc-text-secondary" title={screenshot.path}>{screenshot.name}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-mc-border bg-mc-bg-secondary p-5">
            <div className="mb-2 flex items-center gap-2 font-semibold"><Terminal className="size-4 text-mc-accent" /> Local command</div>
            <code className="block rounded border border-mc-border bg-mc-bg p-3 text-sm text-mc-accent">{payload?.local_command ?? 'npm run check:runtime-regressions'}</code>
            <p className="mt-3 text-sm text-mc-text-secondary">Runs React Doctor changed-scope plus the browser runtime UI smoke and writes screenshots under {payload?.artifact_root ?? 'artifacts/runtime-ui-smoke'}.</p>
          </div>
          <div className="rounded-lg border border-mc-border bg-mc-bg-secondary p-5">
            <div className="mb-2 flex items-center gap-2 font-semibold"><ExternalLink className="size-4 text-mc-accent" /> CI workflow</div>
            <code className="block rounded border border-mc-border bg-mc-bg p-3 text-sm text-mc-accent">{payload?.ci_workflow ?? '.github/workflows/runtime-regression.yml'}</code>
            <p className="mt-3 text-sm text-mc-text-secondary">Use <code>npm run comment:runtime-artifacts -- --dry-run</code> to preview the latest GitHub Actions run and artifact links.</p>
          </div>
        </section>

        <section className="rounded-lg border border-mc-border bg-mc-bg-secondary p-5">
          <h2 className="mb-3 text-lg font-semibold">Recent local artifacts</h2>
          <div className="space-y-2">
            {(payload?.artifacts ?? []).map((artifact) => (
              <div key={artifact.path} className="rounded border border-mc-border bg-mc-bg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{artifact.name}</div>
                  <span className="text-xs text-mc-text-secondary">{artifact.screenshot_count} screenshots</span>
                </div>
                <div className="mt-1 break-all text-xs text-mc-text-secondary">{artifact.path}</div>
              </div>
            ))}
            {!loading && (payload?.artifacts ?? []).length === 0 && (
              <div className="rounded border border-mc-border bg-mc-bg p-3 text-sm text-mc-text-secondary">No local runtime smoke artifacts found yet.</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
