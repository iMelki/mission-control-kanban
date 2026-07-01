import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promisify } from 'util';
import {
  READINESS_LABELS,
  REVIEW_MODE_LABELS,
  type DispatchMetadata,
} from './dispatch-contract';
import type {
  GitHubSourceIdentity,
  GitHubWritebackMode,
  GitHubWritebackStatus,
  TaskStatus,
} from './types';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_GRAPHQL_URL = `${GITHUB_API_BASE}/graphql`;
const execFileAsync = promisify(execFile);

const ALLOWED_PROJECT_FIELDS = ['status', 'agent', 'readiness', 'reviewmode'] as const;

const STATUS_LABELS: Record<TaskStatus, string> = {
  planning: 'Planning',
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  testing: 'Testing',
  review: 'Review',
  done: 'Done',
};

export interface GitHubWritebackTaskSnapshot {
  id: string;
  title: string;
  status: TaskStatus;
  github_source: GitHubSourceIdentity;
  assigned_agent_name?: string | null;
  dispatch_metadata?: DispatchMetadata;
  dispatch_blockers?: string[];
}

export interface GitHubWritebackProjectUpdate {
  field_name: string;
  field_type?: 'single_select' | 'text';
  value: string;
  field_id?: string;
  option_id?: string;
  skipped?: boolean;
  reason?: string;
}

export interface GitHubWritebackPlan {
  signature: string;
  issue_comment_body: string;
  project_updates: GitHubWritebackProjectUpdate[];
  warnings: string[];
}

interface ProjectFieldNode {
  __typename: string;
  id?: string;
  name?: string;
  dataType?: string;
  options?: Array<{ id: string; name: string }>;
}

interface ProjectFieldResolution {
  project_id?: string;
  item_id?: string;
  fields: ProjectFieldNode[];
}

export interface GitHubWritebackApplyResult {
  comment_posted: boolean;
  project_updates: GitHubWritebackProjectUpdate[];
  warnings: string[];
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getGitHubToken(): string | undefined {
  return normalizeString(process.env.GH_GENERAL_TOKEN) ?? normalizeString(process.env.GITHUB_TOKEN);
}

function buildGitHubCliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const token = getGitHubToken();

  if (token) {
    env.GH_TOKEN ??= token;
    env.GITHUB_TOKEN ??= token;
  }

  return env;
}

function formatTransportError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'unknown error';
}

function buildGitHubCliPath(url: string): string {
  const relativePath = url.startsWith(GITHUB_API_BASE) ? url.slice(GITHUB_API_BASE.length) : url;
  return relativePath.replace(/^\/+/, '');
}

async function githubGraphQLViaCli<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`];

  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined || value === null) {
      continue;
    }

    args.push('-f', `${key}=${String(value)}`);
  }

  const { stdout } = await execFileAsync('gh', args, {
    env: buildGitHubCliEnv(),
    maxBuffer: 10 * 1024 * 1024,
  });

  const payload = JSON.parse(stdout) as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) {
    const errorMessage = payload.errors.flatMap((error) => error.message ? [error.message] : []).join('; ');
    throw new Error(errorMessage || 'GitHub GraphQL CLI request failed');
  }

  if (!payload.data) {
    throw new Error('GitHub GraphQL CLI response did not include data');
  }

  return payload.data;
}

async function githubRestViaCli<T>(url: string, init: RequestInit): Promise<T> {
  const args = ['api', buildGitHubCliPath(url)];
  const method = normalizeString(init.method)?.toUpperCase() ?? 'GET';

  if (method !== 'GET') {
    args.push('-X', method);
  }

  if (init.body !== undefined) {
    if (typeof init.body !== 'string') {
      throw new Error('GitHub CLI fallback only supports stringified JSON bodies');
    }

    const parsedBody = JSON.parse(init.body) as Record<string, unknown>;
    if (!parsedBody || Array.isArray(parsedBody) || typeof parsedBody !== 'object') {
      throw new Error('GitHub CLI fallback only supports JSON object bodies');
    }

    for (const [key, value] of Object.entries(parsedBody)) {
      if (value === undefined || value === null) {
        continue;
      }

      args.push('-f', `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  }

  const { stdout } = await execFileAsync('gh', args, {
    env: buildGitHubCliEnv(),
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!stdout.trim()) {
    return undefined as T;
  }

  return JSON.parse(stdout) as T;
}

function formatBlockers(blockers: string[] | undefined): string {
  if (!blockers || blockers.length === 0) {
    return 'None';
  }

  return blockers.join('; ');
}

function buildCommentBody(task: GitHubWritebackTaskSnapshot): string {
  const status = STATUS_LABELS[task.status];
  const readiness = task.dispatch_metadata?.readiness
    ? READINESS_LABELS[task.dispatch_metadata.readiness]
    : 'Unspecified';
  const reviewMode = task.dispatch_metadata?.review_mode
    ? REVIEW_MODE_LABELS[task.dispatch_metadata.review_mode]
    : 'Unspecified';
  const agent = normalizeString(task.assigned_agent_name) ?? 'Unassigned';
  const blockers = formatBlockers(task.dispatch_blockers);

  return [
    'Mission Control Kanban write-back',
    '',
    `- Status: ${status}`,
    `- Agent: ${agent}`,
    `- Readiness: ${readiness}`,
    `- Review Mode: ${reviewMode}`,
    `- Blockers: ${blockers}`,
  ].join('\n');
}

