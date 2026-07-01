import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { parseDispatchMetadata, serializeDispatchMetadata } from './dispatch-contract';
import { queryOne, run, transaction } from './db';
import {
  buildGitHubImportPreviewResponse,
  buildTaskRefreshUpdateFromGitHubPreview,
  normalizeGitHubSourceIdentity,
} from './github-task-import';
import type { Task, TaskPriority, TaskStatus } from './types';

const execFileAsync = promisify(execFile);

export interface GitHubProjectWorkspaceMapping {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  github_project_owner: string;
  github_project_number: number;
  github_project_title: string;
  github_project_url: string;
  github_project_auto_refresh: boolean;
}

export const GITHUB_PROJECT_WORKSPACE_MAPPINGS: GitHubProjectWorkspaceMapping[] = [
  {
    id: 'assistants',
    name: 'Assistants',
    slug: 'assistants',
    description: 'Operator cockpit mapped to GitHub Project #13.',
    icon: 'A',
    github_project_owner: 'iMelki',
    github_project_number: 13,
    github_project_title: 'Assistants',
    github_project_url: 'https://github.com/users/iMelki/projects/13',
    github_project_auto_refresh: true,
  },
  {
    id: 'memsys',
    name: 'MemSys',
    slug: 'memsys',
    description: 'Memory-system cockpit mapped to GitHub Project #12.',
    icon: 'M',
    github_project_owner: 'iMelki',
    github_project_number: 12,
    github_project_title: 'MemSys',
    github_project_url: 'https://github.com/users/iMelki/projects/12',
    github_project_auto_refresh: true,
  },
  {
    id: 'content-factory',
    name: 'Content Factory',
    slug: 'content-factory',
    description: 'Content Factory cockpit mapped to GitHub Project #14.',
    icon: 'C',
    github_project_owner: 'iMelki',
    github_project_number: 14,
    github_project_title: 'Content Factory',
    github_project_url: 'https://github.com/users/iMelki/projects/14',
    github_project_auto_refresh: true,
  },
  {
    id: 'asimtop',
    name: 'Asimtop',
    slug: 'asimtop',
    description: 'Asimtop cockpit mapped to GitHub Project #8.',
    icon: 'A',
    github_project_owner: 'iMelki',
    github_project_number: 8,
    github_project_title: 'Asimtop Trading Automation',
    github_project_url: 'https://github.com/users/iMelki/projects/8',
    github_project_auto_refresh: false,
  },
];

interface WorkspaceProjectRow {
  id: string;
  slug: string;
  github_project_owner?: string | null;
  github_project_number?: number | null;
  github_project_title?: string | null;
}

interface GitHubProjectFieldValueNode {
  text?: string | null;
  name?: string | null;
  number?: number | null;
  date?: string | null;
  field?: {
    name?: string | null;
  } | null;
}

interface GitHubProjectItemNode {
  id?: string | null;
  isArchived?: boolean | null;
  content?: {
    __typename?: string;
    number?: number | null;
    title?: string | null;
    body?: string | null;
    url?: string | null;
    state?: string | null;
    closed?: boolean | null;
    repository?: {
      name?: string | null;
      nameWithOwner?: string | null;
      owner?: {
        login?: string | null;
      } | null;
    } | null;
    labels?: {
      nodes?: Array<{ name?: string | null }>;
    } | null;
  } | null;
  fieldValues?: {
    nodes?: GitHubProjectFieldValueNode[];
  } | null;
}

interface ProjectItemsPage {
  id: string;
  title: string;
  number: number;
  items: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
    nodes?: GitHubProjectItemNode[];
  };
}

interface ExistingTaskRow extends Pick<Task, 'id' | 'title' | 'description' | 'status' | 'priority' | 'workspace_id' | 'business_id'> {
  dispatch_metadata?: string | null;
  source_repo_owner?: string | null;
  source_repo_name?: string | null;
  source_issue_number?: number | null;
  source_issue_url?: string | null;
  source_project_item_id?: string | null;
}

export interface GitHubProjectWorkspaceSyncResult {
  workspace_id: string;
  workspace_slug: string;
  project_owner: string;
  project_number: number;
  project_title: string;
  dry_run: boolean;
  scanned_items: number;
  imported: number;
  updated: number;
  moved: number;
  skipped: number;
  skipped_closed: number;
  status_reconciled: number;
  upstream_drift_warnings: number;
  errors: string[];
  details: Array<{
    action: 'import' | 'update' | 'move' | 'skip' | 'status_reconcile' | 'drift' | 'error';
    issue?: string;
    task_id?: string;
    reason?: string;
  }>;
}

