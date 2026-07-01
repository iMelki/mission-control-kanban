'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';

interface FailureRow {
  id: string;
  task_id: string;
  task_title: string;
  workspace_id: string;
  agent_name?: string | null;
  runtime_type: string;
  status: string;
  attempt_number: number;
  message: string;
  error_message?: string | null;
  http_status?: number | null;
  webhook_url?: string | null;
  created_at: string;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const columns: DataTableColumn<FailureRow>[] = [
  {
    key: 'task',
    header: 'Task',
    render: (row) => (
      <div>
        <div className="font-medium text-mc-text">{row.task_title || row.task_id}</div>
        <div className="text-xs text-mc-text-secondary">{row.workspace_id} · attempt {row.attempt_number}</div>
      </div>
    ),
  },
  {
    key: 'runtime',
    header: 'Runtime',
    render: (row) => <span className="rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">{row.runtime_type} / {row.status}</span>,
  },
  {
    key: 'agent',
    header: 'Agent',
    render: (row) => row.agent_name || 'Unassigned',
  },
  {
    key: 'reason',
    header: 'Failure reason',
    render: (row) => (
      <div className="max-w-xl">
        <div className="line-clamp-2">{row.error_message || row.message}</div>
        {row.http_status ? <div className="text-xs text-mc-text-secondary">HTTP {row.http_status}</div> : null}
        {row.webhook_url ? <div className="text-xs text-mc-text-secondary">{row.webhook_url}</div> : null}
      </div>
    ),
  },
  {
    key: 'created',
    header: 'When',
    render: (row) => <span className="text-xs text-mc-text-secondary">{formatTime(row.created_at)}</span>,
  },
];

export function DispatchFailureQueue({ workspaceId }: { workspaceId?: string }) {
  const [rows, setRows] = useState<FailureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const suffix = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetch(`/api/dispatch-attempts${suffix}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      setRows(payload.failures || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dispatch failures');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="size-5 text-rose-300" />
            Global dispatch failure queue
          </h2>
          <p className="text-sm text-mc-text-secondary">Failed and timed-out dispatch attempts across tasks, with redacted endpoint evidence.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-1.5 text-sm hover:bg-mc-bg-tertiary">
          <RefreshCw className="size-4" /> Refresh
        </button>
      </div>
      {error && <div className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div>}
      {loading ? <div className="rounded border border-mc-border p-4 text-sm text-mc-text-secondary">Loading dispatch failures…</div> : <DataTable columns={columns} rows={rows} empty="No failed or timed-out dispatch attempts." />}
    </section>
  );
}
