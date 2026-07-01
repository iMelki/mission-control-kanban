'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCcw, RadioTower } from 'lucide-react';
import { Panel, PanelBody, PanelHeader } from './ui/Panel';

interface DispatchAttempt {
  id: string;
  task_id: string;
  agent_id?: string | null;
  runtime_type: 'manual' | 'openclaw' | 'webhook';
  adapter_name?: string | null;
  status: 'manual' | 'success' | 'failed' | 'timeout' | 'skipped' | 'retrying';
  attempt_number: number;
  message: string;
  http_status?: number | null;
  webhook_url?: string | null;
  error_message?: string | null;
  created_at: string;
}

interface DispatchTimelineProps {
  taskId: string;
}

function statusTone(status: DispatchAttempt['status']) {
  switch (status) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'failed':
    case 'timeout':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
    case 'retrying':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    default:
      return 'border-mc-border bg-mc-bg text-mc-text-secondary';
  }
}

function StatusIcon({ status }: { status: DispatchAttempt['status'] }) {
  if (status === 'success') return <CheckCircle2 className="size-4 text-emerald-300" />;
  if (status === 'failed' || status === 'timeout') return <AlertTriangle className="size-4 text-rose-300" />;
  if (status === 'retrying') return <RefreshCcw className="size-4 text-amber-300" />;
  return <Clock3 className="size-4 text-mc-text-secondary" />;
}

export function DispatchTimeline({ taskId }: DispatchTimelineProps) {
  const [attempts, setAttempts] = useState<DispatchAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [retryState, setRetryState] = useState<'idle' | 'retrying' | 'error'>('idle');

  const loadAttempts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/dispatch`);
      if (response.ok) {
        const data = await response.json();
        setAttempts(Array.isArray(data.attempts) ? data.attempts : []);
      }
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadAttempts();
  }, [loadAttempts]);

  const latest = attempts[0];
  const canRetryWebhook = latest?.runtime_type === 'webhook' && ['failed', 'timeout'].includes(latest.status);

  const handleRetry = async () => {
    if (!canRetryWebhook) return;
    setRetryState('retrying');
    try {
      const response = await fetch(`/api/tasks/${taskId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retry: true }),
      });
      if (!response.ok) throw new Error(`Retry failed with HTTP ${response.status}`);
      setRetryState('idle');
      await loadAttempts();
    } catch (error) {
      console.error('Dispatch retry failed:', error);
      setRetryState('error');
    }
  };

  return (
    <Panel>
      <PanelHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RadioTower className="size-4 text-mc-accent" />
          <div>
            <h3 className="text-sm font-semibold">Dispatch timeline</h3>
            <p className="text-xs text-mc-text-secondary">Adapter outcome history for this task.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <span className="text-xs text-mc-text-secondary">Refreshing…</span>}
          <button
            type="button"
            onClick={handleRetry}
            disabled={!canRetryWebhook || retryState === 'retrying'}
            className="inline-flex items-center gap-1 rounded border border-mc-border px-2 py-1 text-xs text-mc-text hover:bg-mc-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCcw className={`size-3 ${retryState === 'retrying' ? 'animate-spin' : ''}`} />
            Retry webhook
          </button>
        </div>
      </PanelHeader>
      <PanelBody className="space-y-2">
        {retryState === 'error' && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            Retry failed. Check webhook config and the latest attempt message.
          </div>
        )}
        {attempts.length === 0 ? (
          <p className="text-xs text-mc-text-secondary">No dispatch attempts have been recorded yet.</p>
        ) : (
          attempts.slice(0, 5).map((attempt) => (
            <div key={attempt.id} className="flex gap-3 rounded border border-mc-border/60 bg-mc-bg/70 p-3">
              <StatusIcon status={attempt.status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTone(attempt.status)}`}>
                    {attempt.status}
                  </span>
                  <span className="text-xs text-mc-text-secondary">
                    {attempt.adapter_name || attempt.runtime_type} · attempt {attempt.attempt_number}
                  </span>
                  {attempt.http_status && <span className="text-xs text-mc-text-secondary">HTTP {attempt.http_status}</span>}
                </div>
                <p className="mt-1 text-sm text-mc-text">{attempt.message}</p>
                {attempt.error_message && <p className="mt-1 text-xs text-rose-200">{attempt.error_message}</p>}
                {attempt.webhook_url && <p className="mt-1 truncate text-xs text-mc-text-secondary">{attempt.webhook_url}</p>}
                <p className="mt-1 text-[10px] text-mc-text-secondary" suppressHydrationWarning>
                  {new Date(attempt.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          ))
        )}
      </PanelBody>
    </Panel>
  );
}
