import { queryAll, queryOne, run } from '@/lib/db';
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

  const webhookConfigured = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM agents
     WHERE runtime_type = 'webhook'
       AND dispatch_enabled = 1
       AND runtime_config IS NOT NULL
       AND (runtime_config LIKE '%webhook_url%' OR runtime_config LIKE '%url%')`
  )?.count ?? 0;
  const webhookNeedsConfig = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM agents
     WHERE runtime_type = 'webhook'
       AND dispatch_enabled = 1
       AND (runtime_config IS NULL OR (runtime_config NOT LIKE '%webhook_url%' AND runtime_config NOT LIKE '%url%'))`
  )?.count ?? 0;

  return {
    ok: webhookNeedsConfig === 0,
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
  };
}
