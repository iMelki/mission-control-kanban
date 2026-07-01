import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { getWebhookUrl, parseAgentRuntimeConfig } from '@/lib/agent-runtimes';
import type { AgentRuntimeType, DispatchAttemptStatus } from '@/lib/types';

export interface DispatchRetentionPolicy {
  succeeded_days: number;
  failed_days: number;
  manual_days: number;
  batch_size: number;
}

export interface DispatchRetentionResult {
  policy: DispatchRetentionPolicy;
  dry_run: boolean;
  deleted: number;
  candidates: number;
}

export interface DispatchFailureRateTrendPoint {
  date: string;
  runtime_type: AgentRuntimeType;
  total: number;
  failed: number;
  timeout: number;
  failure_rate: number;
}

export interface DispatchFailureThresholdPolicy {
  warn_rate: number;
  critical_rate: number;
  min_attempts: number;
  lookback_days: number;
}

export interface DispatchFailureThresholdAlert {
  runtime_type: AgentRuntimeType;
  level: 'warning' | 'critical';
  failure_rate: number;
  failed: number;
  timeout: number;
  total: number;
  window_days: number;
  message: string;
}

export interface RuntimeMigrationDiffRow {
  id: string;
  agent_id: string;
  name: string;
  workspace_id: string;
  before: { runtime_type: string | null; dispatch_enabled: boolean; runtime_config: string | null };
  after: { runtime_type: AgentRuntimeType; dispatch_enabled: boolean; runtime_config: string | null };
  changed_fields: string[];
  reason: string;
}

export function getDispatchRetentionPolicy(env: Record<string, string | undefined> = process.env): DispatchRetentionPolicy {
  const numberFromEnv = (key: string, fallback: number, min: number, max: number) => {
    const parsed = Number(env[key]);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.floor(parsed), min), max);
  };

  return {
    succeeded_days: numberFromEnv('MCK_DISPATCH_RETENTION_SUCCEEDED_DAYS', 30, 1, 3650),
    failed_days: numberFromEnv('MCK_DISPATCH_RETENTION_FAILED_DAYS', 90, 1, 3650),
    manual_days: numberFromEnv('MCK_DISPATCH_RETENTION_MANUAL_DAYS', 30, 1, 3650),
    batch_size: numberFromEnv('MCK_DISPATCH_RETENTION_BATCH_SIZE', 500, 1, 5000),
  };
}