function getGitHubToken(): string | undefined {
  return process.env.GH_GENERAL_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || undefined;
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

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync('gh', args, {
    env: buildGitHubCliEnv(),
    maxBuffer: 20 * 1024 * 1024,
  });

  return JSON.parse(stdout) as T;
}

const PROJECT_ITEMS_QUERY = `
query ($owner: String!, $number: Int!, $after: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      title
      number
      items(first: 50, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isArchived
          content {
            __typename
            ... on Issue {
              number
              title
              body
              url
              state
              closed
              repository {
                name
                nameWithOwner
                owner {
                  login
                }
              }
              labels(first: 50) {
                nodes {
                  name
                }
              }
            }
            ... on PullRequest {
              number
              title
              url
              state
              repository {
                nameWithOwner
              }
            }
            ... on DraftIssue {
              title
            }
          }
          fieldValues(first: 100) {
            nodes {
              ... on ProjectV2ItemFieldTextValue {
                text
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`.trim();

function normalizeProjectFields(
  project: Pick<ProjectItemsPage, 'title'>,
  item: GitHubProjectItemNode
): Record<string, unknown> {
  const repoFullName = item.content?.repository?.nameWithOwner ?? '';
  const fields: Record<string, unknown> = {
    Repo: repoFullName,
    Project: project.title,
    'Project Item ID': item.id ?? '',
  };

  for (const fieldValue of item.fieldValues?.nodes ?? []) {
    const fieldName = fieldValue.field?.name?.trim();
    if (!fieldName) {
      continue;
    }

    const value = fieldValue.text
      ?? fieldValue.name
      ?? fieldValue.date
      ?? (typeof fieldValue.number === 'number' ? String(fieldValue.number) : undefined);

    if (value) {
      fields[fieldName] = value;
    }
  }

  return fields;
}

