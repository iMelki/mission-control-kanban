import { v4 as uuidv4 } from 'uuid';
import type { NextRequest } from 'next/server';
import { queryAll, queryOne, run } from '@/lib/db';

const DEFAULT_REPLAY_TTL_SECONDS = 86_400;
const MAX_CALLBACK_BODY_BYTES = 1024 * 1024;
const CALLBACK_BODY_TOTAL_TIMEOUT_MS = 10_000;
const CALLBACK_BODY_INACTIVITY_TIMEOUT_MS = 2_000;

export class CallbackBodyReadError extends Error {
  constructor(message: string, readonly status: 400 | 408 | 413) {
    super(message);
    this.name = 'CallbackBodyReadError';
  }
}

async function readChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  reason: string
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new CallbackBodyReadError(reason, 408)),
          Math.max(1, timeoutMs)
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function readBoundedCallbackBody(
  request: Pick<NextRequest, 'body' | 'headers'>,
  options: {
    maxBytes?: number;
    totalTimeoutMs?: number;
    inactivityTimeoutMs?: number;
  } = {}
) {
  const maxBytes = options.maxBytes ?? MAX_CALLBACK_BODY_BYTES;
  const totalTimeoutMs = options.totalTimeoutMs ?? CALLBACK_BODY_TOTAL_TIMEOUT_MS;
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? CALLBACK_BODY_INACTIVITY_TIMEOUT_MS;
  const contentLengthHeader = request.headers.get('content-length');
  let contentLength: number | undefined;
  if (contentLengthHeader !== null) {
    if (!/^\d+$/.test(contentLengthHeader.trim())) {
      throw new CallbackBodyReadError('Invalid Content-Length', 400);
    }
    contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength)) {
      throw new CallbackBodyReadError('Invalid Content-Length', 400);
    }
    if (contentLength > maxBytes) {
      throw new CallbackBodyReadError('Callback body exceeds the 1 MiB limit', 413);
    }
  }
  if (!request.body) {
    if (contentLength && contentLength > 0) {
      throw new CallbackBodyReadError('Callback body is shorter than Content-Length', 400);
    }
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  const startedAt = Date.now();
  try {
    for (;;) {
      const remainingTotalMs = totalTimeoutMs - (Date.now() - startedAt);
      if (remainingTotalMs <= 0) {
        throw new CallbackBodyReadError('Callback body total read timeout', 408);
      }
      const totalDeadlineFirst = remainingTotalMs <= inactivityTimeoutMs;
      const result = await readChunkWithTimeout(
        reader,
        Math.min(inactivityTimeoutMs, remainingTotalMs),
        totalDeadlineFirst
          ? 'Callback body total read timeout'
          : 'Callback body inactivity timeout'
      );
      if (result.done) break;
      bytesRead += result.value.byteLength;
      if (bytesRead > maxBytes) {
        throw new CallbackBodyReadError('Callback body exceeds the 1 MiB limit', 413);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (contentLength !== undefined && contentLength !== bytesRead) {
    throw new CallbackBodyReadError('Callback body length does not match Content-Length', 400);
  }
  const bodyBytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // HMAC verification must be over the exact request bytes. TextDecoder's
  // default behavior strips a leading UTF-8 BOM, which would otherwise make
  // the signed bytes differ from the bytes parsed by this endpoint.
  if (
    bodyBytes.byteLength >= 3
    && bodyBytes[0] === 0xef
    && bodyBytes[1] === 0xbb
    && bodyBytes[2] === 0xbf
  ) {
    throw new CallbackBodyReadError('Callback body must not include a UTF-8 BOM', 400);
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bodyBytes);
    const canonicalBytes = new TextEncoder().encode(decoded);
    if (
      canonicalBytes.byteLength !== bodyBytes.byteLength
      || canonicalBytes.some((byte, index) => byte !== bodyBytes[index])
    ) {
      throw new CallbackBodyReadError('Callback body must use canonical UTF-8', 400);
    }
    return decoded;
  } catch (error) {
    if (error instanceof CallbackBodyReadError) throw error;
    throw new CallbackBodyReadError('Callback body must be valid UTF-8', 400);
  }
}

export type WebhookCallbackDeliveryStatus =
  | 'processing'
  | 'accepted'
  | 'duplicate'
  | 'rejected'
  | 'schema_invalid'
  | 'signature_invalid';

export interface RegisterWebhookDeliveryInput {
  deliveryId?: string | null;
  taskId?: string | null;
  attemptId?: string | null;
  payloadHash?: string | null;
  eventType: string;
  status?: Exclude<WebhookCallbackDeliveryStatus, 'processing' | 'duplicate'>;
  reason?: string | null;
  now?: Date;
}

export interface RegisterWebhookDeliveryResult {
  ok: boolean;
  duplicate: boolean;
  delivery_id?: string;
  reason?: string;
  existing_status?: string;
}

export function inspectWebhookCallbackDelivery(deliveryId: string, payloadHash?: string | null) {
  const existing = queryOne<{ status: string; payload_hash: string | null }>(
    'SELECT status, payload_hash FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId.trim()]
  );
  if (!existing) return { exists: false, conflict: false, status: undefined };
  return {
    exists: true,
    conflict: Boolean(payloadHash && existing.payload_hash && payloadHash !== existing.payload_hash),
    status: existing.status,
  };
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
  const existing = queryOne<{ id: string; status: string; payload_hash: string | null }>(
    'SELECT id, status, payload_hash FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  );
  if (existing) {
    const payloadConflict = Boolean(
      input.payloadHash
      && existing.payload_hash
      && input.payloadHash !== existing.payload_hash
    );
    run(
      `INSERT INTO webhook_callback_deliveries (
        id, delivery_id, task_id, attempt_id, event_type, status, payload_hash, reason, expires_at, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        `${deliveryId}:duplicate:${uuidv4()}`,
        input.taskId || null,
        input.attemptId || null,
        input.eventType,
        'duplicate',
        input.payloadHash || null,
        payloadConflict ? 'payload_conflict' : existing.status,
        new Date((input.now || new Date()).getTime() + replayTtlSeconds() * 1000).toISOString(),
        (input.now || new Date()).toISOString(),
      ]
    );
    if (payloadConflict) {
      return {
        ok: false,
        duplicate: true,
        delivery_id: deliveryId,
        reason: 'payload_conflict',
        existing_status: existing.status,
      };
    }
    return {
      ok: true,
      duplicate: true,
      delivery_id: deliveryId,
      reason: existing.status,
      existing_status: existing.status,
    };
  }

  const now = input.now || new Date();
  run(
    `INSERT INTO webhook_callback_deliveries (
      id, delivery_id, task_id, attempt_id, event_type, status, payload_hash, reason, expires_at, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      deliveryId,
      input.taskId || null,
      input.attemptId || null,
      input.eventType,
      input.status || 'accepted',
      input.payloadHash || null,
      input.reason || null,
      new Date(now.getTime() + replayTtlSeconds() * 1000).toISOString(),
      now.toISOString(),
    ]
  );

  return { ok: true, duplicate: false, delivery_id: deliveryId };
}

export function claimWebhookCallbackDelivery(
  input: Omit<RegisterWebhookDeliveryInput, 'status' | 'reason'>
): RegisterWebhookDeliveryResult {
  if (!input.deliveryId || !input.deliveryId.trim()) {
    return { ok: false, duplicate: false, reason: 'missing_delivery_id' };
  }

  const deliveryId = input.deliveryId.trim();
  const existing = queryOne<{ status: string; payload_hash: string | null }>(
    'SELECT status, payload_hash FROM webhook_callback_deliveries WHERE delivery_id = ?',
    [deliveryId]
  );
  if (existing) {
    const payloadConflict = Boolean(
      input.payloadHash
      && existing.payload_hash
      && input.payloadHash !== existing.payload_hash
    );
    return {
      ok: !payloadConflict,
      duplicate: true,
      delivery_id: deliveryId,
      reason: payloadConflict ? 'payload_conflict' : existing.status,
      existing_status: existing.status,
    };
  }

  const now = input.now || new Date();
  run(
    `INSERT INTO webhook_callback_deliveries (
      id, delivery_id, task_id, attempt_id, event_type, status, payload_hash, reason, expires_at, received_at
    ) VALUES (?, ?, ?, ?, ?, 'processing', ?, NULL, ?, ?)`,
    [
      uuidv4(),
      deliveryId,
      input.taskId || null,
      input.attemptId || null,
      input.eventType,
      input.payloadHash || null,
      new Date(now.getTime() + replayTtlSeconds() * 1000).toISOString(),
      now.toISOString(),
    ]
  );
  return { ok: true, duplicate: false, delivery_id: deliveryId };
}

export function finishWebhookCallbackDelivery(
  deliveryId: string,
  input: { status: 'accepted' | 'rejected'; reason?: string | null }
) {
  const result = run(
    `UPDATE webhook_callback_deliveries
     SET status = ?, reason = ?
     WHERE delivery_id = ? AND status = 'processing'`,
    [input.status, input.reason ?? null, deliveryId.trim()]
  );
  if (result.changes !== 1) {
    throw new Error(`Webhook callback delivery ${deliveryId} is not in processing state`);
  }
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
    payload_hash: string | null;
    reason: string | null;
    expires_at: string;
    received_at: string;
    created_at: string;
  }>(
    `SELECT id, delivery_id, task_id, attempt_id, event_type, status, payload_hash, reason, expires_at, received_at, created_at
     FROM webhook_callback_deliveries
     ORDER BY received_at DESC
     LIMIT ?`,
    [Math.min(Math.max(limit, 1), 250)]
  );
}
