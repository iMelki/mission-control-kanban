'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Github, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { buildTaskRefreshUpdateFromGitHubPreview, type GitHubImportPreviewTask } from '@/lib/github-task-import';
import type { GitHubWritebackLog, Task } from '@/lib/types';

interface GitHubWritebackPanelProps {
  task: Task;
  onTaskUpdated?: (task: Task) => void;
}

interface GitHubWritebackResponse {
  id: string;
  mode: 'dry_run' | 'apply';
  status: 'planned' | 'applied' | 'skipped' | 'failed';
  signature: string;
  issue_comment_body?: string | null;
  project_updates?: Array<{
    field_name: string;
    field_type?: 'single_select' | 'text';
    value: string;
    field_id?: string;
    option_id?: string;
    skipped?: boolean;
    reason?: string;
  }>;
  warnings?: string[];
  error_message?: string | null;
}

interface GitHubProjectItemOption {
  id: string;
  project_title: string;
  project_number?: number;
  project_fields: Record<string, unknown>;
}

interface GitHubLoadIssueResponse {
  issue: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    labels: Array<{ name: string }>;
  };
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
  project_items: GitHubProjectItemOption[];
  default_project_item_id?: string;
}

interface GitHubImportPreviewResponse {
  preview: GitHubImportPreviewTask;
}