function buildDesiredProjectUpdates(task: GitHubWritebackTaskSnapshot): GitHubWritebackProjectUpdate[] {
  const updates: GitHubWritebackProjectUpdate[] = [
    { field_name: 'Status', value: STATUS_LABELS[task.status] },
    { field_name: 'Agent', value: normalizeString(task.assigned_agent_name) ?? 'Human' },
  ];

  if (task.dispatch_metadata?.readiness) {
    updates.push({
      field_name: 'Readiness',
      value: READINESS_LABELS[task.dispatch_metadata.readiness],
    });
  }

  if (task.dispatch_metadata?.review_mode) {
    updates.push({
      field_name: 'Review Mode',
      value: REVIEW_MODE_LABELS[task.dispatch_metadata.review_mode],
    });
  }

  return updates;
}

function createSignature(task: GitHubWritebackTaskSnapshot, commentBody: string, updates: GitHubWritebackProjectUpdate[]): string {
  return createHash('sha256')
    .update(JSON.stringify({
      issue: task.github_source.issue_url,
      status: task.status,
      agent: normalizeString(task.assigned_agent_name) ?? null,
      readiness: task.dispatch_metadata?.readiness ?? null,
      review_mode: task.dispatch_metadata?.review_mode ?? null,
      blockers: task.dispatch_blockers ?? [],
      commentBody,
      updates,
    }))
    .digest('hex');
}

async function githubGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error('Missing GH_GENERAL_TOKEN or GITHUB_TOKEN');
  }

  try {
    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'mission-control-kanban',
      },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    });

    const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };

    if (!response.ok || payload.errors?.length) {
      const errorMessage = payload.errors?.flatMap((error) => error.message ? [error.message] : []).join('; ') || response.statusText;
      throw new Error(errorMessage || 'GitHub GraphQL request failed');
    }

    if (!payload.data) {
      throw new Error('GitHub GraphQL response did not include data');
    }

    return payload.data;
  } catch (fetchError) {
    console.warn(`[GitHub] GraphQL fetch failed, falling back to gh api: ${formatTransportError(fetchError)}`);

    try {
      return await githubGraphQLViaCli<T>(query, variables);
    } catch (cliError) {
      throw new Error(
        `GitHub GraphQL request failed via fetch (${formatTransportError(fetchError)}) and gh api (${formatTransportError(cliError)})`
      );
    }
  }
}

async function githubRest<T>(url: string, init: RequestInit): Promise<T> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error('Missing GH_GENERAL_TOKEN or GITHUB_TOKEN');
  }

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mission-control-kanban',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return await response.json() as T;
  } catch (fetchError) {
    console.warn(`[GitHub] REST fetch failed, falling back to gh api: ${formatTransportError(fetchError)}`);

    try {
      return await githubRestViaCli<T>(url, init);
    } catch (cliError) {
      throw new Error(
        `GitHub REST request failed via fetch (${formatTransportError(fetchError)}) and gh api (${formatTransportError(cliError)})`
      );
    }
  }
}

