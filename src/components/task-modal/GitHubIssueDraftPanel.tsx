'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Github } from '@/components/icons/BrandIcons';
import { ActionReviewDialog } from '@/components/ui/action-review-dialog';

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
  const [showConfirm, setShowConfirm] = useState(false);
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

  // Runs inside ActionReviewDialog: it only unlocks confirm once the operator
  // has typed the server-issued phrase exactly, so the same phrase is what the
  // route re-checks. A thrown error keeps the dialog open with the failure.
  const applyLiveIssue = async () => {
    if (!taskId) return;
    setError(null);
    const response = await fetch(`/api/tasks/${taskId}/github-issue-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: false, confirmation_text: draftPayload?.expected_confirmation ?? '' }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'GitHub issue create/update failed');
    setApplyResult(payload);
    setDraftPayload(payload);
  };

  const draft = draftPayload?.draft;
  const expected = draftPayload?.expected_confirmation || '';
  const isUpdate = draftPayload?.action === 'update';
  const actionLabel = isUpdate ? 'Update GitHub issue' : 'Create GitHub issue';

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

      {draft && (
        <ActionReviewDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          title="Confirm live GitHub mutation"
          confirmLabel={actionLabel}
          pendingLabel={isUpdate ? 'Updating...' : 'Creating...'}
          description={`Risk: medium - this mutates GitHub-visible issue state in ${draft.owner}/${draft.repo}. Rollback: edit or close the issue, or revert the issue body in GitHub.`}
          typedConfirmation={{
            expectedValue: expected,
            inputLabel: 'Type the confirmation phrase',
            hint: expected ? `Required phrase: ${expected}` : 'The draft did not return a confirmation phrase; reload the draft first.',
          }}
          consequences={{
            immediateEffect: 'This review closes and the panel shows the resulting GitHub issue link.',
            confirmedEffect: isUpdate
              ? `MCK updates issue ${draft.owner}/${draft.repo}#${draft.issue_number} with the title, body, and labels shown in the draft above.`
              : `MCK creates a new issue in ${draft.owner}/${draft.repo} with the title, body, and labels shown in the draft above.`,
            resultLocation: `GitHub (${draft.owner}/${draft.repo}) and the "Applied to GitHub" line in this panel.`,
            willNotHappen: 'No code is pushed, no GitHub Project field is changed, and no other issue is created or closed.',
          }}
          onConfirm={applyLiveIssue}
        />
      )}
    </section>
  );
}
