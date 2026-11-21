import { v4 as uuidv4 } from 'uuid';
import { queryAll, run } from './db';
import { normalizeDispatchMetadata, type DispatchMetadata } from './dispatch-contract';
import type { GitHubSourceIdentity, TaskFieldTombstone } from './types';

/**
 * Field-level clear tracking for docs/SYNC_FIELD_AUTHORITY.md section 4.
 *
 * A clear is any change that takes a dispatch contract field, a
 * `github_source` subfield or the task body from a non-empty value to empty.
 * Every clear writes one append-only tombstone in the same transaction as the
 * clear. A code path that would clear a field without a tombstone source is
 * refused (`SilentClearRefusedError`) and must leave the stored value alone.
 */

export const DISPATCH_METADATA_TOMBSTONE_KEYS = [
  'source_issue_url',
  'target_repo',
  'project_workstream',
  'allowed_file_scope',
  'acceptance_criteria',
  'test_requirements',
  'risk_level',
  'readiness',
  'review_mode',
  'impact',
  'rollback_plan',
  'safety_rules',
] as const satisfies ReadonlyArray<keyof DispatchMetadata>;

export const GITHUB_SOURCE_TOMBSTONE_KEYS = [
  'repo_owner',
  'repo_name',
  'issue_number',
  'issue_url',
  'project_item_id',
] as const satisfies ReadonlyArray<keyof GitHubSourceIdentity>;

export interface TaskFieldSnapshot {
  description?: string | null;
  dispatch_metadata?: DispatchMetadata | null;
  github_source?: Partial<GitHubSourceIdentity> | null;
}

export interface FieldClear {
  field: string;
  old_value: unknown;
}

export interface TombstoneSource {
  /** `mck:user`, `agent:<id>`, or `github:<owner>/<repo>#<n>`. */
  source: string;
  sync_run_id?: string | null;
}

export class SilentClearRefusedError extends Error {
  readonly fields: string[];

  constructor(fields: string[], context: string) {
    super(`Refused to clear ${fields.join(', ')} without a tombstone (${context}). Local values are kept.`);
    this.name = 'SilentClearRefusedError';
    this.fields = fields;
  }
}

function isEmptyFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (typeof value === 'number') {
    return value === 0 || Number.isNaN(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isEmptyFieldValue(item));
  }
  return false;
}

/** Every field that goes from non-empty in `before` to empty in `after`. */
export function computeFieldClears(before: TaskFieldSnapshot, after: TaskFieldSnapshot): FieldClear[] {
  const clears: FieldClear[] = [];

  if (!isEmptyFieldValue(before.description) && isEmptyFieldValue(after.description)) {
    clears.push({ field: 'description', old_value: before.description });
  }

  const beforeMetadata = normalizeDispatchMetadata(before.dispatch_metadata ?? undefined) as Record<string, unknown> | undefined;
  const afterMetadata = normalizeDispatchMetadata(after.dispatch_metadata ?? undefined) as Record<string, unknown> | undefined;
  for (const key of DISPATCH_METADATA_TOMBSTONE_KEYS) {
    const oldValue = beforeMetadata?.[key];
    if (!isEmptyFieldValue(oldValue) && isEmptyFieldValue(afterMetadata?.[key])) {
      clears.push({ field: `dispatch_metadata.${key}`, old_value: oldValue });
    }
  }

  const beforeSource = (before.github_source ?? {}) as Record<string, unknown>;
  const afterSource = (after.github_source ?? {}) as Record<string, unknown>;
  for (const key of GITHUB_SOURCE_TOMBSTONE_KEYS) {
    const oldValue = beforeSource[key];
    if (!isEmptyFieldValue(oldValue) && isEmptyFieldValue(afterSource[key])) {
      clears.push({ field: `github_source.${key}`, old_value: oldValue });
    }
  }

  return clears;
}

export function buildTombstones(
  taskId: string,
  clears: FieldClear[],
  source: TombstoneSource,
  clearedAt: Date = new Date(),
): TaskFieldTombstone[] {
  const iso = clearedAt.toISOString();
  return clears.map((clear) => ({
    id: uuidv4(),
    task_id: taskId,
    field: clear.field,
    old_value: clear.old_value,
    source: source.source,
    sync_run_id: source.sync_run_id ?? null,
    cleared_at: iso,
  }));
}

/**
 * Compute the clears between two snapshots and write their tombstones.
 * Call it inside the same `transaction()` as the UPDATE that applies `after`.
 *
 * - No clears: returns `[]` and writes nothing.
 * - Clears and no `source`, or a clear outside `allowedFields`: throws
 *   `SilentClearRefusedError`, so the surrounding transaction rolls back and
 *   the stored value stays.
 * - `dryRun`: returns the tombstones it would write and persists none.
 */
export function recordFieldClears(input: {
  taskId: string;
  before: TaskFieldSnapshot;
  after: TaskFieldSnapshot;
  source?: TombstoneSource;
  /** When set, only these field names may be cleared. */
  allowedFields?: ReadonlySet<string>;
  context: string;
  dryRun?: boolean;
  clearedAt?: Date;
}): TaskFieldTombstone[] {
  const clears = computeFieldClears(input.before, input.after);
  if (clears.length === 0) {
    return [];
  }

  const refused: string[] = [];
  for (const clear of clears) {
    if (!input.source || (input.allowedFields && !input.allowedFields.has(clear.field))) {
      refused.push(clear.field);
    }
  }
  if (refused.length > 0) {
    throw new SilentClearRefusedError(refused, input.context);
  }

  const tombstones = buildTombstones(input.taskId, clears, input.source as TombstoneSource, input.clearedAt);
  if (!input.dryRun) {
    for (const tombstone of tombstones) {
      run(
        `INSERT INTO task_field_tombstones (id, task_id, field, old_value, source, sync_run_id, cleared_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          tombstone.id,
          tombstone.task_id,
          tombstone.field,
          JSON.stringify(tombstone.old_value),
          tombstone.source,
          tombstone.sync_run_id ?? null,
          tombstone.cleared_at,
        ],
      );
    }
  }
  return tombstones;
}

interface TombstoneRow {
  id: string;
  task_id: string;
  field: string;
  old_value: string;
  source: string;
  sync_run_id: string | null;
  cleared_at: string;
}

function parseOldValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function listTaskFieldTombstones(taskId: string): TaskFieldTombstone[] {
  return queryAll<TombstoneRow>(
    `SELECT id, task_id, field, old_value, source, sync_run_id, cleared_at
     FROM task_field_tombstones
     WHERE task_id = ?
     ORDER BY cleared_at ASC, rowid ASC`,
    [taskId],
  ).map((row) => ({ ...row, old_value: parseOldValue(row.old_value) }));
}

/** Who cleared a field through the task API. */
export function tombstoneSourceForTaskApi(updatedByAgentId: string | null | undefined): TombstoneSource {
  const agentId = typeof updatedByAgentId === 'string' ? updatedByAgentId.trim() : '';
  return { source: agentId ? `agent:${agentId}` : 'mck:user' };
}

/** Who cleared a field during a GitHub Project sync run. */
export function tombstoneSourceForGitHubSync(
  owner: string,
  repo: string,
  issueNumber: number,
  syncRunId: string,
): TombstoneSource {
  return { source: `github:${owner}/${repo}#${issueNumber}`, sync_run_id: syncRunId };
}