async function resolveProjectFields(githubSource: GitHubSourceIdentity): Promise<ProjectFieldResolution | undefined> {
  if (!githubSource.project_item_id) {
    return undefined;
  }

  const data = await githubGraphQL<{
    node?: {
      id?: string;
      project?: {
        id?: string;
        fields?: {
          nodes?: ProjectFieldNode[];
        };
      };
    };
  }>(
    `
      query ResolveProjectItem($itemId: ID!) {
        node(id: $itemId) {
          ... on ProjectV2Item {
            id
            project {
              id
              fields(first: 50) {
                nodes {
                  __typename
                  ... on ProjectV2FieldCommon {
                    id
                    name
                    dataType
                  }
                  ... on ProjectV2SingleSelectField {
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    { itemId: githubSource.project_item_id }
  );

  return {
    project_id: data.node?.project?.id,
    item_id: data.node?.id,
    fields: data.node?.project?.fields?.nodes ?? [],
  };
}

function matchProjectField(
  fields: ProjectFieldNode[],
  desired: GitHubWritebackProjectUpdate
): GitHubWritebackProjectUpdate {
  const targetName = normalizeFieldName(desired.field_name);
  if (!ALLOWED_PROJECT_FIELDS.includes(targetName as (typeof ALLOWED_PROJECT_FIELDS)[number])) {
    return {
      ...desired,
      skipped: true,
      reason: 'Field is outside the allowed write-back allowlist',
    };
  }

  const field = fields.find((candidate) => normalizeFieldName(candidate.name ?? '') === targetName);
  if (!field?.id || !field.name) {
    return {
      ...desired,
      skipped: true,
      reason: 'Matching GitHub Project field was not found on the linked project item',
    };
  }

  const dataType = normalizeString(field.dataType)?.toLowerCase();
  if (dataType === 'single_select') {
    const option = field.options?.find((candidate) => candidate.name.trim().toLowerCase() === desired.value.trim().toLowerCase());
    if (!option) {
      return {
        ...desired,
        skipped: true,
        reason: `No single-select option matched "${desired.value}"`,
      };
    }

    return {
      ...desired,
      field_id: field.id,
      field_type: 'single_select',
      option_id: option.id,
    };
  }

  if (dataType === 'text') {
    return {
      ...desired,
      field_id: field.id,
      field_type: 'text',
    };
  }

  return {
    ...desired,
    skipped: true,
    reason: `Unsupported GitHub Project field type "${field.dataType ?? 'unknown'}"`,
  };
}

export async function planGitHubWriteback(task: GitHubWritebackTaskSnapshot): Promise<GitHubWritebackPlan> {
  const issueCommentBody = buildCommentBody(task);
  const desiredUpdates = buildDesiredProjectUpdates(task);
  const warnings: string[] = [];

  if (!getGitHubToken()) {
    warnings.push('Missing GH_GENERAL_TOKEN or GITHUB_TOKEN; apply mode will not be available');
  }

  let projectUpdates = desiredUpdates;
  if (task.github_source.project_item_id && getGitHubToken()) {
    try {
      const resolution = await resolveProjectFields(task.github_source);
      if (resolution?.fields?.length) {
        projectUpdates = desiredUpdates.map((update) => matchProjectField(resolution.fields, update));
      }
    } catch (error) {
      warnings.push(`Failed to resolve GitHub Project fields: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  } else if (!task.github_source.project_item_id) {
    warnings.push('No GitHub Project item ID is linked to this task; project field updates will be skipped');
  }

  return {
    signature: createSignature(task, issueCommentBody, projectUpdates),
    issue_comment_body: issueCommentBody,
    project_updates: projectUpdates,
    warnings,
  };
}

export async function applyGitHubWriteback(
  task: GitHubWritebackTaskSnapshot,
  plan: GitHubWritebackPlan
): Promise<GitHubWritebackApplyResult> {
  const warnings = [...plan.warnings];

  await githubRest(
    `${GITHUB_API_BASE}/repos/${task.github_source.repo_owner}/${task.github_source.repo_name}/issues/${task.github_source.issue_number}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body: plan.issue_comment_body }),
    }
  );

  let appliedUpdates = plan.project_updates;
  const applicableUpdates = plan.project_updates.filter((update) => !update.skipped && update.field_id);
  if (applicableUpdates.length > 0 && task.github_source.project_item_id) {
    const resolution = await resolveProjectFields(task.github_source);
    if (!resolution?.project_id || !resolution?.item_id) {
      warnings.push('Linked GitHub Project item could not be resolved at apply time; project field updates were skipped');
      appliedUpdates = plan.project_updates.map((update) => ({
        ...update,
        skipped: true,
        reason: update.reason ?? 'Linked GitHub Project item could not be resolved at apply time',
      }));
    } else {
      await Promise.all(applicableUpdates.map((update) => {
        if (update.field_type === 'single_select' && update.option_id) {
          return githubGraphQL(
            `
              mutation UpdateProjectField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
                updateProjectV2ItemFieldValue(
                  input: {
                    projectId: $projectId
                    itemId: $itemId
                    fieldId: $fieldId
                    value: { singleSelectOptionId: $optionId }
                  }
                ) {
                  projectV2Item {
                    id
                  }
                }
              }
            `,
            {
              projectId: resolution.project_id,
              itemId: resolution.item_id,
              fieldId: update.field_id,
              optionId: update.option_id,
            }
          );
        } else if (update.field_type === 'text') {
          return githubGraphQL(
            `
              mutation UpdateProjectField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
                updateProjectV2ItemFieldValue(
                  input: {
                    projectId: $projectId
                    itemId: $itemId
                    fieldId: $fieldId
                    value: { text: $text }
                  }
                ) {
                  projectV2Item {
                    id
                  }
                }
              }
            `,
            {
              projectId: resolution.project_id,
              itemId: resolution.item_id,
              fieldId: update.field_id,
              text: update.value,
            }
          );
        }

        return Promise.resolve();
      }));
    }
  }

  return {
    comment_posted: true,
    project_updates: appliedUpdates,
    warnings,
  };
}

export function buildWritebackActivityMessage(
  mode: GitHubWritebackMode,
  status: GitHubWritebackStatus,
  repoRef: string
): string {
  if (status === 'planned') {
    return `GitHub write-back dry run prepared for ${repoRef}`;
  }
  if (status === 'applied') {
    return `GitHub write-back applied to ${repoRef}`;
  }
  if (status === 'skipped') {
    return `GitHub write-back skipped for ${repoRef} because the current state is already synced`;
  }
  return `GitHub write-back ${mode === 'dry_run' ? 'dry run' : 'apply'} failed for ${repoRef}`;
}
