'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Github, Loader2 } from 'lucide-react';

interface GitHubIssueDraftResponse {
  dry_run: boolean;
  action?: 'create' | 'update';
  expected_confirmation?: string;
  draft?: {
    owner?: string;
    repo?: string;
    issue_number?: number;
    issue_url?: string;
    title: string;
    body: string;
    labels: string[];
    warnings: string[];
  };
  error?: string;
}

interface GitHubIssueApplyResponse extends GitHubIssueDraftResponse {
  applied?: boolean;
  issue?: {
    number: number;
    title: string;
    html_url: string;
  };
}

export function GitHubIssueDraftPanel({ taskId, fallbackTitle }: { taskId?: string; fallbackTitle: string }) {
  const [draftPayload, setDraftPayload] = useState<GitHubIssueDraftResponse | null>(null);
  const [applyResult, setApplyResult] = useState<GitHubIssueApplyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadDraft = async () => {
    if (!taskId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/github-issue-draft`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to load GitHub issue draft');
      setDraftPayload(payload);
      setApplyResult(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load GitHub issue draft');
    } finally {
      setIsLoading(false);
    }
  };

  const copyGitHubIssueBody = async () => {
    const draft = draftPayload?.draft;
    if (!draft) return;
    await navigator.clipboard.writeText(`# ${draft.title || fallbackTitle}\n\n${draft.body || ''}`);
  };

  const applyLiveIssue = async () => {
    if (!taskId) return;
    setIsApplying(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/github-issue-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false, confirmation_text: confirmationText }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'GitHub issue create/update failed');
      setApplyResult(payload);
      setShowConfirm(false);
      setConfirmationText('');
      setDraftPayload(payload);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'GitHub issue create/update failed');
    } finally {
      setIsApplying(false);
    }
  };

  const draft = draftPayload?.draft;
  const expected = draftPayload?.expected_confirmation || '';
  const readyToApply = Boolean(draft && expected && confirmationText === expected);
  const actionLabel = draftPayload?.action === 'update' ? 'Update GitHub issue' : 'Create GitHub issue';

  return (
    <section className="rounded border border-mc-border bg-mc-bg-secondary p-3 text-sm" aria-label="GitHub issue draft panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Github className="size-4 text-mc-accent" />GitHub issue draft</h3>
          <p className="mt-1 text-xs text-mc-text-secondary">Generate create/update text first. Live GitHub mutation requires an exact plain-English confirmation phrase.</p>
        </div>
        <button type="button" onClick={() => void loadDraft()} disabled={!taskId || isLoading} className="rounded border border-mc-border px-3 py-1.5 text-xs hover:bg-mc-bg-tertiary disabled:opacity-50">
          {isLoading ? 'Loading…' : 'Load draft'}
        </button>
      </div>

      {error && <div className="mt-3 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</div>}

      {draft && (
        <details open className="mt-3 rounded border border-mc-border bg-mc-bg p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-mc-text">GitHub issue create/update draft</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div><span className="text-mc-text-secondary">Target:</span> {draft.owner}/{draft.repo}{draft.issue_number ? `#${draft.issue_number}` : ''}</div>
            <div><span className="text-mc-text-secondary">Action:</span> {draftPayload.action || 'create'}</div>
          </div>
          {draft.warnings?.length > 0 && (
            <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-100">
              <AlertTriangle className="mr-1 inline size-3" /> {draft.warnings.join('; ')}
            </div>
          )}
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-mc-bg-secondary p-3">{JSON.stringify(draftPayload, null, 2)}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyGitHubIssueBody()} className="rounded border border-mc-border px-2 py-1 hover:bg-mc-bg-tertiary">Copy issue title/body</button>
            <button type="button" onClick={() => setShowConfirm(true)} className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-amber-100 hover:bg-amber-500/20">{actionLabel}</button>
          </div>
        </details>
      )}

      {applyResult?.applied && (
        <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          <CheckCircle2 className="mr-1 inline size-3" /> Applied to GitHub: <a className="underline" href={applyResult.issue?.html_url} target="_blank" rel="noreferrer">#{applyResult.issue?.number}</a>
        </div>
      )}

      {showConfirm && draft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg border border-mc-border bg-mc-bg-secondary p-4 shadow-xl">
            <h4 className="text-base font-semibold">Confirm live GitHub mutation</h4>
            <div className="mt-3 space-y-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-50">
              <p><strong>Plain English:</strong> This will {draftPayload.action === 'update' ? 'update an existing GitHub issue' : 'create a new GitHub issue'} in <strong>{draft.owner}/{draft.repo}</strong>.</p>
              <p><strong>Risk:</strong> Medium — this mutates GitHub-visible issue state. It does not push code or change Project fields.</p>
              <p><strong>Rollback:</strong> edit/close the created issue or revert the issue body in GitHub.</p>
              <p><strong>Required phrase:</strong></p>
              <code className="block break-words rounded bg-mc-bg px-2 py-1 text-xs text-mc-text">{expected}</code>
            </div>
            <label className="mt-3 block text-xs font-medium text-mc-text-secondary" htmlFor="github-issue-confirmation">Type confirmation phrase</label>
            <input id="github-issue-confirmation" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} className="mt-1 w-full rounded border border-mc-border bg-mc-bg px-3 py-2 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowConfirm(false)} className="rounded px-3 py-2 text-sm text-mc-text-secondary hover:text-mc-text">Cancel</button>
              <button type="button" onClick={() => void applyLiveIssue()} disabled={!readyToApply || isApplying} className="inline-flex items-center gap-2 rounded bg-amber-400 px-3 py-2 text-sm font-medium text-mc-bg disabled:opacity-50">
                {isApplying && <Loader2 className="size-4 animate-spin" />} {actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