function normalizeProjectUpdates(value: unknown): Array<{
  field_name: string;
  value: string;
  skipped?: boolean;
  reason?: string;
}> {
  if (Array.isArray(value)) {
    return value.filter((item): item is { field_name: string; value: string; skipped?: boolean; reason?: string } => {
      return Boolean(
        item &&
        typeof item === 'object' &&
        'field_name' in item &&
        'value' in item
      );
    });
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      return normalizeProjectUpdates(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return 'Unknown time';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function GitHubWritebackPanel({ task, onTaskUpdated }: GitHubWritebackPanelProps) {
  const [logs, setLogs] = useState<GitHubWritebackLog[]>([]);
  const [result, setResult] = useState<GitHubWritebackResponse | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isRunning, setIsRunning] = useState<'dry_run' | 'apply' | null>(null);
  const [isRefreshingTask, setIsRefreshingTask] = useState(false);
  const [showApplyConfirmation, setShowApplyConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoRef = task.github_source
    ? `${task.github_source.repo_owner}/${task.github_source.repo_name}#${task.github_source.issue_number}`
    : null;

  const latestLog = logs[0];
  const latestLogUpdates = useMemo(
    () => normalizeProjectUpdates(latestLog?.project_updates),
    [latestLog?.project_updates]
  );

  const loadLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    setError(null);

    try {
      const res = await fetch(`/api/tasks/${task.id}/github-writeback`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to load GitHub write-back logs');
      }

      setLogs(Array.isArray(payload) ? payload : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load GitHub write-back logs');
    } finally {
      setIsLoadingLogs(false);
    }
  }, [task.id]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const runWriteback = async (dryRun: boolean, options?: { bypassApplyConfirmation?: boolean }) => {
    if (!task.github_source) {
      return;
    }

    if (dryRun) {
      setShowApplyConfirmation(false);
    } else if (!options?.bypassApplyConfirmation) {
      setShowApplyConfirmation(true);
      return;
    }

    setShowApplyConfirmation(false);
    setIsRunning(dryRun ? 'dry_run' : 'apply');
    setError(null);

    try {
      const res = await fetch(`/api/tasks/${task.id}/github-writeback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'GitHub write-back failed');
      }

      setResult(payload as GitHubWritebackResponse);
      await loadLogs();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'GitHub write-back failed');
    } finally {
      setIsRunning(null);
    }
  };

  const refreshFromGitHub = async () => {
    if (!task.github_source?.issue_url) {
      return;
    }

    setShowApplyConfirmation(false);
    setIsRefreshingTask(true);
    setError(null);

    try {
      const loadRes = await fetch('/api/github/load-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_url: task.github_source.issue_url }),
      });
      const loadPayload = await loadRes.json();
      if (!loadRes.ok) {
        throw new Error(loadPayload.error || 'Failed to refresh task from GitHub');
      }

      const sourceData = loadPayload as GitHubLoadIssueResponse;
      const projectItemId = task.github_source.project_item_id
        ?? sourceData.default_project_item_id
        ?? sourceData.project_items[0]?.id;
      const selectedProjectItem = sourceData.project_items.find((item) => item.id === projectItemId)
        ?? sourceData.project_items[0];

      const previewRes = await fetch('/api/github/import-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue: sourceData.issue,
          repository: sourceData.repository,
          project_fields: selectedProjectItem?.project_fields,
          workspace_id: task.workspace_id,
          business_id: task.business_id,
        }),
      });
      const previewPayload = await previewRes.json();
      if (!previewRes.ok) {
        throw new Error(previewPayload.error || 'Failed to rebuild the GitHub import preview');
      }

      const patchPayload = buildTaskRefreshUpdateFromGitHubPreview(
        task,
        (previewPayload as GitHubImportPreviewResponse).preview
      );

      const saveRes = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchPayload),
      });
      const savedTask = await saveRes.json();
      if (!saveRes.ok) {
        throw new Error(savedTask.error || 'Failed to update the local task from GitHub');
      }

      onTaskUpdated?.(savedTask as Task);
      await loadLogs();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh task from GitHub');
    } finally {
      setIsRefreshingTask(false);
    }
  };

  if (!task.github_source || !repoRef) {
    return null;
  }

  return (
    <div className="rounded-lg border border-mc-border bg-mc-bg p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Github className="size-4 text-mc-accent-cyan" />
            <h3 className="text-sm font-semibold">GitHub Write-Back</h3>
          </div>
          <p className="text-xs text-mc-text-secondary">
            Dry run first, then apply only after the planned comment and field updates look correct.
            Save task edits before running write-back so GitHub receives the latest dispatch contract.
            Use Refresh From GitHub when the issue body or project fields changed upstream and the local task should be re-synced.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-mc-text-secondary">
            <a
              href={task.github_source.issue_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-mc-border/70 px-2 py-1 hover:text-mc-text"
            >
              {repoRef}
              <ExternalLink className="size-3" />
            </a>
            <span className="rounded border border-mc-border/70 px-2 py-1">
              Project item: {task.github_source.project_item_id ?? 'not linked'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshFromGitHub()}
            disabled={isRefreshingTask || isLoadingLogs || isRunning !== null}
            className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-secondary disabled:opacity-50"
          >
            {isRefreshingTask ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh From GitHub
          </button>
          <button
            type="button"
            onClick={() => void loadLogs()}
            disabled={isRefreshingTask || isLoadingLogs || isRunning !== null}
            className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-secondary disabled:opacity-50"
          >
            {isLoadingLogs ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh Logs
          </button>
          <button
            type="button"
            onClick={() => void runWriteback(true)}
            disabled={isRefreshingTask || isRunning !== null}
            className="inline-flex items-center gap-2 rounded bg-mc-accent-cyan px-3 py-2 text-sm font-medium text-mc-bg hover:bg-mc-accent-cyan/90 disabled:opacity-50"
          >
            {isRunning === 'dry_run' ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Dry Run
          </button>
          <button
            type="button"
            onClick={() => void runWriteback(false)}
            disabled={isRefreshingTask || isRunning !== null}
            className="inline-flex items-center gap-2 rounded bg-mc-accent px-3 py-2 text-sm font-medium text-mc-bg hover:bg-mc-accent/90 disabled:opacity-50"
          >
            {isRunning === 'apply' ? <Loader2 className="size-4 animate-spin" /> : <Github className="size-4" />}
            Apply
          </button>
        </div>
      </div>

      {showApplyConfirmation && (
        <div className="flex flex-col gap-3 rounded border border-amber-500/25 bg-amber-500/10 px-3 py-3 text-sm text-amber-50 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="font-medium">Apply GitHub write-back now?</p>
            <p className="text-xs text-amber-100/80">
              This will post the prepared comment to the linked issue and update the allowed GitHub Project fields.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowApplyConfirmation(false)}
              disabled={isRefreshingTask || isRunning !== null}
              className="rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-secondary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void runWriteback(false, { bypassApplyConfirmation: true })}
              disabled={isRefreshingTask || isRunning !== null}
              className="inline-flex items-center gap-2 rounded bg-amber-400 px-3 py-2 text-sm font-medium text-mc-bg hover:bg-amber-300 disabled:opacity-50"
            >
              <Github className="size-4" />
              Confirm apply
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <AlertTriangle className="size-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {task.dispatch_blockers && task.dispatch_blockers.length > 0 && (
        <div className="rounded border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          The task can still write back to GitHub while blocked, but the blocker list in the comment will stay noisy until the dispatch contract is completed.
        </div>
      )}

      {(result || latestLog) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
          <div className="rounded border border-mc-border/60 bg-mc-bg-secondary/60 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {result?.status === 'failed' || latestLog?.status === 'failed' ? (
                <AlertTriangle className="size-4 text-rose-300" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-300" />
              )}
              Latest prepared payload
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-mc-bg px-3 py-2 text-xs text-mc-text-secondary">
              {result?.issue_comment_body ?? latestLog?.issue_comment_body ?? 'No comment prepared yet.'}
            </pre>
          </div>

          <div className="rounded border border-mc-border/60 bg-mc-bg-secondary/60 p-3 space-y-3">
            <div className="text-sm font-medium">Project updates</div>
            {(result?.project_updates ?? latestLogUpdates).length > 0 ? (
              <div className="space-y-2">
                {(result?.project_updates ?? latestLogUpdates).map((update) => (
                  <div key={`${update.field_name}:${update.value}`} className="rounded border border-mc-border/50 bg-mc-bg px-3 py-2">
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary">{update.field_name}</div>
                    <div className="text-sm">{update.value}</div>
                    {update.skipped && (
                      <div className="mt-1 text-xs text-amber-200">{update.reason ?? 'Skipped'}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-mc-text-secondary">No project-field updates prepared yet.</p>
            )}
          </div>
        </div>
      )}

      {(result?.warnings?.length ?? 0) > 0 && (
        <div className="rounded border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <div className="text-sm font-medium text-amber-200">Warnings</div>
          <ul className="mt-2 space-y-1 text-xs text-amber-100">
            {result?.warnings?.map((warning) => (
              <li key={warning}>- {warning}</li>
            ))}
          </ul>
        </div>
      )}

      {latestLog && (
        <div className="rounded border border-mc-border/60 bg-mc-bg-secondary/60 p-3">
          <div className="text-sm font-medium">Recent write-back activity</div>
          <div className="mt-2 space-y-2 text-xs text-mc-text-secondary">
            {logs.slice(0, 5).map((log) => (
              <div key={log.id} className="rounded border border-mc-border/50 bg-mc-bg px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-mc-text">
                    {log.mode === 'dry_run' ? 'Dry run' : 'Apply'} · {log.status}
                  </span>
                  <span>{formatTimestamp(log.created_at)}</span>
                </div>
                {log.error_message && (
                  <div className="mt-1 text-rose-200">{log.error_message}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
