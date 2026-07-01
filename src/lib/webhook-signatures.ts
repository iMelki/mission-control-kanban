import * as crypto from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;

export interface WebhookSignatureInput {
  rawBody: string;
  secret: string;
  timestamp: string | number;
  version?: 'v1';
}

export interface WebhookSignatureVerificationInput extends WebhookSignatureInput {
  signature: string | null | undefined;
  nowMs?: number;
  toleranceSeconds?: number;
}

export interface WebhookSignatureVerificationResult {
  ok: boolean;
  reason?: 'missing_signature' | 'missing_secret' | 'bad_timestamp' | 'stale_timestamp' | 'bad_signature';
}

export function buildWebhookSignatureBaseString({ rawBody, timestamp, version = 'v1' }: WebhookSignatureInput) {
  return `${version}.${timestamp}.${rawBody}`;
}

export function signWebhookPayload(input: WebhookSignatureInput) {
  return `v1=${crypto
    .createHmac('sha256', input.secret)
    .update(buildWebhookSignatureBaseString(input), 'utf8')
    .digest('hex')}`;
}

export function verifyWebhookSignature({
  rawBody,
  secret,
  timestamp,
  signature,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
}: WebhookSignatureVerificationInput): WebhookSignatureVerificationResult {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!signature) return { ok: false, reason: 'missing_signature' };

  const timestampText = String(timestamp);
  const timestampSeconds = Number(timestampText);
  if (!Number.isFinite(timestampSeconds)) return { ok: false, reason: 'bad_timestamp' };

  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) return { ok: false, reason: 'stale_timestamp' };

  const expected = signWebhookPayload({ rawBody, secret, timestamp: timestampText });
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length) return { ok: false, reason: 'bad_signature' };

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
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
    'X-MCK-Signature': signWebhookPayload({ rawBody, secret, timestamp: timestampText }),
    'X-MCK-Delivery': deliveryId,
  };
}
