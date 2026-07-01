import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';

const DEFAULT_REPLAY_TTL_SECONDS = 86_400;

export interface RegisterWebhookDeliveryInput {
  deliveryId?: string | null;
  taskId?: string | null;
  attemptId?: string | null;
  eventType: string;
  status?: 'accepted' | 'rejected' | 'schema_invalid' | 'signature_invalid';
  reason?: string | null;
  now?: Date;
}

export interface RegisterWebhookDeliveryResult {
  ok: boolean;
  duplicate: boolean;
  delivery_id?: string;
  reason?: string;
}

function replayTtlSeconds() {
  const parsed = Number(process.env.MCK_WEBHOOK_REPLAY_TTL_SECONDS || DEFAULT_REPLAY_TTL_SECONDS);
  if (!Number.isFinite(parsed) || parsed < 300) return DEFAULT_REPLAY_TTL_SECONDS;
  return Math.min(parsed, 60 * 60 * 24 * 30);
}

export function registerWebhookCallbackDelivery(input: RegisterWebhookDeliveryInput): RegisterWebhookDeliveryResult {
  if (!input.deliveryId || !input.deliveryId.trim()) {
    return { ok: false, duplicate: false, reason: 'missing_delivery_id' };
  }

  const deliveryId = input.deliveryId.trim();
  const existing = queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  );
  if (existing) {
    run(
      `INSERT INTO webhook_callback_deliveries (id, delivery_id, task_id, attempt_id, event_type, status, reason, expires_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        `${deliveryId}:duplicate:${uuidv4()}`,
        input.taskId || null,
        input.attemptId || null,
        input.eventType,
        'duplicate',
        existing.status,
        new Date((input.now || new Date()).getTime() + replayTtlSeconds() * 1000).toISOString(),
        (input.now || new Date()).toISOString(),
      ]
    );
    return { ok: true, duplicate: true, delivery_id: deliveryId, reason: existing.status };
  }

  const now = input.now || new Date();
  run(
    `INSERT INTO webhook_callback_deliveries (id, delivery_id, task_id, attempt_id, event_type, status, reason, expires_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      deliveryId,
      input.taskId || null,
      input.attemptId || null,
      input.eventType,
      input.status || 'accepted',
      input.reason || null,
      new Date(now.getTime() + replayTtlSeconds() * 1000).toISOString(),
      now.toISOString(),
    ]
  );

  return { ok: true, duplicate: false, delivery_id: deliveryId };
}

export function pruneWebhookCallbackDeliveries({ dryRun = true, now = new Date() } = {}) {
  const expired = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM webhook_callback_deliveries WHERE expires_at < ?',
    [now.toISOString()]
  )?.count ?? 0;

  if (!dryRun && expired > 0) {
    run('DELETE FROM webhook_callback_deliveries WHERE expires_at < ?', [now.toISOString()]);
  }

  return { dry_run: dryRun, expired, deleted: dryRun ? 0 : expired };
}


export function getWebhookCallbackDeliveries({ limit = 100 }: { limit?: number } = {}) {
  return queryAll<{
    id: string;
    delivery_id: string;
    task_id: string | null;
    attempt_id: string | null;
    event_type: string;
    status: string;
    reason: string | null;
    expires_at: string;
    received_at: string;
    created_at: string;
  }>(
    `SELECT id, delivery_id, task_id, attempt_id, event_type, status, reason, expires_at, received_at, created_at
     FROM webhook_callback_deliveries
     ORDER BY received_at DESC
     LIMIT ?`,
    [Math.min(Math.max(limit, 1), 250)]
  );
}