function cutoffIso(days: number, now = Date.now()) {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

function statusCutoff(status: DispatchAttemptStatus, policy: DispatchRetentionPolicy, now?: number) {
  if (status === 'success') return cutoffIso(policy.succeeded_days, now);
  if (status === 'manual' || status === 'skipped') return cutoffIso(policy.manual_days, now);
  if (status === 'failed' || status === 'timeout') return cutoffIso(policy.failed_days, now);
  return null;
}

export function pruneDispatchAttempts({
  dryRun = true,
  now = Date.now(),
  policy = getDispatchRetentionPolicy(),
}: {
  dryRun?: boolean;
  now?: number;
  policy?: DispatchRetentionPolicy;
} = {}): DispatchRetentionResult {
  const statuses: DispatchAttemptStatus[] = ['success', 'manual', 'skipped', 'failed', 'timeout'];
  const candidateIds: string[] = [];

  for (const status of statuses) {
    const cutoff = statusCutoff(status, policy, now);
    if (!cutoff) continue;
    const rows = queryAll<{ id: string }>(
      `SELECT id FROM task_dispatch_attempts
       WHERE status = ? AND created_at < ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [status, cutoff, policy.batch_size]
    );
    candidateIds.push(...rows.map((row) => row.id));
    if (candidateIds.length >= policy.batch_size) break;
  }

  const limited = candidateIds.slice(0, policy.batch_size);
  if (!dryRun && limited.length > 0) {
    const placeholders = limited.map(() => '?').join(', ');
    run(`DELETE FROM task_dispatch_attempts WHERE id IN (${placeholders})`, limited);
  }

  return {
    policy,
    dry_run: dryRun,
    candidates: limited.length,
    deleted: dryRun ? 0 : limited.length,
  };
}

export interface DispatchRetryBudgetResult {
  allowed: boolean;
  reason?: 'missing_confirmation' | 'rate_limited' | 'too_many_attempts';
  retry_after_seconds?: number;
}

const retryBuckets = new Map<string, number[]>();

export function getDispatchRetryBudgetBucketCount() {
  return retryBuckets.size;
}

export function checkDispatchRetryBudget({
  taskId,
  runtimeType,
  confirm,
  attemptNumber,
  now = Date.now(),
  windowMs = 60_000,
  maxPerWindow = 5,
}: {
  taskId: string;
  runtimeType: AgentRuntimeType;
  confirm?: boolean;
  attemptNumber: number;
  now?: number;
  windowMs?: number;
  maxPerWindow?: number;
}): DispatchRetryBudgetResult {
  if (attemptNumber > 1 && !confirm) {
    return { allowed: false, reason: 'missing_confirmation' };
  }
  if (attemptNumber >= 5 && !confirm) {
    return { allowed: false, reason: 'too_many_attempts' };
  }

  const bucketKey = `${runtimeType}:${taskId}`;
  const existing = retryBuckets.get(bucketKey) ?? [];
  const fresh = existing.filter((timestamp) => now - timestamp < windowMs);
  if (fresh.length >= maxPerWindow) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - fresh[0])) / 1000));
    retryBuckets.set(bucketKey, fresh);
    return { allowed: false, reason: 'rate_limited', retry_after_seconds: retryAfter };
  }

  fresh.push(now);
  retryBuckets.set(bucketKey, fresh);
  return { allowed: true };
}

function normalizeRuntimeType(value: string | null | undefined): AgentRuntimeType {
  return value === 'openclaw' || value === 'webhook' ? value : 'manual';
}

export function getDispatchFailureRateTrends({
  days = 14,
  now = Date.now(),
}: {
  days?: number;
  now?: number;
} = {}): DispatchFailureRateTrendPoint[] {
  const boundedDays = Math.min(Math.max(Math.floor(days), 1), 90);
  const rows = queryAll<{
    date: string;
    runtime_type: string | null;
    status: DispatchAttemptStatus;
    count: number;
  }>(
    `SELECT substr(created_at, 1, 10) as date,
            runtime_type,
            status,
            COUNT(*) as count
     FROM task_dispatch_attempts
     WHERE created_at >= ?
     GROUP BY substr(created_at, 1, 10), runtime_type, status
     ORDER BY date ASC, runtime_type ASC`,
    [cutoffIso(boundedDays, now)]
  );

  const grouped = new Map<string, DispatchFailureRateTrendPoint>();
  for (const row of rows) {
    const runtimeType = normalizeRuntimeType(row.runtime_type);
    const key = `${row.date}:${runtimeType}`;
    const existing = grouped.get(key) ?? {
      date: row.date,
      runtime_type: runtimeType,
      total: 0,
      failed: 0,
      timeout: 0,
      failure_rate: 0,
    };
    const count = Number(row.count) || 0;
    existing.total += count;
    if (row.status === 'failed') existing.failed += count;
    if (row.status === 'timeout') existing.timeout += count;
    existing.failure_rate = existing.total > 0
      ? Number(((existing.failed + existing.timeout) / existing.total).toFixed(4))
      : 0;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.runtime_type.localeCompare(b.runtime_type);
  });
}

export function getDispatchFailureThresholdPolicy(env: Record<string, string | undefined> = process.env): DispatchFailureThresholdPolicy {
  const rate = (key: string, fallback: number) => {
    const parsed = Number(env[key]);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : fallback;
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const parsed = Number(env[key]);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
  };
  return {
    warn_rate: rate('MCK_DISPATCH_FAILURE_WARN_RATE', 0.25),
    critical_rate: rate('MCK_DISPATCH_FAILURE_CRITICAL_RATE', 0.5),
    min_attempts: integer('MCK_DISPATCH_FAILURE_MIN_ATTEMPTS', 5, 1, 10000),
    lookback_days: integer('MCK_DISPATCH_FAILURE_LOOKBACK_DAYS', 7, 1, 90),
  };
}

export function getDispatchFailureThresholdAlerts({
  now = Date.now(),
  policy = getDispatchFailureThresholdPolicy(),
}: {
  now?: number;
  policy?: DispatchFailureThresholdPolicy;
} = {}): DispatchFailureThresholdAlert[] {
  const rows = queryAll<{ runtime_type: string | null; status: DispatchAttemptStatus; count: number }>(
    `SELECT runtime_type, status, COUNT(*) as count
     FROM task_dispatch_attempts
     WHERE created_at >= ?
     GROUP BY runtime_type, status`,
    [cutoffIso(policy.lookback_days, now)]
  );
  const grouped = new Map<AgentRuntimeType, { total: number; failed: number; timeout: number }>();
  for (const row of rows) {
    const runtimeType = normalizeRuntimeType(row.runtime_type);
    const existing = grouped.get(runtimeType) ?? { total: 0, failed: 0, timeout: 0 };
    const count = Number(row.count) || 0;
    existing.total += count;
    if (row.status === 'failed') existing.failed += count;
    if (row.status === 'timeout') existing.timeout += count;
    grouped.set(runtimeType, existing);
  }
  return Array.from(grouped.entries()).flatMap(([runtime_type, counts]) => {
    if (counts.total < policy.min_attempts) return [];
    const failureRate = (counts.failed + counts.timeout) / counts.total;
    if (failureRate < policy.warn_rate) return [];
    const level: 'warning' | 'critical' = failureRate >= policy.critical_rate ? 'critical' : 'warning';
    return [{
      runtime_type,
      level,
      failure_rate: Number(failureRate.toFixed(4)),
      failed: counts.failed,
      timeout: counts.timeout,
      total: counts.total,
      window_days: policy.lookback_days,
      message: `${runtime_type} dispatch failure rate is ${Math.round(failureRate * 100)}% over ${counts.total} attempts in ${policy.lookback_days} day(s).`,
    }];
  }).sort((a, b) => b.failure_rate - a.failure_rate);
}

export function getRuntimeHealthSummary() {
  const agentCounts = queryAll<{ runtime_type: string; dispatch_enabled: number; count: number }>(
    `SELECT runtime_type, dispatch_enabled, COUNT(*) as count
     FROM agents
     GROUP BY runtime_type, dispatch_enabled`
  );
  const attemptCounts = queryAll<{ runtime_type: string; status: string; count: number }>(
    `SELECT runtime_type, status, COUNT(*) as count
     FROM task_dispatch_attempts
     GROUP BY runtime_type, status`
  );
  const latestFailure = queryOne<{ created_at: string; runtime_type: string; error_message?: string | null }>(
    `SELECT created_at, runtime_type, error_message
     FROM task_dispatch_attempts
     WHERE status IN ('failed', 'timeout')
     ORDER BY created_at DESC
     LIMIT 1`
  );

  const webhookAgents = queryAll<{ runtime_config: string | null }>(
    `SELECT runtime_config FROM agents
     WHERE runtime_type = 'webhook'
       AND dispatch_enabled = 1`
  );
  const webhookConfigured = webhookAgents.filter((agent) => getWebhookUrl(parseAgentRuntimeConfig(agent.runtime_config), process.env)).length;
  const webhookNeedsConfig = webhookAgents.length - webhookConfigured;
  const failureThresholdPolicy = getDispatchFailureThresholdPolicy();
  const failureThresholdAlerts = getDispatchFailureThresholdAlerts({ policy: failureThresholdPolicy });

  return {
    ok: webhookNeedsConfig === 0 && !failureThresholdAlerts.some((alert) => alert.level === 'critical'),
    generated_at: new Date().toISOString(),
    callback_signature: {
      outbound_secret_configured: Boolean(process.env.MCK_WEBHOOK_SIGNATURE_SECRET),
      inbound_secret_configured: Boolean(process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET),
    },
    webhook: {
      configured: webhookConfigured,
      needs_config: webhookNeedsConfig,
    },
    agent_counts: agentCounts,
    attempt_counts: attemptCounts,
    latest_failure: latestFailure
      ? {
        created_at: latestFailure.created_at,
        runtime_type: latestFailure.runtime_type,
        reason: latestFailure.error_message ? latestFailure.error_message.slice(0, 160) : 'unknown',
      }
      : null,
    failure_rate_trends: getDispatchFailureRateTrends(),
    failure_threshold_policy: failureThresholdPolicy,
    failure_threshold_alerts: failureThresholdAlerts,
  };
}


export function recordRuntimeMaintenanceRun({
  runType,
  dryRun,
  status,
  deletedCount = 0,
  summary,
  errorMessage,
}: {
  runType: string;
  dryRun: boolean;
  status: 'success' | 'failed';
  deletedCount?: number;
  summary?: unknown;
  errorMessage?: string;
}) {
  run(
    `INSERT INTO runtime_maintenance_runs (id, run_type, dry_run, status, deleted_count, summary, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), runType, dryRun ? 1 : 0, status, deletedCount, summary ? JSON.stringify(summary) : null, errorMessage || null, new Date().toISOString()]
  );
}

export function pruneDispatchAttemptsWithAudit(options: Parameters<typeof pruneDispatchAttempts>[0] = {}) {
  try {
    const result = pruneDispatchAttempts(options);
    recordRuntimeMaintenanceRun({
      runType: 'dispatch_attempt_retention',
      dryRun: result.dry_run,
      status: 'success',
      deletedCount: result.deleted,
      summary: result,
    });
    return result;
  } catch (error) {
    recordRuntimeMaintenanceRun({
      runType: 'dispatch_attempt_retention',
      dryRun: options?.dryRun ?? true,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function getDispatchFailureQueue({ limit = 100, workspaceId }: { limit?: number; workspaceId?: string } = {}) {
  const params: unknown[] = [];
  let workspaceFilter = '';
  if (workspaceId) {
    workspaceFilter = 'AND t.workspace_id = ?';
    params.push(workspaceId);
  }
  params.push(Math.min(Math.max(limit, 1), 250));
  return queryAll<{
    id: string;
    task_id: string;
    task_title: string;
    workspace_id: string;
    agent_id: string | null;
    agent_name: string | null;
    runtime_type: string;
    status: string;
    attempt_number: number;
    message: string;
    error_message: string | null;
    http_status: number | null;
    webhook_url: string | null;
    created_at: string;
  }>(
    `SELECT d.id, d.task_id, t.title as task_title, t.workspace_id,
            d.agent_id, a.name as agent_name, d.runtime_type, d.status,
            d.attempt_number, d.message, d.error_message, d.http_status,
            d.webhook_url, d.created_at
     FROM task_dispatch_attempts d
     LEFT JOIN tasks t ON t.id = d.task_id
     LEFT JOIN agents a ON a.id = d.agent_id
     WHERE d.status IN ('failed', 'timeout') ${workspaceFilter}
     ORDER BY d.created_at DESC
     LIMIT ?`,
    params
  );
}

export function getRuntimeAudit() {
  const agents = queryAll<{
    id: string;
    name: string;
    role: string;
    runtime_type: string | null;
    runtime_config: string | null;
    dispatch_enabled: number | null;
    workspace_id: string;
    status: string;
  }>('SELECT id, name, role, runtime_type, runtime_config, dispatch_enabled, workspace_id, status FROM agents ORDER BY workspace_id, name ASC');

  const rows = agents.map((agent) => {
    const runtimeType = agent.runtime_type === 'openclaw' || agent.runtime_type === 'webhook' ? agent.runtime_type : 'manual';
    const dispatchEnabled = Boolean(agent.dispatch_enabled);
    const config = parseAgentRuntimeConfig(agent.runtime_config);
    const needsConfig = runtimeType === 'webhook' && dispatchEnabled && !getWebhookUrl(config, process.env);
    const dispatchBlocked = runtimeType === 'manual' || !dispatchEnabled || needsConfig;
    const recommended_action = needsConfig
      ? 'add_webhook_url_env_config'
      : runtimeType === 'manual'
        ? 'manual_handoff_ok'
        : !dispatchEnabled
          ? 'enable_dispatch_when_operator_approved'
          : 'none';
    return {
      ...agent,
      runtime_type: runtimeType,
      dispatch_enabled: dispatchEnabled,
      needs_config: needsConfig,
      dispatch_blocked: dispatchBlocked,
      reason: needsConfig
        ? 'Webhook dispatch is enabled but no webhook URL is configured.'
        : runtimeType === 'manual'
          ? 'Manual agents require copy/paste handoff.'
          : !dispatchEnabled
            ? 'Auto-dispatch is disabled for this agent.'
            : 'Ready for runtime dispatch.',
      recommended_action,
    };
  });

  const summary = rows.reduce<Record<string, number>>((acc, row) => {
    acc.total = (acc.total || 0) + 1;
    acc[row.runtime_type] = (acc[row.runtime_type] || 0) + 1;
    if (row.dispatch_blocked) acc.dispatch_blocked = (acc.dispatch_blocked || 0) + 1;
    if (row.needs_config) acc.needs_config = (acc.needs_config || 0) + 1;
    return acc;
  }, {});

  return { generated_at: new Date().toISOString(), summary, agents: rows };
}

export function getRuntimeMigrationDiff({ agentIds }: { agentIds?: string[] } = {}): RuntimeMigrationDiffRow[] {
  const params: unknown[] = [];
  const filter = agentIds?.length ? `WHERE id IN (${agentIds.map(() => '?').join(', ')})` : '';
  if (agentIds?.length) params.push(...agentIds);
  const agents = queryAll<{
    id: string;
    name: string;
    workspace_id: string;
    runtime_type: string | null;
    runtime_config: string | null;
    dispatch_enabled: number | null;
  }>(`SELECT id, name, workspace_id, runtime_type, runtime_config, dispatch_enabled FROM agents ${filter} ORDER BY workspace_id, name ASC`, params);

  return agents.flatMap((agent) => {
    const beforeType = agent.runtime_type;
    const runtimeType = beforeType === 'openclaw' || beforeType === 'webhook' ? beforeType : 'manual';
    let nextDispatchEnabled = Boolean(agent.dispatch_enabled);
    let reason = '';
    if (runtimeType === 'manual' && nextDispatchEnabled) {
      nextDispatchEnabled = false;
      reason = 'Manual runtime cannot auto-dispatch.';
    }
    if (runtimeType === 'webhook' && nextDispatchEnabled && !getWebhookUrl(parseAgentRuntimeConfig(agent.runtime_config), process.env)) {
      nextDispatchEnabled = false;
      reason = 'Webhook dispatch enabled but no resolvable URL exists.';
    }
    if (beforeType !== runtimeType) reason = 'Unknown runtime normalized to manual handoff.';

    const changedFields = [
      beforeType !== runtimeType ? 'runtime_type' : '',
      Boolean(agent.dispatch_enabled) !== nextDispatchEnabled ? 'dispatch_enabled' : '',
    ].filter(Boolean);
    if (changedFields.length === 0) return [];

    return [{
      id: agent.id,
      agent_id: agent.id,
      name: agent.name,
      workspace_id: agent.workspace_id,
      before: {
        runtime_type: beforeType,
        dispatch_enabled: Boolean(agent.dispatch_enabled),
        runtime_config: agent.runtime_config,
      },
      after: {
        runtime_type: runtimeType,
        dispatch_enabled: nextDispatchEnabled,
        runtime_config: agent.runtime_config,
      },
      changed_fields: changedFields,
      reason,
    }];
  });
}

export function applyRuntimeAuditMigration({ dryRun = true, agentIds }: { dryRun?: boolean; agentIds?: string[] } = {}) {
  const diff = getRuntimeMigrationDiff({ agentIds });
  if (!dryRun) {
    const now = new Date().toISOString();
    for (const row of diff) {
      run(
        'UPDATE agents SET runtime_type = ?, dispatch_enabled = ?, updated_at = ? WHERE id = ?',
        [row.after.runtime_type, row.after.dispatch_enabled ? 1 : 0, now, row.agent_id]
      );
    }
  }
  return {
    dry_run: dryRun,
    candidates: diff.length,
    applied: dryRun ? 0 : diff.length,
    diff,
    description: 'Normalize unsafe/unknown runtime states to a safe runtime with explicit dispatch gating.',
  };
}
