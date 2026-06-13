import {
  normalizeDispatchMetadata,
  type DispatchMetadata,
  type DispatchReadiness,
  type DispatchReviewMode,
  type DispatchRiskLevel,
  validateDispatchMetadata,
} from './dispatch-contract';
import type {
  CreateTaskRequest,
  GitHubSourceIdentity,
  Task,
  TaskPriority,
  TaskStatus,
  UpdateTaskRequest,
} from './types';

type GitHubLabel = string | { name?: string | null };

interface GitHubIssuePayload {
  number?: number | null;
  title?: string | null;
  body?: string | null;
  html_url?: string | null;
  labels?: GitHubLabel[] | null;
}

interface GitHubRepositoryPayload {
  full_name?: string | null;
  name?: string | null;
  owner?: {
    login?: string | null;
  } | null;
}

export interface GitHubImportPreviewRequest {
  issue: GitHubIssuePayload;
  repository?: GitHubRepositoryPayload;
  project_fields?: Record<string, unknown>;
  workspace_id?: string;
  business_id?: string;
  status?: TaskStatus;
}

export interface GitHubImportPreviewTask extends CreateTaskRequest {
  status: TaskStatus;
  workspace_id: string;
  business_id: string;
  github_source?: GitHubSourceIdentity;
}

export interface GitHubImportPreviewResponse {
  source_identity?: GitHubSourceIdentity;
  preview: GitHubImportPreviewTask;
  blockers: string[];
  warnings: string[];
  dispatch_ready: boolean;
  dispatch_blockers: string[];
  existing_task?: Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'created_at' | 'updated_at'>;
}

const ISSUE_URL_REGEX = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/i;

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeLabel(label: GitHubLabel): string | undefined {
  return typeof label === 'string' ? normalizeString(label) : normalizeString(label?.name);
}

function normalizeListSection(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^(?:\s*[-*]\s*\[[ xX]\]\s*|\s*[-*]\s*|\s*\d+\.\s*)/, '').trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function normalizeListValue(value: unknown): string[] | undefined {
  const normalized = normalizeString(typeof value === 'number' ? String(value) : value);
  if (!normalized) {
    return undefined;
  }

  return normalized
    .split(/\r?\n|,|;/)
    .map((item) => item.replace(/^(?:\s*[-*]\s*\[[ xX]\]\s*|\s*[-*]\s*|\s*\d+\.\s*)/, '').trim())
    .filter(Boolean);
}

function normalizeScalarSection(value: string | undefined): string | undefined {
  const items = normalizeListSection(value);
  return items?.[0] ?? normalizeString(value);
}

function extractHeadingSection(body: string, headings: string[]): string | undefined {
  const lines = body.split(/\r?\n/);
  const normalizedHeadings = headings.map((heading) => heading.toLowerCase());
  let active = false;
  const buffer: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      const headingText = headingMatch[1].trim().toLowerCase();
      if (active) {
        break;
      }

      active = normalizedHeadings.some((heading) => headingText === heading || headingText.startsWith(`${heading} `));
      continue;
    }

    if (active) {
      buffer.push(line);
    }
  }

  const section = buffer.join('\n').trim();
  return section.length > 0 ? section : undefined;
}

function extractInlineField(body: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = body.match(pattern);
    const value = normalizeString(match?.[1]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function projectFieldValue(projectFields: Record<string, unknown> | undefined, fieldName: string): string | undefined {
  if (!projectFields) {
    return undefined;
  }

  const normalizedTarget = fieldName.trim().toLowerCase();
  const matchingKey = Object.keys(projectFields).find((key) => key.trim().toLowerCase() === normalizedTarget);
  if (!matchingKey) {
    return undefined;
  }

  const value = projectFields[matchingKey];
  return normalizeString(typeof value === 'number' ? String(value) : value);
}

function firstProjectFieldValue(
  projectFields: Record<string, unknown> | undefined,
  fieldNames: string[]
): string | undefined {
  for (const fieldName of fieldNames) {
    const value = projectFieldValue(projectFields, fieldName);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function mapPriority(value: string | undefined, labels: string[]): TaskPriority {
  const normalized = value?.trim().toLowerCase() ?? labels.find((label) => label.startsWith('priority:'))?.replace(/^priority:/, '').trim().toLowerCase();

  switch (normalized) {
    case 'low':
      return 'low';
    case 'high':
      return 'high';
    case 'urgent':
    case 'critical':
      return 'urgent';
    default:
      return 'normal';
  }
}

function mapReadiness(value: string | undefined): DispatchReadiness | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'raw':
      return 'raw';
    case 'needs grooming':
    case 'needs_grooming':
      return 'needs_grooming';
    case 'ready for agent':
    case 'ready_for_agent':
      return 'ready_for_agent';
    case 'needs human':
    case 'needs_human':
      return 'needs_human';
    default:
      return undefined;
  }
}

function mapReviewMode(value: string | undefined): DispatchReviewMode | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'human required':
    case 'human_required':
      return 'human_required';
    case 'auto checks only':
    case 'auto_checks_only':
      return 'auto_checks_only';
    case 'pair review':
    case 'pair_review':
      return 'pair_review';
    default:
      return undefined;
  }
}

