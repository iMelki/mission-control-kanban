export type WebhookCallbackMode = 'direct' | 'session' | 'canonical';

export interface NormalizedWebhookCallback {
  mode: WebhookCallbackMode;
  event_type: string;
  task_id?: string;
  session_id?: string;
  attempt_id?: string;
  summary: string;
  status: 'completed' | 'failed' | 'cancelled';
  completed_at?: string;
  raw: Record<string, unknown>;
}

export interface WebhookCallbackValidationResult {
  ok: boolean;
  normalized?: NormalizedWebhookCallback;
  errors: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedString(value: unknown, maxLength: number) {
  return nonEmptyString(value) && value.length <= maxLength;
}

function validStatus(value: unknown): value is NormalizedWebhookCallback['status'] {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}

function validIsoDate(value: unknown) {
  if (!nonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export const webhookCallbackPayloadJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mission-control-kanban.local/schemas/webhook-callback-completion.v1.json',
  title: 'MCK Webhook Callback Completion',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'type', 'task_id', 'attempt_id', 'status', 'completed_at'],
  properties: {
    schema_version: { const: '1' },
    type: { const: 'mck.callback.completed' },
    task_id: { type: 'string', minLength: 1, maxLength: 160 },
    attempt_id: { type: 'string', minLength: 1, maxLength: 160 },
    status: { enum: ['completed', 'failed', 'cancelled'] },
    completed_at: { type: 'string', format: 'date-time' },
    summary: { type: 'string', maxLength: 2000 },
    result: { type: 'object', additionalProperties: true },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 120 },
        message: { type: 'string', minLength: 1, maxLength: 1000 },
        retryable: { type: 'boolean' },
      },
    },
    metadata: { type: 'object', additionalProperties: true },
  },
} as const;

export function validateWebhookCallbackPayload(payload: unknown): WebhookCallbackValidationResult {
  const errors: string[] = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['Payload must be a JSON object'] };
  }

  // Canonical bridge callback contract.
  if (payload.type === 'mck.callback.completed' || payload.schema_version !== undefined) {
    if (payload.schema_version !== '1') errors.push('schema_version must be "1"');
    if (payload.type !== 'mck.callback.completed') errors.push('type must be "mck.callback.completed"');
    if (!boundedString(payload.task_id, 160)) errors.push('task_id is required and must be <= 160 chars');
    if (!boundedString(payload.attempt_id, 160)) errors.push('attempt_id is required and must be <= 160 chars');
    if (!validStatus(payload.status)) errors.push('status must be completed, failed, or cancelled');
    if (!validIsoDate(payload.completed_at)) errors.push('completed_at must be an ISO date-time string');

    if (payload.status === 'failed') {
      const error = payload.error;
      if (!isObject(error) || !boundedString(error.code, 120) || !boundedString(error.message, 1000)) {
        errors.push('failed callbacks require error.code and error.message');
      }
    }

    if (errors.length) return { ok: false, errors };

    const status = payload.status as NormalizedWebhookCallback['status'];
    const summary = nonEmptyString(payload.summary)
      ? payload.summary
      : status === 'failed' && isObject(payload.error) && nonEmptyString(payload.error.message)
        ? payload.error.message
        : status === 'cancelled'
          ? 'Task callback cancelled'
          : 'Task callback completed';

    return {
      ok: true,
      errors: [],
      normalized: {
        mode: 'canonical',
        event_type: 'mck.callback.completed',
        task_id: String(payload.task_id),
        attempt_id: String(payload.attempt_id),
        summary,
        status,
        completed_at: String(payload.completed_at),
        raw: payload,
      },
    };
  }

  // Backward-compatible direct task callback.
  if (nonEmptyString(payload.task_id)) {
    const summary = boundedString(payload.summary, 2000) ? String(payload.summary) : 'Task finished';
    return {
      ok: true,
      errors: [],
      normalized: {
        mode: 'direct',
        event_type: 'mck.callback.completed.legacy_direct',
        task_id: payload.task_id,
        summary,
        status: 'completed',
        raw: payload,
      },
    };
  }

  // Backward-compatible OpenClaw/session message callback.
  if (nonEmptyString(payload.session_id) && nonEmptyString(payload.message)) {
    const completionMatch = payload.message.match(/TASK_COMPLETE:\s*(.+)/i);
    if (!completionMatch) {
      return { ok: false, errors: ['session callbacks must use message format TASK_COMPLETE: [summary]'] };
    }
    return {
      ok: true,
      errors: [],
      normalized: {
        mode: 'session',
        event_type: 'mck.callback.completed.legacy_session',
        session_id: payload.session_id,
        summary: completionMatch[1].trim(),
        status: 'completed',
        raw: payload,
      },
    };
  }

  return { ok: false, errors: ['Provide canonical callback payload, task_id + summary, or session_id + TASK_COMPLETE message'] };
}
