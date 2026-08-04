import * as crypto from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;

export interface WebhookSignatureInput {
  rawBody: string;
  secret: string;
  timestamp: string | number;
  version?: 'v1';
  deliveryId?: string;
}

export interface WebhookSignatureVerificationInput extends WebhookSignatureInput {
  signature: string | null | undefined;
  nowMs?: number;
  toleranceSeconds?: number;
  requireDeliveryIdBinding?: boolean;
}

export interface WebhookSignatureVerificationResult {
  ok: boolean;
  reason?: 'missing_signature' | 'missing_secret' | 'missing_delivery_id' | 'bad_timestamp' | 'stale_timestamp' | 'bad_signature';
}

export function buildWebhookSignatureBaseString({ rawBody, timestamp, version = 'v1', deliveryId }: WebhookSignatureInput) {
  if (deliveryId) {
    return `${deliveryId}.${timestamp}.${rawBody}`;
  }
  return `${version}.${timestamp}.${rawBody}`;
}

export function signWebhookPayload(input: WebhookSignatureInput) {
  const prefix = input.deliveryId ? 'sha256' : 'v1';
  return `${prefix}=${crypto
    .createHmac('sha256', input.secret)
    .update(buildWebhookSignatureBaseString(input), 'utf8')
    .digest('hex')}`;
}

function timingSafeTextEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifyWebhookSignature({
  rawBody,
  secret,
  timestamp,
  signature,
  deliveryId,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  requireDeliveryIdBinding = false,
}: WebhookSignatureVerificationInput): WebhookSignatureVerificationResult {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!signature) return { ok: false, reason: 'missing_signature' };
  if (requireDeliveryIdBinding && !deliveryId) return { ok: false, reason: 'missing_delivery_id' };

  const timestampText = String(timestamp);
  const timestampSeconds = Number(timestampText);
  if (!Number.isFinite(timestampSeconds)) return { ok: false, reason: 'bad_timestamp' };

  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) return { ok: false, reason: 'stale_timestamp' };

  const expected = signWebhookPayload({ rawBody, secret, timestamp: timestampText, deliveryId });
  if (timingSafeTextEqual(signature, expected)) {
    return { ok: true };
  }

  // Backward compatibility for v1 bridge authors already using the
  // pre-delivery-id signature. Lifecycle v2 callers must bind the delivery ID.
  if (deliveryId && !requireDeliveryIdBinding) {
    const legacyExpected = signWebhookPayload({ rawBody, secret, timestamp: timestampText });
    if (timingSafeTextEqual(signature, legacyExpected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'bad_signature' };
}

export function buildSignedWebhookHeaders({
  rawBody,
  secret,
  timestamp = Math.floor(Date.now() / 1000),
  deliveryId,
}: {
  rawBody: string;
  secret: string;
  timestamp?: number;
  deliveryId: string;
}) {
  const timestampText = String(timestamp);
  return {
    'X-MCK-Timestamp': timestampText,
    'X-MCK-Signature': signWebhookPayload({ rawBody, secret, timestamp: timestampText, deliveryId }),
    'X-MCK-Delivery': deliveryId,
    'X-MCK-Delivery-ID': deliveryId,
  };
}