async function loadProjectItems(owner: string, number: number): Promise<ProjectItemsPage & { allItems: GitHubProjectItemNode[] }> {
  let after: string | undefined;
  let project: ProjectItemsPage | undefined;
  const allItems: GitHubProjectItemNode[] = [];

  do {
    const response = await ghJson<{
      data?: {
        user?: {
          projectV2?: ProjectItemsPage | null;
        } | null;
      };
    }>([
      'api',
      'graphql',
      '--raw-field',
      `query=${PROJECT_ITEMS_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-F',
      `number=${number}`,
      ...(after ? ['-f', `after=${after}`] : []),
    ]);

    project = response.data?.user?.projectV2 ?? undefined;
    if (!project) {
      throw new Error(`GitHub Project ${owner}#${number} was not found or is not visible to the token.`);
    }

    allItems.push(...(project.items.nodes ?? []));
    after = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor ?? undefined : undefined;
  } while (after);

  return { ...project, allItems };
}

function findWorkspaceProject(workspaceIdOrSlug: string): WorkspaceProjectRow | undefined {
  return queryOne<WorkspaceProjectRow>(
    `SELECT id, slug, github_project_owner, github_project_number, github_project_title
     FROM workspaces
     WHERE id = ? OR slug = ?`,
    [workspaceIdOrSlug, workspaceIdOrSlug]
  );
}

function findExistingTask(
  workspaceId: string,
  projectItemId: string | undefined,
  owner: string,
  repo: string,
  issueNumber: number
): ExistingTaskRow | undefined {
  return queryOne<ExistingTaskRow>(
    `SELECT id, title, description, status, priority, workspace_id, business_id, dispatch_metadata,
            source_repo_owner, source_repo_name, source_issue_number, source_issue_url, source_project_item_id
     FROM tasks
     WHERE (source_project_item_id IS NOT NULL AND source_project_item_id = ?)
        OR (workspace_id = ? AND source_repo_owner = ? AND source_repo_name = ? AND source_issue_number = ?)`,
    [projectItemId ?? '', workspaceId, owner, repo, issueNumber]
  );
}

function buildIssueRef(owner: string, repo: string, issueNumber: number): string {
  return `${owner}/${repo}#${issueNumber}`;
}

export type GitHubProjectStatusKind = 'ready' | 'review' | 'blocked' | 'done' | 'other';

export interface GitHubProjectStatusReconciliation {
  upstream_status?: GitHubProjectStatusKind;
  local_status?: TaskStatus;
  reason?: string;
  drift_warning?: string;
}

function normalizeStatusText(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeGitHubProjectStatus(value: unknown): GitHubProjectStatusKind | undefined {
  const normalized = normalizeStatusText(value);
  if (!normalized) {
    return undefined;
  }

  if (['done', 'complete', 'completed', 'closed'].includes(normalized)) {
    return 'done';
  }

  if (['review', 'in review', 'needs review', 'ready for review'].includes(normalized)) {
    return 'review';
  }

  if (['ready', 'ready for agent', 'ready for work', 'to do', 'todo', 'inbox'].includes(normalized)) {
    return 'ready';
  }

  if (['blocked', 'on hold', 'waiting', 'waiting on', 'waiting for'].includes(normalized)) {
    return 'blocked';
  }

  return 'other';
}

function projectStatusFieldValue(projectFields: Record<string, unknown>): unknown {
  const matchingKey = Object.keys(projectFields).find((key) => key.trim().toLowerCase() === 'status');
  return matchingKey ? projectFields[matchingKey] : undefined;
}

export function reconcileGitHubProjectStatus(input: {
  currentStatus: TaskStatus;
  issueClosed?: boolean | null;
  projectStatus?: unknown;
}): GitHubProjectStatusReconciliation {
  const upstreamStatus = normalizeGitHubProjectStatus(input.projectStatus);

  if (input.issueClosed) {
    return {
      upstream_status: 'done',
      local_status: 'done',
      reason: 'GitHub issue is closed, so the local MCK task should be Done.',
    };
  }

  if (upstreamStatus === 'done') {
    return {
      upstream_status: upstreamStatus,
      local_status: 'done',
      reason: 'GitHub Project Status is Done, so the local MCK task should be Done.',
    };
  }

  if (input.currentStatus === 'done') {
    if (upstreamStatus) {
      return {
        upstream_status: upstreamStatus,
        drift_warning: `Local task is Done while GitHub Project Status is ${input.projectStatus}.`,
      };
    }

    return { upstream_status: upstreamStatus };
  }

  if (upstreamStatus === 'review') {
    return {
      upstream_status: upstreamStatus,
      local_status: 'review',
      reason: 'GitHub Project Status Review maps to the local Review column.',
    };
  }

  if (upstreamStatus === 'ready' && input.currentStatus === 'planning') {
    return {
      upstream_status: upstreamStatus,
      local_status: 'inbox',
      reason: 'GitHub Project Status Ready maps planning imports into the local Inbox gate.',
    };
  }

  if (upstreamStatus === 'blocked') {
    return {
      upstream_status: upstreamStatus,
      drift_warning: 'GitHub Project Status Blocked has no first-class MCK column yet; local status is preserved.',
    };
  }

  return { upstream_status: upstreamStatus };
}

export async function syncGitHubProjectWorkspace(
  workspaceIdOrSlug: string,
  options: { dryRun?: boolean } = {}
): Promise<GitHubProjectWorkspaceSyncResult> {
  if (!getGitHubToken()) {
    throw new Error('Missing GH_GENERAL_TOKEN or GITHUB_TOKEN.');
  }

  const workspace = findWorkspaceProject(workspaceIdOrSlug);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceIdOrSlug}' was not found.`);
  }

  if (!workspace.github_project_owner || !workspace.github_project_number) {
    throw new Error(`Workspace '${workspace.slug}' is not linked to a GitHub Project.`);
  }

  const project = await loadProjectItems(workspace.github_project_owner, workspace.github_project_number);
  return syncLoadedGitHubProjectWorkspace(workspaceIdOrSlug, project, options);
}

