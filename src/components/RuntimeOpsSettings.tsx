'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Clock, Copy, DatabaseZap, Download, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';

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
  latest_failure?: { created_at: string; runtime_type: string; reason: string } | null;
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

const WEBHOOK_AGENT_TEMPLATE = `{
  "webhook_url_env": "MCK_AGENT_WEBHOOK_URL",
  "signature_secret_env": "MCK_WEBHOOK_SIGNATURE_SECRET",
  "timeout_ms": 30000,
  "headers": {
    "X-MCK-Agent": "example-agent"
  }
}`;

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

  const copyWebhookTemplate = async () => {
    try {
      await navigator.clipboard.writeText(WEBHOOK_AGENT_TEMPLATE);
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
    return [
      { label: 'Webhook agents ready', value: webhookConfigured, tone: webhookNeedsConfig > 0 ? 'warn' : 'ok' },
      { label: 'Webhook agents needing config', value: webhookNeedsConfig, tone: webhookNeedsConfig > 0 ? 'warn' : 'ok' },
      { label: 'Failed/timeout attempts', value: failedAttempts, tone: failedAttempts > 0 ? 'warn' : 'ok' },
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

      <div className="grid gap-3 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className={`rounded border p-3 ${card.tone === 'warn' ? 'border-amber-400/30 bg-amber-500/10' : 'border-mc-border bg-mc-bg'}`}>
            <div className="text-xs uppercase tracking-wide text-mc-text-secondary">{card.label}</div>
            <div className="mt-1 text-2xl font-semibold text-mc-text">{card.value}</div>
          </div>
        ))}
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
            <button type="button" onClick={() => void copyWebhookTemplate()} className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary"><Copy className="size-4" /> {copyState === 'copied' ? 'Template copied' : copyState === 'error' ? 'Copy failed' : 'Copy config template'}</button>
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
