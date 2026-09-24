'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import { Header } from '@/components/Header';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { presentMckN8nSyncRun } from '@/lib/n8n-sync-presentation';
import type { MckN8nSyncRun, MckN8nSyncStatusResponse } from '@/lib/types';

const SYNC_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value?: string): string {
  if (!value) {
    return 'never';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'unknown time';
  }

  // react-doctor-disable-next-line -- Client-only operator page; run timestamps render in the operator's locale on purpose.
  return SYNC_DATE_FORMATTER.format(parsed);
}

function formatCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatReconciliationSuffix(summary: Record<string, unknown>): string {
  const statusReconciled = formatCount(summary.status_reconciled);
  const driftWarnings = formatCount(summary.upstream_drift_warnings);
  if (statusReconciled === 0 && driftWarnings === 0) {
    return '';
  }

  return `, ${statusReconciled} status reconciled, ${driftWarnings} upstream drift warning${driftWarnings === 1 ? '' : 's'}`;
}

function formatWorkspaces(run: MckN8nSyncRun): string {
  return run.workspaces.length > 0 ? run.workspaces.join(', ') : 'none';
}

function formatCadence(run: MckN8nSyncRun | null): string {
  const cadence = run?.raw_payload?.scheduleCadence;
  if (!cadence || typeof cadence !== 'object' || Array.isArray(cadence)) {
    return 'configured schedule';
  }

  const cadenceRecord = cadence as Record<string, unknown>;
  const schedule = Array.isArray(cadenceRecord.schedule)
    ? cadenceRecord.schedule.map((item) => String(item)).join(', ')
    : '';
  const timezone = typeof cadenceRecord.timezone === 'string' ? cadenceRecord.timezone : '';

  return [schedule, timezone].filter(Boolean).join(' ') || 'configured schedule';
}

const columns: DataTableColumn<MckN8nSyncRun>[] = [
  {
    key: 'run',
    header: 'Run',
    render: (run) => (
      <div>
        <div className="font-medium">{formatDate(run.received_at)}</div>
        <div className="text-xs text-mc-text-secondary">{run.id}</div>
      </div>
    ),
  },
  {
    key: 'mode',
    header: 'Mode',
    render: (run) => (
      <div>
        <div>{run.mode}</div>
        <div className="text-xs text-mc-text-secondary">{run.dry_run ? 'dry run' : 'apply'}</div>
      </div>
    ),
  },
  {
    key: 'workspaces',
    header: 'Workspaces',
    render: (run) => formatWorkspaces(run),
  },
  {
    key: 'counts',
    header: 'Counts',
    render: (run) => {
      const summary = (run.summary ?? {}) as Record<string, unknown>;
      return (
        <div>
          {formatCount(summary.scanned_items)} scanned, {formatCount(summary.imported)} imported, {formatCount(summary.updated)} updated, {formatCount(summary.errors)} errors{formatReconciliationSuffix(summary)}
        </div>
      );
    },
  },
  {
    key: 'alert',
    header: 'Alert',
    render: (run) => {
      const presentation = presentMckN8nSyncRun(run);
      const alertClassName = presentation.state === 'error'
        ? 'text-rose-200'
        : presentation.state === 'warning'
          ? 'text-amber-200'
          : 'text-emerald-200';
      return (
        <div className={alertClassName}>
          <div className="flex items-center gap-2">
            {presentation.state === 'ok' ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
            {presentation.label}
          </div>
          {run.alert_message && (
            <div className="mt-1 max-w-xl text-xs text-mc-text-secondary">{run.alert_message}</div>
          )}
        </div>
      );
    },
  },
];

export default function N8nSyncHistoryPage() {
  const [status, setStatus] = useState<MckN8nSyncStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/n8n/mck-sync-status?limit=25');
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || 'Failed to load n8n sync history');
      }

      setStatus(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load n8n sync history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const latest = status?.latest ?? null;
  const latestSummary = (latest?.summary ?? {}) as Record<string, unknown>;
  const latestPresentation = latest ? presentMckN8nSyncRun(latest) : null;

  return (
    <div className="min-h-screen bg-mc-bg">
      <Header />

      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 outline-none">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/"
              className="mb-3 inline-flex items-center gap-2 text-sm text-mc-text-secondary hover:text-mc-accent"
            >
              <ChevronLeft className="size-4" />
              Back to workspaces
            </Link>
            <h1 className="text-2xl font-semibold">n8n MCK Sync History</h1>
            <p className="mt-1 text-sm text-mc-text-secondary">
              Last local automation runs recorded by MCK.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadHistory()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 border border-rose-400/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        <section className="border-y border-mc-border bg-mc-bg-secondary px-4 py-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-mc-text-secondary">Latest result</div>
              <div className="mt-1 flex items-center gap-2 font-medium">
                {latestPresentation?.state === 'error' ? (
                  <AlertTriangle className="size-4 text-rose-300" />
                ) : latestPresentation?.state === 'warning' ? (
                  <AlertTriangle className="size-4 text-amber-300" />
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-300" />
                )}
                {latestPresentation?.label ?? 'No runs'}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-mc-text-secondary">Last run</div>
              <div className="mt-1 font-medium">{formatDate(latest?.received_at)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-mc-text-secondary">Cadence</div>
              <div className="mt-1 font-medium">{formatCadence(latest)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-mc-text-secondary">Latest counts</div>
              <div className="mt-1 font-medium">
                {formatCount(latestSummary.scanned_items)} scanned, {formatCount(latestSummary.updated)} updated, {formatCount(latestSummary.errors)} errors{formatReconciliationSuffix(latestSummary)}
              </div>
            </div>
          </div>
        </section>

        {loading && !status ? (
          <div className="border border-mc-border bg-mc-bg-secondary px-4 py-8 text-center text-sm text-mc-text-secondary">
            Loading history...
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={status?.history || []}
            empty="No n8n sync runs have been recorded yet."
            caption="n8n MCK sync run history"
          />
        )}
      </main>
    </div>
  );
}
