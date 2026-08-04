import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';
import { parseDispatchMetadata } from '@/lib/dispatch-contract';
import { normalizeGitHubSourceIdentity } from '@/lib/github-task-import';
import type { GitHubSourceIdentity, Task } from './types';

export interface GitHubIssueDraft {
  owner?: string;
  repo?: string;
  issue_number?: number;
  issue_url?: string;
  title: string;
  body: string;
  labels: string[];
  warnings: string[];
}

export interface GitHubIssueDraftPayload {
  dry_run: boolean;
  action: 'create' | 'update';
  expected_confirmation: string;
  draft: GitHubIssueDraft;
}

function list(label: string, values?: string[]) {
  if (!values?.length) return `### ${label}\n\n- TODO`;
  return `### ${label}\n\n${values.map((value) => `- ${value}`).join('\n')}`;
}

function getToken(env: Record<string, string | undefined> = process.env) {
  return env.GH_GENERAL_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN;
}

function repoParts(task: Task) {
  const metadata = task.dispatch_metadata;
  const repo = metadata?.target_repo || (task.github_source ? `${task.github_source.repo_owner}/${task.github_source.repo_name}` : undefined);
  const [owner, repoName] = repo?.includes('/') ? repo.split('/', 2) : [undefined, undefined];
  return { owner, repo: repoName };
}

export function buildGitHubIssueDraftFromTask(task: Task): GitHubIssueDraft {
  const metadata = task.dispatch_metadata;
  const { owner, repo } = repoParts(task);
  const warnings: string[] = [];
  if (!owner || !repo) warnings.push('No target repository is configured in dispatch metadata.');
  if (!metadata?.acceptance_criteria?.length) warnings.push('Acceptance criteria are missing.');
  if (!metadata?.test_requirements?.length) warnings.push('Test requirements are missing.');

  const body = [
    '## Goal',
    task.description || 'TODO: describe the work slice goal.',
    '',
    metadata?.project_workstream ? `**Workstream:** ${metadata.project_workstream}` : undefined,
    metadata?.source_issue_url ? `**Source:** ${metadata.source_issue_url}` : undefined,
    '',
    list('Allowed File Scope', metadata?.allowed_file_scope),
    '',
    list('Acceptance Criteria', metadata?.acceptance_criteria),
    '',
    list('Test Requirements', metadata?.test_requirements),
    '',
    list('Safety Rules', metadata?.safety_rules),
    '',
    '## Impact',
    metadata?.impact || 'TODO: document operator/user impact.',
    '',
    '## Rollback / Fallback Plan',
    metadata?.rollback_plan || 'TODO: document rollback/fallback.',
    '',
    '<!-- generated-by:mck-github-issue-draft -->',
  ].filter(Boolean).join('\n');

  return {
    owner,
    repo,
    issue_number: task.github_source?.issue_number,
    issue_url: task.github_source?.issue_url,
    title: task.title,
    body,
    labels: ['from:mck', `priority:${task.priority}`],
    warnings,
  };
}

export function buildGitHubIssueDraftPayload(task: Task): GitHubIssueDraftPayload {
  const draft = buildGitHubIssueDraftFromTask(task);
  const action = draft.issue_number ? 'update' : 'create';
  const repoRef = `${draft.owner || 'owner'}/${draft.repo || 'repo'}`;
  return {
    dry_run: true,
    action,
    expected_confirmation: action === 'update'
      ? `UPDATE GITHUB ISSUE ${repoRef}#${draft.issue_number}`
      : `CREATE GITHUB ISSUE IN ${repoRef}`,
    draft,
  };
}

export function loadTaskForIssueDraft(taskId: string): Task | undefined {
  const row = queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!row) return undefined;
  return {
    ...row,
    dispatch_metadata: parseDispatchMetadata(row.dispatch_metadata),
    github_source: normalizeGitHubSourceIdentity({
      repo_owner: row.source_repo_owner,
      repo_name: row.source_repo_name,
      issue_number: row.source_issue_number,
      issue_url: row.source_issue_url,
      project_item_id: row.source_project_item_id,
    }),
  } as unknown as Task;
}

async function githubIssueRequest<T>({ owner, repo, issueNumber, method, body }: { owner: string; repo: string; issueNumber?: number; method: 'POST' | 'PATCH'; body: Record<string, unknown> }): Promise<T> {
  const token = getToken();
  if (!token) throw new Error('Missing GH_GENERAL_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  const issuePath = issueNumber ? `/repos/${owner}/${repo}/issues/${issueNumber}` : `/repos/${owner}/${repo}/issues`;
  const response = await fetch(`https://api.github.com${issuePath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'mission-control-kanban',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.message === 'string' ? payload.message : response.statusText;
    throw new Error(`GitHub issue request failed: ${message}`);
  }
  return payload as T;
}

export async function applyGitHubIssueDraft({ task, confirmationText }: { task: Task; confirmationText: string }) {
  const plan = buildGitHubIssueDraftPayload(task);
  if (confirmationText !== plan.expected_confirmation) {
    const error = new Error(`Confirmation mismatch. Type exactly: ${plan.expected_confirmation}`);
    error.name = 'ConfirmationError';
    throw error;
  }
  const { draft } = plan;
  if (!draft.owner || !draft.repo) throw new Error('Target repository is missing.');
  if (draft.warnings.some((warning) => warning.includes('target repository'))) throw new Error('Target repository is missing.');

  const issue = await githubIssueRequest<{ number: number; title: string; html_url: string }>({
    owner: draft.owner,
    repo: draft.repo,
    issueNumber: draft.issue_number,
    method: draft.issue_number ? 'PATCH' : 'POST',
    body: {
      title: draft.title,
      body: draft.body,
      labels: draft.labels,
    },
  });

  if (!task.github_source && issue.number) {
    run(
      `UPDATE tasks
       SET source_repo_owner = ?, source_repo_name = ?, source_issue_number = ?, source_issue_url = ?, updated_at = ?
       WHERE id = ?`,
      [draft.owner, draft.repo, issue.number, issue.html_url, new Date().toISOString(), task.id]
    );
  }
  run(
    `INSERT INTO events (id, type, task_id, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), 'system', task.id, `${plan.action === 'update' ? 'Updated' : 'Created'} GitHub issue ${draft.owner}/${draft.repo}#${issue.number}`, JSON.stringify({ issue }), new Date().toISOString()]
  );

  return {
    ...plan,
    dry_run: false,
    applied: true,
    issue,
    draft: { ...draft, issue_number: issue.number, issue_url: issue.html_url },
  };
}