export async function syncLoadedGitHubProjectWorkspace(
  workspaceIdOrSlug: string,
  project: Pick<ProjectItemsPage, 'title'> & { allItems: GitHubProjectItemNode[] },
  options: { dryRun?: boolean } = {}
): Promise<GitHubProjectWorkspaceSyncResult> {
  const workspace = findWorkspaceProject(workspaceIdOrSlug);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceIdOrSlug}' was not found.`);
  }

  if (!workspace.github_project_owner || !workspace.github_project_number) {
    throw new Error(`Workspace '${workspace.slug}' is not linked to a GitHub Project.`);
  }

  const result: GitHubProjectWorkspaceSyncResult = {
    workspace_id: workspace.id,
    workspace_slug: workspace.slug,
    project_owner: workspace.github_project_owner,
    project_number: workspace.github_project_number,
    project_title: project.title,
    dry_run: Boolean(options.dryRun),
    scanned_items: project.allItems.length,
    imported: 0,
    updated: 0,
    moved: 0,
    skipped: 0,
    skipped_closed: 0,
    status_reconciled: 0,
    upstream_drift_warnings: 0,
    errors: [],
    details: [],
  };

  for (const item of project.allItems) {
    if (item.isArchived || item.content?.__typename !== 'Issue') {
      result.skipped += 1;
      result.details.push({ action: 'skip', reason: item.isArchived ? 'archived project item' : 'not a GitHub issue' });
      continue;
    }

    const content = item.content;
    const owner = content.repository?.owner?.login;
    const repo = content.repository?.name;
    const issueNumber = content.number;
    const issueUrl = content.url;

    if (!owner || !repo || !issueNumber || !issueUrl) {
      result.skipped += 1;
      result.details.push({ action: 'skip', reason: 'missing issue source identity' });
      continue;
    }

    const issueRef = buildIssueRef(owner, repo, issueNumber);
    const projectFields = normalizeProjectFields(project, item);
    const projectItemId = typeof projectFields['Project Item ID'] === 'string'
      ? projectFields['Project Item ID']
      : undefined;
    const projectStatus = projectStatusFieldValue(projectFields);
    const upstreamStatus = normalizeGitHubProjectStatus(projectStatus);
    const existing = findExistingTask(workspace.id, projectItemId, owner, repo, issueNumber);

    if ((content.closed || upstreamStatus === 'done') && !existing) {
      result.skipped += 1;
      result.skipped_closed += 1;
      result.details.push({
        action: 'skip',
        issue: issueRef,
        reason: content.closed
          ? 'closed issue is not imported into a fresh workspace'
          : 'Project Done item is not imported into a fresh workspace',
      });
      continue;
    }
    const previewResponse = buildGitHubImportPreviewResponse({
      request: {
        issue: {
          number: issueNumber,
          title: content.title ?? 'Untitled GitHub issue',
          body: content.body ?? '',
          html_url: issueUrl,
          labels: content.labels?.nodes?.map((label) => ({ name: label.name ?? '' })) ?? [],
        },
        repository: {
          full_name: content.repository?.nameWithOwner ?? `${owner}/${repo}`,
          name: repo,
          owner: { login: owner },
        },
        project_fields: projectFields,
        workspace_id: workspace.id,
        business_id: 'default',
      },
    });

    const preview = previewResponse.preview;
    const source = normalizeGitHubSourceIdentity(preview.github_source);

    if (!source) {
      result.skipped += 1;
      result.details.push({ action: 'skip', issue: issueRef, reason: 'preview did not produce a valid GitHub source identity' });
      continue;
    }

    if (options.dryRun) {
      if (existing) {
        const reconciliation = reconcileGitHubProjectStatus({
          currentStatus: existing.status,
          issueClosed: content.closed,
          projectStatus,
        });
        const reconciledStatusChanged = Boolean(
          reconciliation.local_status && reconciliation.local_status !== existing.status
        );

        result.updated += 1;
        if (existing.workspace_id !== workspace.id) {
          result.moved += 1;
        }
        result.details.push({ action: existing.workspace_id === workspace.id ? 'update' : 'move', issue: issueRef, task_id: existing.id });
        if (reconciledStatusChanged) {
          result.status_reconciled += 1;
          result.details.push({
            action: 'status_reconcile',
            issue: issueRef,
            task_id: existing.id,
            reason: `would move local status from ${existing.status} to ${reconciliation.local_status}: ${reconciliation.reason ?? 'upstream status reconciliation'}`,
          });
        }
        if (reconciliation.drift_warning) {
          result.upstream_drift_warnings += 1;
          result.details.push({
            action: 'drift',
            issue: issueRef,
            task_id: existing.id,
            reason: reconciliation.drift_warning,
          });
        }
      } else {
        result.imported += 1;
        result.details.push({ action: 'import', issue: issueRef });
      }
      continue;
    }

    try {
      transaction(() => {
        const now = new Date().toISOString();

        if (existing) {
          const reconciliation = reconcileGitHubProjectStatus({
            currentStatus: existing.status,
            issueClosed: content.closed,
            projectStatus,
          });
          const reconciledStatus = reconciliation.local_status ?? existing.status;
          const reconciledStatusChanged = reconciledStatus !== existing.status;
          const patch = buildTaskRefreshUpdateFromGitHubPreview(
            {
              title: existing.title,
              description: existing.description,
              priority: existing.priority,
              github_source: normalizeGitHubSourceIdentity({
                repo_owner: existing.source_repo_owner,
                repo_name: existing.source_repo_name,
                issue_number: existing.source_issue_number,
                issue_url: existing.source_issue_url,
                project_item_id: existing.source_project_item_id,
              }),
              dispatch_metadata: parseDispatchMetadata(existing.dispatch_metadata),
            },
            preview
          );

          run(
            `UPDATE tasks
             SET title = ?,
                 description = ?,
                 priority = ?,
                 workspace_id = ?,
                 business_id = ?,
                 source_repo_owner = ?,
                 source_repo_name = ?,
                 source_issue_number = ?,
                 source_issue_url = ?,
                 source_project_item_id = ?,
                 dispatch_metadata = ?,
                 status = ?,
                 updated_at = ?
             WHERE id = ?`,
            [
              patch.title,
              patch.description ?? null,
              (patch.priority ?? existing.priority) as TaskPriority,
              workspace.id,
              preview.business_id,
              source.repo_owner,
              source.repo_name,
              source.issue_number,
              source.issue_url,
              source.project_item_id ?? null,
              serializeDispatchMetadata(patch.dispatch_metadata),
              reconciledStatus,
              now,
              existing.id,
            ]
          );

          if (reconciledStatusChanged) {
            run(
              `INSERT INTO events (id, type, task_id, message, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                uuidv4(),
                reconciledStatus === 'done' ? 'task_completed' : 'task_status_changed',
                existing.id,
                `GitHub Project sync reconciled ${issueRef} from ${existing.status} to ${reconciledStatus}.`,
                JSON.stringify({
                  project_owner: workspace.github_project_owner,
                  project_number: workspace.github_project_number,
                  source: issueRef,
                  upstream_status: reconciliation.upstream_status ?? null,
                  reason: reconciliation.reason ?? null,
                }),
                now,
              ]
            );
            result.status_reconciled += 1;
            result.details.push({
              action: 'status_reconcile',
              issue: issueRef,
              task_id: existing.id,
              reason: `moved local status from ${existing.status} to ${reconciledStatus}: ${reconciliation.reason ?? 'upstream status reconciliation'}`,
            });
          }

          if (reconciliation.drift_warning) {
            result.upstream_drift_warnings += 1;
            result.details.push({
              action: 'drift',
              issue: issueRef,
              task_id: existing.id,
              reason: reconciliation.drift_warning,
            });
          }

          if (existing.workspace_id !== workspace.id) {
            result.moved += 1;
            result.details.push({ action: 'move', issue: issueRef, task_id: existing.id });
          } else {
            result.updated += 1;
            result.details.push({ action: 'update', issue: issueRef, task_id: existing.id });
          }
          return;
        }

        const taskId = uuidv4();
        run(
          `INSERT INTO tasks (
             id, title, description, status, priority, workspace_id, business_id,
             source_repo_owner, source_repo_name, source_issue_number, source_issue_url,
             source_project_item_id, dispatch_metadata, created_at, updated_at
           )
           VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            taskId,
            preview.title,
            preview.description ?? null,
            preview.priority ?? 'normal',
            workspace.id,
            preview.business_id,
            source.repo_owner,
            source.repo_name,
            source.issue_number,
            source.issue_url,
            source.project_item_id ?? null,
            serializeDispatchMetadata(preview.dispatch_metadata),
            now,
            now,
          ]
        );

        run(
          `INSERT INTO events (id, type, task_id, message, metadata, created_at)
           VALUES (?, 'task_created', ?, ?, ?, ?)`,
          [
            uuidv4(),
            taskId,
            `GitHub Project sync imported ${issueRef}`,
            JSON.stringify({
              project_owner: workspace.github_project_owner,
              project_number: workspace.github_project_number,
              source: issueRef,
            }),
            now,
          ]
        );

        result.imported += 1;
        result.details.push({ action: 'import', issue: issueRef, task_id: taskId });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync failure';
      result.errors.push(`${issueRef}: ${message}`);
      result.details.push({ action: 'error', issue: issueRef, reason: message });
    }
  }

  return result;
}
