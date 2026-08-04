'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Clock, DatabaseZap, Download, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { RuntimeConfigTemplateGallery } from '@/components/runtime/RuntimeConfigTemplateGallery';

interface CallbackDeliveryRow {
  id: string;
  delivery_id: string;
  task_id?: string | null;
  attempt_id?: string | null;
  event_type: string;
  status: string;
  reason?: string | null;
  expires_at: string;
  received_at: string;
}

interface RuntimeHealthPayload {
  ok: boolean;
  generated_at: string;
  callback_signature?: {
    outbound_secret_configured: boolean;
    inbound_secret_configured: boolean;
  };
  webhook?: {
    configured: number;
    needs_config: number;
  };
  agent_counts?: Array<{ runtime_type: string; dispatch_enabled: number; count: number }>;
  attempt_counts?: Array<{ runtime_type: string; status: string; count: number }>;
  failure_rate_trends?: RuntimeFailureRateTrendPoint[];
  failure_threshold_policy?: { warn_rate: number; critical_rate: number; min_attempts: number; lookback_days: number };
  failure_threshold_alerts?: RuntimeFailureThresholdAlert[];
  latest_failure?: { created_at: string; runtime_type: string; reason: string } | null;
}

interface RuntimeFailureThresholdAlert {
  runtime_type: string;
  level: 'warning' | 'critical';
  failure_rate: number;
  failed: number;
  timeout: number;
  total: number;
  window_days: number;
  message: string;
}

interface RuntimeFailureRateTrendPoint {
  date: string;
  runtime_type: string;
  total: number;
  failed: number;
  timeout: number;
  failure_rate: number;
}

const callbackColumns: DataTableColumn<CallbackDeliveryRow>[] = [
  {
    key: 'delivery',
    header: 'Delivery',
    accessor: (row) => row.delivery_id,
    searchValue: (row) => `${row.delivery_id} ${row.task_id || ''} ${row.attempt_id || ''}`,
    render: (row) => (
      <div>
        <div className="font-medium text-mc-text">{row.delivery_id}</div>
        <div className="text-xs text-mc-text-secondary">{row.task_id || 'no task'} · {row.attempt_id || 'no attempt'}</div>
      </div>
    ),
  },
  {
    key: 'event',
    header: 'Event',
    accessor: (row) => row.event_type,
    render: (row) => <span className="rounded border border-mc-border px-2 py-1 text-xs">{row.event_type}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    accessor: (row) => row.status,
    render: (row) => (
      <span className={`rounded border px-2 py-1 text-xs ${row.status === 'accepted' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : row.status === 'duplicate' ? 'border-amber-400/30 bg-amber-500/10 text-amber-100' : 'border-rose-400/30 bg-rose-500/10 text-rose-100'}`}>
        {row.status}
      </span>
    ),
  },
  {
    key: 'received',
    header: 'Received',
    accessor: (row) => row.received_at,
    render: (row) => <span className="text-xs text-mc-text-secondary">{new Date(row.received_at).toLocaleString()}</span>,
  },
  {
    key: 'reason',
    header: 'Reason',
    accessor: (row) => row.reason || '',
    render: (row) => <span className="text-xs text-mc-text-secondary">{row.reason || '—'}</span>,
  },
];

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function runtimeTrendGroups(points: RuntimeFailureRateTrendPoint[]) {
  const grouped = new Map<string, RuntimeFailureRateTrendPoint[]>();
  for (const point of points) {
    const existing = grouped.get(point.runtime_type) ?? [];
    existing.push(point);
    grouped.set(point.runtime_type, existing);
  }
  return Array.from(grouped.entries()).map(([runtime, runtimePoints]) => ({
    runtime,
    points: runtimePoints.slice(-14),
    latest: runtimePoints[runtimePoints.length - 1],
  }));
}