function mapRisk(value: string | undefined): DispatchRiskLevel | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'critical':
      return 'critical';
    default:
      return undefined;
  }
}

function parseRepoFullName(fullName: string | undefined): { owner?: string; repo?: string } {
  if (!fullName) {
    return {};
  }

  const [owner, repo] = fullName.split('/');
  return {
    owner: normalizeString(owner),
    repo: normalizeString(repo),
  };
}

export function normalizeGitHubSourceIdentity(input: unknown): GitHubSourceIdentity | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const directOwner = normalizeString(candidate.repo_owner);
  const directRepo = normalizeString(candidate.repo_name);
  const issueUrl = normalizeString(candidate.issue_url);
  const parsedFromUrl = issueUrl ? parseGitHubIssueUrl(issueUrl) : undefined;

  const issueNumberValue = candidate.issue_number;
  const issueNumber = typeof issueNumberValue === 'number'
    ? issueNumberValue
    : typeof issueNumberValue === 'string' && issueNumberValue.trim().length > 0
      ? Number(issueNumberValue)
      : parsedFromUrl?.issue_number;

  const repoOwner = directOwner ?? parsedFromUrl?.repo_owner;
  const repoName = directRepo ?? parsedFromUrl?.repo_name;
  const projectItemId = normalizeString(candidate.project_item_id);

  if (!repoOwner || !repoName || !issueUrl || !issueNumber || Number.isNaN(issueNumber)) {
    return undefined;
  }

  return {
    repo_owner: repoOwner,
    repo_name: repoName,
    issue_number: issueNumber,
    issue_url: issueUrl,
    project_item_id: projectItemId,
  };
}

export function parseGitHubIssueUrl(issueUrl: string): GitHubSourceIdentity | undefined {
  const match = issueUrl.match(ISSUE_URL_REGEX);
  if (!match) {
    return undefined;
  }

  return {
    repo_owner: match[1],
    repo_name: match[2],
    issue_number: Number(match[3]),
    issue_url: issueUrl,
  };
}

export function deriveGitHubSourceIdentity(input: {
  github_source?: unknown;
  dispatch_metadata?: DispatchMetadata;
}): GitHubSourceIdentity | undefined {
  const explicit = normalizeGitHubSourceIdentity(input.github_source);
  if (explicit) {
    return explicit;
  }

  const issueUrl = normalizeDispatchMetadata(input.dispatch_metadata)?.source_issue_url;
  return issueUrl ? parseGitHubIssueUrl(issueUrl) : undefined;
}

