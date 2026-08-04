'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Github, Loader2, X } from 'lucide-react';
import { useMissionControl } from '@/lib/store';

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
  project_read_available?: boolean;
  project_error?: string;
}

interface GitHubImportPreviewResponse {
  source_identity?: {
    repo_owner: string;
    repo_name: string;
    issue_number: number;
    issue_url: string;
    project_item_id?: string;
  };
  preview: Record<string, unknown>;
  blockers: string[];
  warnings: string[];
  dispatch_ready: boolean;
  dispatch_blockers: string[];
  existing_task?: {
    id: string;
    title: string;
    status: string;
  };
}

interface GitHubImportModalProps {
  onClose: () => void;
  workspaceId?: string;
}

function DispatchList({ values }: { values: string[] | undefined }) {
  if (!values || values.length === 0) {
    return <span className="text-mc-text-secondary">Not provided</span>;
  }

  return (
    <ul className="space-y-1">
      {values.map((value) => (
        <li key={value} className="text-sm text-mc-text-secondary">
          - {value}
        </li>
      ))}
    </ul>
  );
}

export function GitHubImportModal({ onClose, workspaceId }: GitHubImportModalProps) {
  const { addTask, addEvent } = useMissionControl();
  const [issueUrl, setIssueUrl] = useState('');
  const [sourceData, setSourceData] = useState<GitHubLoadIssueResponse | null>(null);
  const [selectedProjectItemId, setSelectedProjectItemId] = useState('');
  const [preview, setPreview] = useState<GitHubImportPreviewResponse | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProjectItem = useMemo(
    () => sourceData?.project_items.find((item) => item.id === selectedProjectItemId),
    [selectedProjectItemId, sourceData]
  );

  const loadPreview = useCallback(async (data: GitHubLoadIssueResponse, projectItemId: string | undefined) => {
    setIsLoadingPreview(true);
    setError(null);

    try {
      const selected = data.project_items.find((item) => item.id === projectItemId);
      const projectFields = selected?.project_fields;
      const res = await fetch('/api/github/import-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue: data.issue,
          repository: data.repository,
          project_fields: projectFields,
          workspace_id: workspaceId || 'default',
          business_id: 'default',
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to build import preview');
      }

      setPreview(payload);
    } catch (previewError) {
      setPreview(null);
      setError(previewError instanceof Error ? previewError.message : 'Failed to build import preview');
    } finally {
      setIsLoadingPreview(false);
    }
  }, [workspaceId]);

  const handleLoadIssue = async () => {
    if (!issueUrl.trim()) {
      setError('Paste a GitHub issue URL first');
      return;
    }

    setIsLoadingSource(true);
    setPreview(null);
    setSourceData(null);
    setError(null);

    try {
      const res = await fetch('/api/github/load-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_url: issueUrl.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to load GitHub issue');
      }

      setSourceData(payload);
      const defaultProjectItemId = payload.default_project_item_id || payload.project_items[0]?.id || '';
      setSelectedProjectItemId(defaultProjectItemId);
      await loadPreview(payload, defaultProjectItemId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load GitHub issue');
    } finally {
      setIsLoadingSource(false);
    }
  };

  useEffect(() => {
    if (!sourceData) {
      return;
    }

    const timer = setTimeout(() => {
      void loadPreview(sourceData, selectedProjectItemId);
    }, 150);

    return () => clearTimeout(timer);
  }, [loadPreview, selectedProjectItemId, sourceData]);

  const handleCreateTask = async () => {
    if (!preview?.preview || preview.existing_task) {
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const payload = {
        ...(preview.preview as Record<string, unknown>),
        workspace_id: workspaceId || 'default',
        business_id: 'default',
      };

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const created = await res.json();
      if (!res.ok) {
        throw new Error(created.error || 'Failed to create local task');
      }

      addTask(created);
      addEvent({
        id: crypto.randomUUID(),
        type: 'task_created',
        task_id: created.id,
        message: `Imported GitHub issue as local task: ${created.title}`,
        created_at: new Date().toISOString(),
      });
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create local task');
    } finally {
      setIsCreating(false);
    }
  };

  const previewTask = preview?.preview as {
    title?: string;
    description?: string;
    github_source?: { issue_url?: string };
    dispatch_metadata?: {
      target_repo?: string;
      project_workstream?: string;
      allowed_file_scope?: string[];
      acceptance_criteria?: string[];
      test_requirements?: string[];
      rollback_plan?: string;
      readiness?: string;
      review_mode?: string;
      risk_level?: string;
      impact?: string;
    };
  } | null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-mc-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-mc-accent-cyan/15">
              <Github className="size-5 text-mc-accent-cyan" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Import GitHub Issue</h2>
              <p className="text-sm text-mc-text-secondary">
                Paste an issue URL, load its GitHub Project context, inspect the preview, then create the local MCK task.
              </p>
            </div>
          </div>
          <button
              type="button" onClick={onClose} className="p-1 hover:bg-mc-bg-tertiary rounded">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-4 border-b border-mc-border bg-mc-bg/40">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              type="url"
              value={issueUrl}
              onChange={(event) => setIssueUrl(event.target.value)}
              placeholder="https://github.com/iMelki/projects-ops/issues/6"
              className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
            />
            <button
              type="button"
              onClick={handleLoadIssue}
              disabled={isLoadingSource}
              className="px-4 py-2 bg-mc-accent-cyan text-mc-bg rounded text-sm font-medium hover:bg-mc-accent-cyan/90 disabled:opacity-50"
            >
              {isLoadingSource ? 'Loading GitHub...' : 'Load from GitHub'}
            </button>
          </div>
          <div className="mt-3 text-xs text-mc-text-secondary space-y-1">
            <div>1. Paste an issue URL.</div>
            <div>2. MCK reads the issue and any linked GitHub Project item.</div>
            <div>3. Review the preview and blockers before creating the local task.</div>
          </div>
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              <AlertTriangle className="size-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {sourceData && (
            <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-mc-text-secondary">{sourceData.repository.full_name}#{sourceData.issue.number}</p>
                  <h3 className="font-medium">{sourceData.issue.title}</h3>
                </div>
                {sourceData.project_items.length > 0 && (
                  <div className="min-w-[260px]">
                    <label htmlFor="github-project-item" className="block text-xs font-medium mb-1">GitHub Project Item</label>
                    <select
                      id="github-project-item"
                      value={selectedProjectItemId}
                      onChange={(event) => setSelectedProjectItemId(event.target.value)}
                      className="w-full bg-mc-bg-secondary border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    >
                      {sourceData.project_items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.project_title}{item.project_number ? ` (#${item.project_number})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {sourceData.project_items.length === 0 && (
                <p className="mt-3 text-sm text-mc-text-secondary">
                  This issue is not currently linked to a GitHub Project item. MCK can still import it, but project-field sync will be skipped.
                </p>
              )}
              {sourceData.project_read_available === false && (
                <div className="mt-3 flex items-start gap-2 rounded border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 size-4" />
                  <div>
                    <div className="font-medium">GitHub Project fields unavailable</div>
                    <p className="mt-1 text-xs">{sourceData.project_error || 'Check read:project scope before relying on Project-backed sync.'}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedProjectItem && (
            <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
              <h3 className="font-medium mb-2">Selected GitHub Project Fields</h3>
              <div className="grid gap-2 md:grid-cols-2">
                {Object.entries(selectedProjectItem.project_fields).map(([key, value]) => (
                  <div key={key} className="rounded border border-mc-border/60 bg-mc-bg-secondary px-3 py-2">
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary">{key}</div>
                    <div className="text-sm">{String(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isLoadingPreview && (
            <div className="flex items-center gap-2 text-sm text-mc-text-secondary">
              <Loader2 className="size-4 animate-spin" />
              Building import preview...
            </div>
          )}

          {preview && previewTask && (
            <div className="space-y-4">
              <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                <div className="flex items-center gap-2 mb-3">
                  {preview.dispatch_ready ? (
                    <CheckCircle2 className="size-4 text-emerald-300" />
                  ) : (
                    <AlertTriangle className="size-4 text-amber-300" />
                  )}
                  <h3 className="font-medium">Import Preview</h3>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Local task title</div>
                    <div className="text-sm mt-1">{previewTask.title}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Target repo</div>
                    <div className="text-sm mt-1">{previewTask.dispatch_metadata?.target_repo || 'Not provided'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Project / workstream</div>
                    <div className="text-sm mt-1">{previewTask.dispatch_metadata?.project_workstream || 'Not provided'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Readiness / review / risk</div>
                    <div className="text-sm mt-1">
                      {previewTask.dispatch_metadata?.readiness || 'n/a'} / {previewTask.dispatch_metadata?.review_mode || 'n/a'} / {previewTask.dispatch_metadata?.risk_level || 'n/a'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                  <h4 className="font-medium mb-2">Allowed File Scope</h4>
                  <DispatchList values={previewTask.dispatch_metadata?.allowed_file_scope} />
                </div>
                <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                  <h4 className="font-medium mb-2">Acceptance Criteria</h4>
                  <DispatchList values={previewTask.dispatch_metadata?.acceptance_criteria} />
                </div>
                <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                  <h4 className="font-medium mb-2">Test Requirements</h4>
                  <DispatchList values={previewTask.dispatch_metadata?.test_requirements} />
                </div>
              </div>

              <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                <h4 className="font-medium mb-2">Rollback / Fallback Plan</h4>
                <p className="text-sm text-mc-text-secondary">
                  {previewTask.dispatch_metadata?.rollback_plan || 'Not provided'}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                  <h4 className="font-medium mb-2">Import Blockers</h4>
                  {preview.blockers.length > 0 ? <DispatchList values={preview.blockers} /> : <span className="text-emerald-300 text-sm">No import blockers.</span>}
                </div>
                <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                  <h4 className="font-medium mb-2">Dispatch Blockers</h4>
                  {preview.dispatch_blockers.length > 0 ? <DispatchList values={preview.dispatch_blockers} /> : <span className="text-emerald-300 text-sm">Dispatch contract is ready.</span>}
                </div>
              </div>

              {preview.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                  <h4 className="font-medium mb-2 text-amber-200">Warnings</h4>
                  <DispatchList values={preview.warnings} />
                </div>
              )}

              {preview.existing_task && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                  This issue is already imported as task <strong>{preview.existing_task.id}</strong> ({preview.existing_task.title}).
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-mc-border">
          <div className="text-xs text-mc-text-secondary">
            GitHub remains the source of truth. MCK stores a linked local task plus the project item ID for future write-back.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={onClose} className="px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateTask}
              disabled={isCreating || !preview || Boolean(preview.existing_task)}
              className="px-4 py-2 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {isCreating ? 'Creating...' : 'Create Local Task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
