import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import {
  buildSyncImportDispatchMetadata,
  demoteReadinessForPlaceholderOnlyDone,
  parseDispatchMetadata,
  PLACEHOLDER_DONE_READINESS_REASON,
  serializeDispatchMetadata,
} from './dispatch-contract';
import { queryAll, queryOne, run, transaction } from './db';
import {
  recordFieldClears,
  tombstoneSourceForGitHubSync,
  type TaskFieldSnapshot,
} from './field-tombstones';
import {
  buildGitHubImportPreviewResponse,
  buildTaskRefreshPlanFromGitHubPreview,
  normalizeGitHubSourceIdentity,
  type GitHubImportPreviewTask,
  type GitHubTaskRefreshPlan,
} from './github-task-import';
import { hasDoneOrReviewEvidence, type StatusEvidence } from './status-evidence';
import type { Task, TaskPriority, TaskStatus, TaskSyncFlags } from './types';

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
  {
    id: 'frontend-revenue',
    name: 'Frontend Revenue',
    slug: 'frontend-revenue',
    description: 'Frontend Revenue cockpit mapped to GitHub Project #15.',
    icon: 'F',
    github_project_owner: 'iMelki',
    github_project_number: 15,
    github_project_title: 'Frontend Revenue Program 2026',
    github_project_url: 'https://github.com/users/iMelki/projects/15',
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
    closedByPullRequestsReferences?: {
      nodes?: Array<{ url?: string | null; merged?: boolean | null; baseRefName?: string | null } | null>;
    } | null;
    /** PullRequest items only. */
    merged?: boolean | null;
    baseRefName?: string | null;
    closingIssuesReferences?: {
      nodes?: Array<{
        number?: number | null;
        repository?: { nameWithOwner?: string | null } | null;
      } | null>;
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
  github_last_read_at?: string | null;
}

/**
 * How complete a Project read was (docs/SYNC_FIELD_AUTHORITY.md section 3.2).
 * A truncated page set or a failed page is never complete.
 */
export interface GitHubProjectReadStatus {
  complete: boolean;
  reason?: string;
}

export interface GitHubProjectWorkspaceSyncResult {
  workspace_id: string;
  workspace_slug: string;
  project_owner: string;
  project_number: number;
  project_title: string;
  dry_run: boolean;
  selection: 'all' | 'targeted';
  requested_issue_refs: string[];
  scanned_items: number;
  selected_items: number;
  imported: number;
  updated: number;
  moved: number;
  skipped: number;
  skipped_closed: number;
  status_reconciled: number;
  upstream_drift_warnings: number;
  /** Cards that stayed put because Done or Review lacked evidence. */
  needs_evidence: number;
  /** Done cards with a placeholder-only contract set from Ready for Agent to Needs Grooming. */
  readiness_reset: number;
  /** Tombstones written (apply) or that would be written (dry run). */
  tombstones: number;
  /** Id stamped on every tombstone this run writes. */
  sync_run_id: string;
  /** When the Project was read; an older read never overwrites a newer one. */
  read_at: string;
  /** False after a truncated or failed page, or a redacted (403) item. */
  read_complete: boolean;
  /** Repos whose sync is STALE because this read was not complete for them. */
  stale_repos: string[];
  /** Cards whose Project item was missing from two consecutive complete reads. */
  removed_from_project: number;
  errors: string[];
  details: Array<{
    action: 'import' | 'update' | 'move' | 'skip' | 'status_reconcile' | 'drift' | 'tombstone' | 'error';
    issue?: string;
    task_id?: string;
    reason?: string;
    field?: string;
  }>;
}

export interface GitHubProjectWorkspaceSyncOptions {
  dryRun?: boolean;
  issueRefs?: string[];
  /** Defaults to a fresh UUID. */
  syncRunId?: string;
  /** ISO time the Project was read. Defaults to now. */
  readAt?: string;
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
              closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
                nodes {
                  url
                  merged
                  baseRefName
                }
              }
            }
            ... on PullRequest {
              number
              title
              url
              state
              merged
              baseRefName
              repository {
                nameWithOwner
              }
              closingIssuesReferences(first: 10) {
                nodes {
                  number
                  repository {
                    nameWithOwner
                  }
                }
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

async function loadProjectItems(
  owner: string,
  number: number,
): Promise<ProjectItemsPage & { allItems: GitHubProjectItemNode[]; read: GitHubProjectReadStatus }> {
  let after: string | undefined;
  let project: ProjectItemsPage | undefined;
  const allItems: GitHubProjectItemNode[] = [];
  let page = 0;

  do {
    page += 1;
    let response: { data?: { user?: { projectV2?: ProjectItemsPage | null } | null } };
    try {
      response = await ghJson<{
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
    } catch (error) {
      if (!project) {
        throw error;
      }
      // A later page failed: return what was read, marked incomplete, so the
      // sync changes nothing (section 3.2).
      return {
        ...project,
        allItems,
        read: { complete: false, reason: `page ${page} failed: ${error instanceof Error ? error.message : 'unknown error'}` },
      };
    }

    const loaded: ProjectItemsPage | undefined = response.data?.user?.projectV2 ?? undefined;
    if (!loaded) {
      if (!project) {
        throw new Error(`GitHub Project ${owner}#${number} was not found or is not visible to the token.`);
      }
      return { ...project, allItems, read: { complete: false, reason: `page ${page} returned no Project data` } };
    }
    project = loaded;

    allItems.push(...(project.items.nodes ?? []));
    if (project.items.pageInfo.hasNextPage && !project.items.pageInfo.endCursor) {
      return { ...project, allItems, read: { complete: false, reason: `page ${page} says more pages exist but has no cursor (truncated page set)` } };
    }
    after = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor ?? undefined : undefined;
  } while (after);

  return { ...project, allItems, read: { complete: true } };
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
            source_repo_owner, source_repo_name, source_issue_number, source_issue_url, source_project_item_id,
            github_last_read_at
     FROM tasks
     WHERE (source_project_item_id IS NOT NULL AND source_project_item_id = ?)
        OR (workspace_id = ? AND source_repo_owner = ? AND source_repo_name = ? AND source_issue_number = ?)`,
    [projectItemId ?? '', workspaceId, owner, repo, issueNumber]
  );
}

function buildIssueRef(owner: string, repo: string, issueNumber: number): string {
  return `${owner}/${repo}#${issueNumber}`;
}

function normalizeRequestedIssueRefs(values: string[] | undefined): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const normalized = [...new Set(values.flatMap((value) => {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }))];
  if (normalized.length === 0) {
    throw new Error('Targeted GitHub Project sync requires at least one issue ref.');
  }
  for (const value of normalized) {
    if (!/^[^/#\s]+\/[^/#\s]+#[1-9]\d*$/.test(value)) {
      throw new Error(`Invalid targeted GitHub issue ref '${value}'. Expected owner/repo#number.`);
    }
  }
  return normalized;
}

function getProjectItemIssueRef(item: GitHubProjectItemNode): string | undefined {
  if (item.isArchived || item.content?.__typename !== 'Issue') {
    return undefined;
  }
  const owner = item.content.repository?.owner?.login;
  const repo = item.content.repository?.name;
  const issueNumber = item.content.number;
  if (!owner || !repo || !issueNumber) {
    return undefined;
  }
  return buildIssueRef(owner, repo, issueNumber);
}

export type GitHubProjectStatusKind = 'ready' | 'review' | 'blocked' | 'done' | 'other';

export interface GitHubProjectStatusReconciliation {
  upstream_status?: GitHubProjectStatusKind;
  local_status?: TaskStatus;
  reason?: string;
  drift_warning?: string;
  /** Done or Review was asked for without evidence; the card did not move. */
  needs_evidence?: boolean;
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

export const NEEDS_EVIDENCE_PREFIX = 'Needs evidence:';

function columnLabel(status: TaskStatus): string {
  return status.replace(/_/g, ' ');
}

/**
 * Derive the local column from GitHub. docs/SYNC_FIELD_AUTHORITY.md section 6
 * and CTO's rulings of 2026-11-19 14:41 IST:
 *
 * - Project Status sets every column except Done and Review as before.
 * - Done and Review need evidence: a merged PR into `main` (or the production
 *   branch), or a closed issue with a linked main merge or a closing comment
 *   naming what shipped. A merge into `dev` is never evidence.
 * - Without evidence the card stays in its current column and the result
 *   carries `needs_evidence` plus a drift warning, so it is never silent.
 */
export function reconcileGitHubProjectStatus(input: {
  currentStatus: TaskStatus;
  issueClosed?: boolean | null;
  projectStatus?: unknown;
  evidence?: ReadonlyArray<StatusEvidence> | null;
}): GitHubProjectStatusReconciliation {
  const upstreamStatus = normalizeGitHubProjectStatus(input.projectStatus);
  const evidenced = hasDoneOrReviewEvidence(input.evidence);
  const current = input.currentStatus;

  if (input.issueClosed && evidenced) {
    return {
      upstream_status: 'done',
      local_status: 'done',
      reason: 'GitHub issue is closed with evidence (merged PR into main or a closing comment naming what shipped), so the local MCK task should be Done.',
    };
  }

  if (upstreamStatus === 'done' || upstreamStatus === 'review') {
    const target: TaskStatus = upstreamStatus;
    const label = upstreamStatus === 'done' ? 'Done' : 'Review';
    if (current === 'done' && upstreamStatus === 'review') {
      return {
        upstream_status: upstreamStatus,
        drift_warning: `Local task is Done while GitHub Project Status is ${input.projectStatus}.`,
      };
    }
    if (current === target) {
      return { upstream_status: upstreamStatus };
    }
    if (evidenced) {
      return {
        upstream_status: upstreamStatus,
        local_status: target,
        reason: `GitHub Project Status ${label} with evidence (merged PR into main or closing evidence) maps to the local ${label} column.`,
      };
    }
    return {
      upstream_status: upstreamStatus,
      needs_evidence: true,
      drift_warning: `${NEEDS_EVIDENCE_PREFIX} GitHub Project Status is ${label} but there is no main merge or closing evidence; the card stays in ${columnLabel(current)}.`,
    };
  }

  const base = reconcileFromProjectStatus(current, upstreamStatus, input.projectStatus);
  if (input.issueClosed && current !== 'done') {
    const warning = `${NEEDS_EVIDENCE_PREFIX} GitHub issue is closed but there is no main merge or closing evidence; the card is not moved to Done.`;
    return {
      ...base,
      needs_evidence: true,
      drift_warning: base.drift_warning ? `${warning} ${base.drift_warning}` : warning,
    };
  }
  return base;
}

function reconcileFromProjectStatus(
  currentStatus: TaskStatus,
  upstreamStatus: GitHubProjectStatusKind | undefined,
  projectStatus: unknown,
): GitHubProjectStatusReconciliation {
  if (currentStatus === 'done') {
    if (upstreamStatus) {
      return {
        upstream_status: upstreamStatus,
        drift_warning: `Local task is Done while GitHub Project Status is ${projectStatus}.`,
      };
    }

    return { upstream_status: upstreamStatus };
  }

  if (upstreamStatus === 'ready' && currentStatus === 'planning') {
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

/**
 * Evidence carried on an Issue item: the PRs GitHub links as closing it.
 * Only a merged PR into main (or master) counts; `isDoneOrReviewEvidence`
 * rejects dev merges.
 */
function extractCloseEvidence(content: GitHubProjectItemNode['content']): StatusEvidence[] {
  const nodes = content?.closedByPullRequestsReferences?.nodes ?? [];
  return nodes.flatMap((node) => {
    if (!node || typeof node.baseRefName !== 'string') {
      return [];
    }
    return [{
      kind: 'merged_pr' as const,
      base_ref: node.baseRefName,
      merged: node.merged === true,
      url: node.url ?? undefined,
    }];
  });
}

/**
 * Every open Project issue in a mapped repo that has no card is imported, and
 * always lands as Needs Grooming whatever upstream says, so a fresh import is
 * never dispatchable until an operator grooms it in MCK.
 */
export function buildImportDispatchMetadata(metadata: GitHubImportPreviewTask['dispatch_metadata']) {
  return buildSyncImportDispatchMetadata(metadata);
}

function serializeSyncFlags(flags: TaskSyncFlags): string | null {
  const hasFlag = Boolean(flags.needs_evidence || flags.removed_from_project || (flags.drift && flags.drift.length > 0));
  return hasFlag ? JSON.stringify(flags) : null;
}

export function parseSyncFlags(raw: unknown): TaskSyncFlags | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as TaskSyncFlags;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function listWorkspaceRepos(workspaceId: string, items: GitHubProjectItemNode[]): string[] {
  const repos = new Set<string>();
  for (const row of queryAll<{ owner: string; repo: string }>(
    `SELECT DISTINCT source_repo_owner AS owner, source_repo_name AS repo FROM tasks
     WHERE workspace_id = ? AND source_repo_owner IS NOT NULL AND source_repo_name IS NOT NULL`,
    [workspaceId],
  )) {
    repos.add(`${row.owner}/${row.repo}`);
  }
  for (const item of items) {
    const name = item.content?.repository?.nameWithOwner;
    if (name) repos.add(name);
  }
  return [...repos].sort();
}

/**
 * Section 3.2, rule 3 (T18): a card whose Project item is missing from one
 * complete read is only counted. Missing from two consecutive complete reads,
 * its Project item link is cleared with a tombstone and the card is flagged.
 * A dry run reports what it would do and writes nothing.
 */
function applyTwoReadRemoval(
  workspace: WorkspaceProjectRow,
  seenProjectItemIds: ReadonlySet<string>,
  seenTaskIds: ReadonlySet<string>,
  result: GitHubProjectWorkspaceSyncResult,
  dryRun: boolean,
): void {
  const linked = queryAll<{
    id: string;
    source_project_item_id: string;
    github_missing_reads: number | null;
    sync_flags: string | null;
  }>(
    `SELECT id, source_project_item_id, github_missing_reads, sync_flags FROM tasks
     WHERE workspace_id = ? AND source_project_item_id IS NOT NULL AND source_project_item_id != ''`,
    [workspace.id],
  );
  const projectRef = `github:${workspace.github_project_owner}/projects/${workspace.github_project_number}`;

  for (const card of linked) {
    if (seenProjectItemIds.has(card.source_project_item_id) || seenTaskIds.has(card.id)) {
      continue;
    }
    const misses = (card.github_missing_reads ?? 0) + 1;
    if (misses < 2) {
      if (!dryRun) {
        run('UPDATE tasks SET github_missing_reads = ? WHERE id = ?', [misses, card.id]);
      }
      result.details.push({
        action: 'skip',
        task_id: card.id,
        reason: `Project item ${card.source_project_item_id} missing from this complete read (1 of 2); nothing cleared`,
      });
      continue;
    }

    const reason = `Project item ${card.source_project_item_id} was missing from two consecutive complete reads`;
    if (dryRun) {
      result.tombstones += 1;
      result.details.push({
        action: 'tombstone',
        task_id: card.id,
        field: 'github_source.project_item_id',
        reason: `would write tombstone: ${reason} (dry run; nothing persisted)`,
      });
      continue;
    }

    transaction(() => {
      const now = new Date().toISOString();
      recordFieldClears({
        taskId: card.id,
        before: { github_source: { project_item_id: card.source_project_item_id } },
        after: { github_source: { project_item_id: undefined } },
        source: { source: projectRef, sync_run_id: result.sync_run_id },
        context: `GitHub Project sync two-read removal ${card.id}`,
      });
      const flags = { ...(parseSyncFlags(card.sync_flags) ?? {}), removed_from_project: reason, sync_run_id: result.sync_run_id, flagged_at: now };
      run(
        `UPDATE tasks SET source_project_item_id = NULL, github_missing_reads = 0, sync_flags = ?, updated_at = ? WHERE id = ?`,
        [serializeSyncFlags(flags), now, card.id],
      );
    });
    result.tombstones += 1;
    result.removed_from_project += 1;
    result.details.push({ action: 'tombstone', task_id: card.id, field: 'github_source.project_item_id', reason });
  }
}

function existingTaskSnapshot(existing: ExistingTaskRow) {
  return {
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
  };
}

function planExistingTaskRefresh(
  existing: ExistingTaskRow,
  preview: GitHubImportPreviewTask,
  reconciledStatus: string,
): { plan: GitHubTaskRefreshPlan; before: TaskFieldSnapshot; after: TaskFieldSnapshot; readinessReset: boolean } {
  const current = existingTaskSnapshot(existing);
  const plan = buildTaskRefreshPlanFromGitHubPreview(current, preview);
  const demotion = demoteReadinessForPlaceholderOnlyDone(plan.update.dispatch_metadata, reconciledStatus);
  plan.update.dispatch_metadata = demotion.metadata;
  return {
    readinessReset: demotion.demoted,
    plan,
    before: {
      description: current.description,
      dispatch_metadata: current.dispatch_metadata,
      github_source: current.github_source,
    },
    after: {
      description: plan.update.description,
      dispatch_metadata: plan.update.dispatch_metadata,
      github_source: plan.update.github_source,
    },
  };
}

function pushReadinessReset(
  result: GitHubProjectWorkspaceSyncResult,
  issueRef: string,
  taskId: string,
  readinessReset: boolean,
): void {
  if (!readinessReset) {
    return;
  }
  result.readiness_reset += 1;
  result.details.push({
    action: 'status_reconcile',
    issue: issueRef,
    task_id: taskId,
    field: 'dispatch_metadata.readiness',
    reason: PLACEHOLDER_DONE_READINESS_REASON,
  });
}

function pushLocalOwnedDrift(
  result: GitHubProjectWorkspaceSyncResult,
  issueRef: string,
  taskId: string,
  plan: GitHubTaskRefreshPlan,
): void {
  for (const drift of plan.local_owned_drift) {
    result.upstream_drift_warnings += 1;
    result.details.push({ action: 'drift', issue: issueRef, task_id: taskId, field: drift.field, reason: drift.reason });
  }
}

/**
 * PR items never become cards. A PR on the Project only links to its issue's
 * card as evidence, through `closingIssuesReferences`. Keyed by lower-case
 * `owner/repo#number`.
 */
function collectPullRequestEvidence(items: GitHubProjectItemNode[]): Map<string, StatusEvidence[]> {
  const evidence = new Map<string, StatusEvidence[]>();
  for (const item of items) {
    const content = item.content;
    if (item.isArchived || content?.__typename !== 'PullRequest') {
      continue;
    }
    const baseRef = typeof content.baseRefName === 'string' ? content.baseRefName : '';
    for (const issue of content.closingIssuesReferences?.nodes ?? []) {
      const repoFullName = issue?.repository?.nameWithOwner ?? content.repository?.nameWithOwner;
      if (!issue?.number || !repoFullName) {
        continue;
      }
      const key = `${repoFullName}#${issue.number}`.toLowerCase();
      const list = evidence.get(key) ?? [];
      list.push({ kind: 'merged_pr', base_ref: baseRef, merged: content.merged === true, url: content.url ?? undefined });
      evidence.set(key, list);
    }
  }
  return evidence;
}

export async function syncGitHubProjectWorkspace(
  workspaceIdOrSlug: string,
  options: GitHubProjectWorkspaceSyncOptions = {}
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

  const readAt = options.readAt ?? new Date().toISOString();
  const project = await loadProjectItems(workspace.github_project_owner, workspace.github_project_number);
  return syncLoadedGitHubProjectWorkspace(workspaceIdOrSlug, project, { ...options, readAt });
}

export async function syncLoadedGitHubProjectWorkspace(
  workspaceIdOrSlug: string,
  project: Pick<ProjectItemsPage, 'title'> & { allItems: GitHubProjectItemNode[]; read?: GitHubProjectReadStatus },
  options: GitHubProjectWorkspaceSyncOptions = {}
): Promise<GitHubProjectWorkspaceSyncResult> {
  const workspace = findWorkspaceProject(workspaceIdOrSlug);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceIdOrSlug}' was not found.`);
  }

  if (!workspace.github_project_owner || !workspace.github_project_number) {
    throw new Error(`Workspace '${workspace.slug}' is not linked to a GitHub Project.`);
  }

  const requestedIssueRefs = normalizeRequestedIssueRefs(options.issueRefs);
  const requestedKeys = requestedIssueRefs
    ? new Set(requestedIssueRefs.map((value) => value.toLowerCase()))
    : undefined;
  const matchingCounts = new Map<string, number>();
  if (requestedKeys) {
    for (const item of project.allItems) {
      const issueRef = getProjectItemIssueRef(item)?.toLowerCase();
      if (issueRef && requestedKeys.has(issueRef)) {
        matchingCounts.set(issueRef, (matchingCounts.get(issueRef) ?? 0) + 1);
      }
    }
    for (const issueRef of requestedIssueRefs ?? []) {
      const count = matchingCounts.get(issueRef.toLowerCase()) ?? 0;
      if (count !== 1) {
        throw new Error(`Targeted GitHub issue ref '${issueRef}' must match exactly one active Project item; found ${count}.`);
      }
    }
  }
  const selectedItems = requestedKeys
    ? project.allItems.filter((item) => {
        const issueRef = getProjectItemIssueRef(item)?.toLowerCase();
        return Boolean(issueRef && requestedKeys.has(issueRef));
      })
    : project.allItems;

  const result: GitHubProjectWorkspaceSyncResult = {
    workspace_id: workspace.id,
    workspace_slug: workspace.slug,
    project_owner: workspace.github_project_owner,
    project_number: workspace.github_project_number,
    project_title: project.title,
    dry_run: Boolean(options.dryRun),
    selection: requestedIssueRefs ? 'targeted' : 'all',
    requested_issue_refs: requestedIssueRefs ?? [],
    scanned_items: project.allItems.length,
    selected_items: selectedItems.length,
    imported: 0,
    updated: 0,
    moved: 0,
    skipped: 0,
    skipped_closed: 0,
    status_reconciled: 0,
    upstream_drift_warnings: 0,
    needs_evidence: 0,
    readiness_reset: 0,
    tombstones: 0,
    sync_run_id: options.syncRunId?.trim() || uuidv4(),
    read_at: options.readAt?.trim() || new Date().toISOString(),
    read_complete: true,
    stale_repos: [],
    removed_from_project: 0,
    errors: [],
    details: [],
  };

  // Section 3.2: a truncated or failed page changes nothing at all. Every card
  // stays as it is, the skip is logged, and every repo on the board is STALE.
  if (project.read && !project.read.complete) {
    result.read_complete = false;
    result.stale_repos = listWorkspaceRepos(workspace.id, project.allItems);
    result.skipped += selectedItems.length;
    result.details.push({
      action: 'skip',
      reason: `incomplete Project read (${project.read.reason ?? 'unknown reason'}); no card was changed and the repos are marked Sync STALE`,
    });
    return result;
  }

  const pullRequestEvidence = collectPullRequestEvidence(project.allItems);
  const seenProjectItemIds = new Set<string>();
  // Cards matched to an item in this read, by any key (item id or repo/issue).
  const seenTaskIds = new Set<string>();

  for (const item of selectedItems) {
    const itemContent = item.content;
    const isArchived = item.isArchived;
    if (!isArchived && !itemContent) {
      // A 403 or permission-redacted item: its repo is unknown, so the read is
      // not complete for any repo on this board.
      result.read_complete = false;
      result.stale_repos = listWorkspaceRepos(workspace.id, project.allItems);
      result.skipped += 1;
      result.details.push({
        action: 'skip',
        reason: 'redacted or inaccessible Project item (403); no card changed and the board is marked Sync STALE',
      });
      continue;
    }
    const typename = itemContent?.__typename;
    if (!isArchived && typename === 'Issue' && item.id) {
      seenProjectItemIds.add(item.id);
    }
    if (isArchived || !itemContent || typename !== 'Issue') {
      result.skipped += 1;
      result.details.push({
        action: 'skip',
        reason: isArchived
          ? 'archived project item'
          : typename === 'PullRequest'
            ? 'pull request: never a card, used only as evidence for the issue it closes'
            : 'not a GitHub issue',
      });
      continue;
    }

    const content = itemContent;
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
    if (existing) {
      seenTaskIds.add(existing.id);
    }

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

    // Section 3.1: an older read never overwrites a newer one for the same
    // card. The same read again is allowed and gives the same card.
    if (existing?.github_last_read_at && result.read_at < existing.github_last_read_at) {
      result.skipped += 1;
      result.details.push({
        action: 'skip',
        issue: issueRef,
        task_id: existing.id,
        reason: `stale read: read at ${result.read_at} is older than the last applied read ${existing.github_last_read_at}; nothing changed`,
      });
      continue;
    }

    const closeEvidence = [
      ...extractCloseEvidence(content),
      ...(pullRequestEvidence.get(issueRef.toLowerCase()) ?? []),
    ];

    if (options.dryRun) {
      if (existing) {
        const reconciliation = reconcileGitHubProjectStatus({
          currentStatus: existing.status,
          issueClosed: content.closed,
          projectStatus,
          evidence: closeEvidence,
        });
        const refresh = planExistingTaskRefresh(existing, preview, reconciliation.local_status ?? existing.status);
        let wouldTombstone;
        try {
          wouldTombstone = recordFieldClears({
            taskId: existing.id,
            before: refresh.before,
            after: refresh.after,
            source: tombstoneSourceForGitHubSync(owner, repo, issueNumber, result.sync_run_id),
            allowedFields: new Set(refresh.plan.explicit_clears),
            context: `GitHub Project sync dry run ${issueRef}`,
            dryRun: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown sync failure';
          result.errors.push(`${issueRef}: ${message}`);
          result.details.push({ action: 'error', issue: issueRef, task_id: existing.id, reason: message });
          continue;
        }
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
        if (reconciliation.needs_evidence) {
          result.needs_evidence += 1;
          result.details.push({
            action: 'status_reconcile',
            issue: issueRef,
            task_id: existing.id,
            reason: reconciliation.drift_warning,
          });
        }
        pushLocalOwnedDrift(result, issueRef, existing.id, refresh.plan);
        pushReadinessReset(result, issueRef, existing.id, refresh.readinessReset);
        for (const tombstone of wouldTombstone) {
          result.tombstones += 1;
          result.details.push({
            action: 'tombstone',
            issue: issueRef,
            task_id: existing.id,
            field: tombstone.field,
            reason: `would write tombstone for ${tombstone.field} (dry run; nothing persisted)`,
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
            evidence: closeEvidence,
          });
          const reconciledStatus = reconciliation.local_status ?? existing.status;
          const reconciledStatusChanged = reconciledStatus !== existing.status;
          const refresh = planExistingTaskRefresh(existing, preview, reconciledStatus);
          const patch = refresh.plan.update;
          // Merged identity: an upstream item without a Project Item ID must
          // not null out the stored one (section 3, rule 2).
          const mergedSource = normalizeGitHubSourceIdentity(patch.github_source) ?? source;
          // Same transaction as the UPDATE below: any clear outside the
          // explicit upstream signal throws and rolls the whole row back.
          const tombstones = recordFieldClears({
            taskId: existing.id,
            before: refresh.before,
            after: refresh.after,
            source: tombstoneSourceForGitHubSync(owner, repo, issueNumber, result.sync_run_id),
            allowedFields: new Set(refresh.plan.explicit_clears),
            context: `GitHub Project sync ${issueRef}`,
          });

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
                 sync_flags = ?,
                 github_last_read_at = ?,
                 github_missing_reads = 0,
                 updated_at = ?
             WHERE id = ?`,
            [
              patch.title,
              patch.description ?? null,
              (patch.priority ?? existing.priority) as TaskPriority,
              workspace.id,
              preview.business_id,
              mergedSource.repo_owner,
              mergedSource.repo_name,
              mergedSource.issue_number,
              mergedSource.issue_url,
              mergedSource.project_item_id ?? null,
              serializeDispatchMetadata(patch.dispatch_metadata),
              reconciledStatus,
              serializeSyncFlags({
                needs_evidence: reconciliation.needs_evidence ? reconciliation.drift_warning : undefined,
                drift: refresh.plan.local_owned_drift.length > 0 ? refresh.plan.local_owned_drift : undefined,
                sync_run_id: result.sync_run_id,
                flagged_at: now,
              }),
              result.read_at,
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
          if (reconciliation.needs_evidence) {
            // Never silent: the card keeps its column, and its activity log
            // shows why it did not move.
            run(
              `INSERT INTO events (id, type, task_id, message, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                uuidv4(),
                'task_needs_evidence',
                existing.id,
                `GitHub Project sync: ${issueRef} ${reconciliation.drift_warning ?? 'needs evidence'}`,
                JSON.stringify({
                  project_owner: workspace.github_project_owner,
                  project_number: workspace.github_project_number,
                  source: issueRef,
                  upstream_status: reconciliation.upstream_status ?? null,
                  issue_closed: Boolean(content.closed),
                  sync_run_id: result.sync_run_id,
                }),
                now,
              ]
            );
            result.needs_evidence += 1;
            result.details.push({
              action: 'status_reconcile',
              issue: issueRef,
              task_id: existing.id,
              reason: reconciliation.drift_warning,
            });
          }
          pushLocalOwnedDrift(result, issueRef, existing.id, refresh.plan);
          pushReadinessReset(result, issueRef, existing.id, refresh.readinessReset);
          for (const tombstone of tombstones) {
            result.tombstones += 1;
            result.details.push({
              action: 'tombstone',
              issue: issueRef,
              task_id: existing.id,
              field: tombstone.field,
              reason: `cleared ${tombstone.field} on the explicit upstream MCK-CLEAR signal; tombstone written`,
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
             source_project_item_id, dispatch_metadata, github_last_read_at, created_at, updated_at
           )
           VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            serializeDispatchMetadata(buildImportDispatchMetadata(preview.dispatch_metadata)),
            result.read_at,
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

  if (result.selection === 'all' && result.read_complete && result.errors.length === 0) {
    applyTwoReadRemoval(workspace, seenProjectItemIds, seenTaskIds, result, Boolean(options.dryRun));
  }

  return result;
}
