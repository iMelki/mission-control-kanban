'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { DataTable, type DataTableBulkAction, type DataTableColumn, type DataTableFilter } from '@/components/ui/DataTable';

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

function uniqueOptions(rows: FailureRow[], accessor: (row: FailureRow) => string) {
  return Array.from(new Set(rows.flatMap((row) => {
    const value = accessor(row);
    return value ? [value] : [];
  })))
    .sort((first, second) => first.localeCompare(second))
    .map((value) => ({ label: value, value }));
}

const columns: DataTableColumn<FailureRow>[] = [
  {
    key: 'task',
    header: 'Task',
    accessor: (row) => row.task_title || row.task_id,
    searchValue: (row) => `${row.task_title || ''} ${row.task_id} ${row.workspace_id} attempt ${row.attempt_number}`,
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
    accessor: (row) => row.runtime_type,
    searchValue: (row) => `${row.runtime_type} ${row.status}`,
    render: (row) => <span className="rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">{row.runtime_type} / {row.status}</span>,
  },
  {
    key: 'agent',
    header: 'Agent',
    accessor: (row) => row.agent_name || 'Unassigned',
    render: (row) => row.agent_name || 'Unassigned',
  },
  {
    key: 'reason',
    header: 'Failure reason',
    accessor: (row) => row.error_message || row.message,
    searchValue: (row) => `${row.error_message || row.message} ${row.http_status || ''} ${row.webhook_url || ''}`,
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
    accessor: (row) => {
      const time = new Date(row.created_at).getTime();
      return Number.isNaN(time) ? 0 : time;
    },
    enableGlobalFilter: false,
    render: (row) => <span className="text-xs text-mc-text-secondary">{formatTime(row.created_at)}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    accessor: (row) => row.status,
    hidden: true,
  },
];

export function DispatchFailureQueue({ workspaceId }: { workspaceId?: string }) {
  const [rows, setRows] = useState<FailureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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

  const filters = useMemo<DataTableFilter[]>(() => [
    {
      id: 'runtime',
      label: 'Runtime',
      columnId: 'runtime',
      allLabel: 'All runtimes',
      options: uniqueOptions(rows, (row) => row.runtime_type),
    },
    {
      id: 'status',
      label: 'Status',
      columnId: 'status',
      allLabel: 'All statuses',
      options: uniqueOptions(rows, (row) => row.status),
    },
    {
      id: 'agent',
      label: 'Agent',
      columnId: 'agent',
      allLabel: 'All agents',
      options: uniqueOptions(rows, (row) => row.agent_name || 'Unassigned'),
    },
  ], [rows]);

  const bulkActions = useMemo<DataTableBulkAction<FailureRow>[]>(() => [
    {
      label: 'Retry selected webhooks',
      disabled: (selectedRows) => !selectedRows.some((row) => row.runtime_type === 'webhook'),
      onClick: async (selectedRows) => {
        setError(null);
        setActionMessage(null);
        const taskIds = Array.from(new Set(selectedRows.flatMap((row) => (
          row.runtime_type === 'webhook' ? [row.task_id] : []
        ))));

        if (taskIds.length === 0) {
          setActionMessage('No retryable webhook failures were selected.');
          return;
        }

        try {
          const results = await Promise.all(taskIds.map(async (taskId) => {
            const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/dispatch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ retry: true, confirm: true }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(payload.error || `Retry failed for ${taskId} with HTTP ${response.status}`);
            }
            return payload;
          }));

          setActionMessage(`Retried ${results.length} webhook ${results.length === 1 ? 'task' : 'tasks'}.`);
          await load();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to retry selected webhook dispatches');
        }
      },
    },
    {
      label: 'Copy task IDs',
      onClick: async (selectedRows) => {
        const taskIds = Array.from(new Set(selectedRows.map((row) => row.task_id)));
        const text = taskIds.join('\n');
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          setActionMessage(`Copied ${taskIds.length} task ${taskIds.length === 1 ? 'ID' : 'IDs'} to the clipboard.`);
        } else {
          setActionMessage(`Clipboard API unavailable. Selected task IDs: ${taskIds.join(', ')}`);
        }
      },
    },
  ], [load]);

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
      {actionMessage && <div className="rounded border border-mc-border bg-mc-bg-secondary p-3 text-sm text-mc-text-secondary">{actionMessage}</div>}
      {loading ? (
        <div className="rounded border border-mc-border p-4 text-sm text-mc-text-secondary">Loading dispatch failures…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          empty="No failed or timed-out dispatch attempts."
          caption="Global dispatch failure queue"
          search={{ label: 'Search failures', placeholder: 'Search task, agent, endpoint, or error…' }}
          filters={filters}
          initialSorting={[{ id: 'created', desc: true }]}
          enableRowSelection
          bulkActions={bulkActions}
          selectedRowsLabel={(selected, visible) => `${selected} of ${visible} selected`}
        />
      )}
    </section>
  );
}
