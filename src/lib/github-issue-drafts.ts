import type { Task } from './types';

export interface GitHubIssueDraft {
  owner?: string;
  repo?: string;
  title: string;
  body: string;
  labels: string[];
  warnings: string[];
}

function list(label: string, values?: string[]) {
  if (!values?.length) return `### ${label}\n\n- TODO`;
  return `### ${label}\n\n${values.map((value) => `- ${value}`).join('\n')}`;
}

export function buildGitHubIssueDraftFromTask(task: Task): GitHubIssueDraft {
  const metadata = task.dispatch_metadata;
  const repo = metadata?.target_repo || (task.github_source ? `${task.github_source.repo_owner}/${task.github_source.repo_name}` : undefined);
  const [owner, repoName] = repo?.includes('/') ? repo.split('/', 2) : [undefined, undefined];
  const warnings: string[] = [];
  if (!repo) warnings.push('No target repository is configured in dispatch metadata.');
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
    repo: repoName,
    title: task.title,
    body,
    labels: ['from:mck', `priority:${task.priority}`],
    warnings,
  };
}