export function buildGitHubImportPreview(input: GitHubImportPreviewRequest): GitHubImportPreviewTask {
  const labels = (input.issue.labels ?? [])
    .map(normalizeLabel)
    .filter((label): label is string => Boolean(label));
  const projectFields = input.project_fields;
  const repoFromFullName = parseRepoFullName(normalizeString(input.repository?.full_name));
  const repoOwner = normalizeString(input.repository?.owner?.login) ?? repoFromFullName.owner;
  const repoName = normalizeString(input.repository?.name) ?? repoFromFullName.repo;
  const issueUrl = normalizeString(input.issue.html_url);
  const issueNumber = input.issue.number ?? undefined;
  const issueBody = normalizeString(input.issue.body) ?? '';
  const targetRepo = firstProjectFieldValue(projectFields, ['Repo', 'Target Repo'])
    ?? extractInlineField(issueBody, [/^target repo\s*:\s*(.+)$/im, /^repo\s*:\s*(.+)$/im])
    ?? (repoOwner && repoName ? `${repoOwner}/${repoName}` : undefined);
  const bodyReadiness = normalizeScalarSection(
    extractHeadingSection(issueBody, ['Readiness', 'Dispatch Readiness'])
  ) ?? extractInlineField(issueBody, [/^readiness\s*:\s*(.+)$/im, /^dispatch readiness\s*:\s*(.+)$/im]);
  const bodyReviewMode = normalizeScalarSection(
    extractHeadingSection(issueBody, ['Review Mode', 'Review'])
  ) ?? extractInlineField(issueBody, [/^review mode\s*:\s*(.+)$/im, /^review\s*:\s*(.+)$/im]);
  const bodyRisk = normalizeScalarSection(
    extractHeadingSection(issueBody, ['Risk', 'Risk Level'])
  ) ?? extractInlineField(issueBody, [/^risk(?: level)?\s*:\s*(.+)$/im]);
  const readiness = mapReadiness(firstProjectFieldValue(projectFields, ['Readiness']))
    ?? mapReadiness(bodyReadiness)
    ?? mapReadiness(labels.find((label) => label.startsWith('readiness:'))?.replace(/^readiness:/, ''));
  const reviewMode = mapReviewMode(firstProjectFieldValue(projectFields, ['Review Mode', 'ReviewMode']))
    ?? mapReviewMode(bodyReviewMode);
  const riskLevel = mapRisk(firstProjectFieldValue(projectFields, ['Risk']))
    ?? mapRisk(bodyRisk)
    ?? mapRisk(labels.find((label) => label.startsWith('risk:'))?.replace(/^risk:/, ''));
  const projectWorkstream = firstProjectFieldValue(projectFields, ['Project', 'Project/Workstream'])
    ?? extractInlineField(issueBody, [/^project(?:\/workstream)?\s*:\s*(.+)$/im]);
  const impact = firstProjectFieldValue(projectFields, ['Impact'])
    ?? normalizeString(extractHeadingSection(issueBody, ['Impact', 'Expected Impact']))
    ?? extractInlineField(issueBody, [/^impact\s*:\s*(.+)$/im]);

  const dispatchMetadata = normalizeDispatchMetadata({
    source_issue_url: issueUrl,
    target_repo: targetRepo,
    project_workstream: projectWorkstream,
    allowed_file_scope: normalizeListSection(
      extractHeadingSection(issueBody, ['Allowed File Scope', 'Allowed Files', 'File Scope'])
    ) ?? normalizeListValue(firstProjectFieldValue(projectFields, ['Allowed File Scope', 'Allowed Files', 'File Scope', 'Scope'])),
    acceptance_criteria: normalizeListSection(
      extractHeadingSection(issueBody, ['Acceptance Criteria', 'Definition of Done', 'Success Criteria'])
    ) ?? normalizeListValue(firstProjectFieldValue(projectFields, ['Acceptance Criteria', 'Definition of Done', 'Success Criteria'])),
    test_requirements: normalizeListSection(
      extractHeadingSection(issueBody, ['Test Requirements', 'Validation', 'Verification'])
    ) ?? normalizeListValue(firstProjectFieldValue(projectFields, ['Test Requirements', 'Validation', 'Verification', 'Tests'])),
    risk_level: riskLevel,
    readiness,
    review_mode: reviewMode,
    impact,
    rollback_plan: extractHeadingSection(issueBody, ['Rollback', 'Rollback / Fallback Plan', 'Rollback / Fallback', 'Fallback Plan'])
      ?? firstProjectFieldValue(projectFields, ['Rollback / Fallback Plan', 'Rollback / Fallback', 'Rollback', 'Fallback Plan', 'Fallback']),
    safety_rules: normalizeListSection(
      extractHeadingSection(issueBody, ['Safety Rules', 'Guardrails'])
    ) ?? normalizeListValue(firstProjectFieldValue(projectFields, ['Safety Rules', 'Guardrails'])),
  });

  const githubSource = issueUrl && issueNumber && repoOwner && repoName
    ? normalizeGitHubSourceIdentity({
        repo_owner: repoOwner,
        repo_name: repoName,
        issue_number: issueNumber,
        issue_url: issueUrl,
        project_item_id: firstProjectFieldValue(projectFields, ['Project Item ID']),
      })
    : undefined;

  return {
    title: normalizeString(input.issue.title) ?? 'Untitled GitHub issue import',
    description: issueBody || undefined,
    priority: mapPriority(projectFieldValue(projectFields, 'Priority'), labels),
    status: input.status ?? 'inbox',
    workspace_id: input.workspace_id ?? 'default',
    business_id: input.business_id ?? 'default',
    dispatch_metadata: dispatchMetadata,
    github_source: githubSource,
  };
}

export function buildGitHubImportPreviewResponse(input: {
  request: GitHubImportPreviewRequest;
  existingTask?: Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'created_at' | 'updated_at'>;
}): GitHubImportPreviewResponse {
  const preview = buildGitHubImportPreview(input.request);
  const sourceIdentity = preview.github_source;
  const validation = validateDispatchMetadata(preview.dispatch_metadata);
  const blockers = [...validation.blockers];
  const warnings = [...validation.warnings];

  if (!sourceIdentity) {
    blockers.unshift('Missing GitHub source identity (repo owner/name, issue number, or issue URL)');
  }

  if (input.existingTask) {
    blockers.unshift(`GitHub issue already imported as task ${input.existingTask.id}`);
  }

  return {
    source_identity: sourceIdentity,
    preview,
    blockers,
    warnings,
    dispatch_ready: validation.canDispatch,
    dispatch_blockers: validation.blockers,
    existing_task: input.existingTask,
  };
}

export function buildTaskRefreshUpdateFromGitHubPreview(
  currentTask: Pick<Task, 'title' | 'description' | 'priority' | 'github_source' | 'dispatch_metadata'>,
  preview: GitHubImportPreviewTask
): UpdateTaskRequest {
  return {
    title: preview.title || currentTask.title,
    description: preview.description ?? currentTask.description,
    priority: preview.priority ?? currentTask.priority,
    github_source: preview.github_source ?? currentTask.github_source ?? null,
    dispatch_metadata: preview.dispatch_metadata ?? currentTask.dispatch_metadata,
  };
}