function RuntimeFailureRateCards({ points }: { points: RuntimeFailureRateTrendPoint[] }) {
  const groups = runtimeTrendGroups(points);
  if (groups.length === 0) {
    return (
      <div className="rounded border border-mc-border bg-mc-bg p-4 text-sm text-mc-text-secondary">
        No runtime dispatch attempts in the current trend window yet. The chart will populate after manual, webhook, or OpenClaw dispatch attempts are recorded.
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {groups.map((group) => {
        const latest = group.latest;
        const failed = safeNumber(latest?.failed) + safeNumber(latest?.timeout);
        const total = safeNumber(latest?.total);
        const failurePercent = Math.round(safeNumber(latest?.failure_rate) * 100);
        return (
          <div key={group.runtime} className="rounded border border-mc-border bg-mc-bg p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-mc-text-secondary">{group.runtime}</div>
                <div className="mt-1 text-2xl font-semibold text-mc-text">{failurePercent}%</div>
              </div>
              <span className="rounded border border-mc-border px-2 py-1 text-xs text-mc-text-secondary">
                {failed}/{total} failed
              </span>
            </div>
            <div className="mt-4 flex h-16 items-end gap-1" aria-label={`${group.runtime} dispatch failure-rate trend`}>
              {group.points.map((point) => {
                const height = Math.max(4, Math.round(point.failure_rate * 64));
                const isFailure = point.failed + point.timeout > 0;
                return (
                  <div
                    key={`${point.date}-${group.runtime}`}
                    title={`${point.date}: ${Math.round(point.failure_rate * 100)}% (${point.failed + point.timeout}/${point.total})`}
                    className={`min-w-3 flex-1 rounded-t ${isFailure ? 'bg-amber-400/80' : 'bg-emerald-400/60'}`}
                    style={{ height }}
                  />
                );
              })}
            </div>
            <div className="mt-2 text-xs text-mc-text-secondary">
              Latest bucket: {latest?.date ?? '—'} · low sample sizes can look volatile.
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RuntimeOpsSettings() {
  const [retentionResult, setRetentionResult] = useState<Record<string, unknown> | null>(null);
  const [callbackResult, setCallbackResult] = useState<Record<string, unknown> | null>(null);
  const [callbacks, setCallbacks] = useState<CallbackDeliveryRow[]>([]);
  const [health, setHealth] = useState<RuntimeHealthPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const loadRuntimeOps = async () => {
    setLoading(true);
    try {
      const [healthResponse, callbackResponse] = await Promise.all([
        fetch('/api/runtime/health'),
        fetch('/api/webhook-callback-deliveries?limit=100'),
      ]);
      setHealth(await healthResponse.json());
      const callbackPayload = await callbackResponse.json();
      setCallbacks(callbackPayload.deliveries || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRuntimeOps();
  }, []);

  const runRetention = async (dryRun: boolean) => {
    setLoading(true);
    try {
      const response = await fetch('/api/dispatch-attempts/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      setRetentionResult(await response.json());
      await loadRuntimeOps();
    } finally {
      setLoading(false);
    }
  };

  const runCallbackPrune = async (dryRun: boolean) => {
    setLoading(true);
    try {
      const response = await fetch('/api/webhook-callback-deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      setCallbackResult(await response.json());
      await loadRuntimeOps();
    } finally {
      setLoading(false);
    }
  };

  const copyTemplate = async (configJson: string) => {
    try {
      await navigator.clipboard.writeText(configJson);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
    }
  };

  const cards = useMemo(() => {
    const attempts = health?.attempt_counts || [];
    const failedAttempts = attempts
      .filter((row) => row.status === 'failed' || row.status === 'timeout')
      .reduce((sum, row) => sum + safeNumber(row.count), 0);
    const webhookConfigured = safeNumber(health?.webhook?.configured);
    const webhookNeedsConfig = safeNumber(health?.webhook?.needs_config);
    const acceptedCallbacks = callbacks.filter((row) => row.status === 'accepted').length;
    const alerts = health?.failure_threshold_alerts || [];
    return [
      { label: 'Webhook agents ready', value: webhookConfigured, tone: webhookNeedsConfig > 0 ? 'warn' : 'ok' },
      { label: 'Webhook agents needing config', value: webhookNeedsConfig, tone: webhookNeedsConfig > 0 ? 'warn' : 'ok' },
      { label: 'Failed/timeout attempts', value: failedAttempts, tone: failedAttempts > 0 ? 'warn' : 'ok' },
      { label: 'Failure threshold alerts', value: alerts.length, tone: alerts.length > 0 ? 'warn' : 'ok' },
      { label: 'Accepted callbacks', value: acceptedCallbacks, tone: 'ok' },
    ];
  }, [callbacks, health]);

  return (
    <section className="mb-8 space-y-6 rounded-lg border border-mc-border bg-mc-bg-secondary p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Clock className="h-5 w-5 text-mc-accent" />
            <h2 className="text-xl font-semibold text-mc-text">Runtime operations</h2>
          </div>
          <p className="max-w-3xl text-sm text-mc-text-secondary">
            Admin surface for dispatch retention, webhook callback replay detection, runtime health, and safe agent webhook templates. Secrets are represented as env-var names only.
          </p>
        </div>
        <button type="button" disabled={loading} onClick={() => void loadRuntimeOps()} className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50">
          <RefreshCw className="size-4" /> Refresh runtime ops
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className={`rounded border p-3 ${card.tone === 'warn' ? 'border-amber-400/30 bg-amber-500/10' : 'border-mc-border bg-mc-bg'}`}>
            <div className="text-xs uppercase tracking-wide text-mc-text-secondary">{card.label}</div>
            <div className="mt-1 text-2xl font-semibold text-mc-text">{card.value}</div>
          </div>
        ))}
      </div>

      {health?.failure_threshold_alerts && health.failure_threshold_alerts.length > 0 && (
        <div className="space-y-2 rounded border border-amber-400/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-amber-100">
            <ShieldAlert className="size-4" /> Runtime failure threshold alerts
          </div>
          {health.failure_threshold_alerts.map((alert) => (
            <div key={`${alert.runtime_type}-${alert.level}`} className="rounded border border-mc-border bg-mc-bg px-3 py-2 text-sm">
              <span className={alert.level === 'critical' ? 'font-semibold text-rose-200' : 'font-semibold text-amber-100'}>{alert.level.toUpperCase()}</span>
              <span className="ml-2 text-mc-text-secondary">{alert.message} Failed/timeout: {alert.failed + alert.timeout}/{alert.total}.</span>
            </div>
          ))}
          {health.failure_threshold_policy && (
            <div className="text-xs text-mc-text-secondary">
              Policy: warn {Math.round(health.failure_threshold_policy.warn_rate * 100)}%, critical {Math.round(health.failure_threshold_policy.critical_rate * 100)}%, min {health.failure_threshold_policy.min_attempts} attempts, {health.failure_threshold_policy.lookback_days} day window.
            </div>
          )}
        </div>
      )}

      <div className="rounded border border-mc-border bg-mc-bg-secondary p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-mc-accent" />
            <h3 className="font-semibold">Per-runtime failure-rate trends</h3>
          </div>
          <span className="text-xs text-mc-text-secondary">14-day dispatch attempt window</span>
        </div>
        <p className="mb-4 text-sm text-mc-text-secondary">
          Small multiples show failed plus timeout attempts divided by total dispatch attempts for each runtime. Manual attempts are included so handoff-only queues do not look artificially perfect.
        </p>
        <RuntimeFailureRateCards points={health?.failure_rate_trends || []} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-mc-border bg-mc-bg p-4">
          <div className="mb-3 flex items-center gap-2">
            <DatabaseZap className="size-4 text-mc-accent" />
            <h3 className="font-semibold">Dispatch attempt cleanup</h3>
          </div>
          <p className="mb-4 text-sm text-mc-text-secondary">
            Server policy defaults: success/manual 30 days, failed/timeout 90 days, batch size 500 unless overridden by env.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={loading} onClick={() => void runRetention(true)} className="rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50">Dry-run cleanup</button>
            <button type="button" disabled={loading} onClick={() => void runRetention(false)} className="inline-flex items-center gap-2 rounded border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 hover:bg-rose-500/20 disabled:opacity-50"><Trash2 className="size-4" /> Apply cleanup</button>
          </div>
          {retentionResult && <pre className="mt-4 max-h-48 overflow-auto rounded border border-mc-border bg-mc-bg-secondary p-3 text-xs text-mc-text-secondary">{JSON.stringify(retentionResult, null, 2)}</pre>}
        </div>

        <div className="rounded border border-mc-border bg-mc-bg p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4 text-mc-accent" />
            <h3 className="font-semibold">Webhook templates & callback cleanup</h3>
          </div>
          <p className="mb-4 text-sm text-mc-text-secondary">
            Download canonical schemas or copy a runtime_config template that stores URLs/secrets through environment variables.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/schemas/webhook-dispatch-payload" className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary"><Download className="size-4" /> Dispatch schema</a>
            <a href="/api/schemas/webhook-callback-completion" className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary"><Download className="size-4" /> Callback schema</a>
          </div>
          <div className="mt-4">
            <RuntimeConfigTemplateGallery
              compact
              onApply={(configJson) => void copyTemplate(configJson)}
              onCopy={(configJson) => copyTemplate(configJson)}
            />
            {copyState !== 'idle' && <div className="mt-2 text-xs text-mc-text-secondary">{copyState === 'copied' ? 'Template copied to clipboard.' : 'Copy failed.'}</div>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={loading} onClick={() => void runCallbackPrune(true)} className="rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50">Dry-run callback prune</button>
            <button type="button" disabled={loading} onClick={() => void runCallbackPrune(false)} className="rounded border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/20 disabled:opacity-50">Apply callback prune</button>
          </div>
          {callbackResult && <pre className="mt-4 max-h-48 overflow-auto rounded border border-mc-border bg-mc-bg-secondary p-3 text-xs text-mc-text-secondary">{JSON.stringify(callbackResult, null, 2)}</pre>}
        </div>
      </div>

      <div className="rounded border border-mc-border bg-mc-bg p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-mc-accent" />
            <h3 className="font-semibold">Webhook callback replay ledger</h3>
          </div>
          <span className="text-xs text-mc-text-secondary">{callbacks.length} recent deliveries</span>
        </div>
        <DataTable columns={callbackColumns} rows={callbacks} empty="No callback deliveries recorded yet." />
      </div>

      {health?.latest_failure && (
        <div className="rounded border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          Latest runtime failure: {health.latest_failure.runtime_type} at {new Date(health.latest_failure.created_at).toLocaleString()} — {health.latest_failure.reason}
        </div>
      )}
    </section>
  );
}
