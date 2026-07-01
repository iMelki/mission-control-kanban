import type { WebhookDispatchPayload } from './agent-runtimes';

export const WEBHOOK_DISPATCH_SCHEMA_ID = 'https://mission-control-kanban.local/schemas/webhook-dispatch-payload.v1.json';

export const webhookDispatchPayloadJsonSchema = {
  $id: WEBHOOK_DISPATCH_SCHEMA_ID,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Mission Control Kanban webhook dispatch payload',
  type: 'object',
  additionalProperties: false,
  required: [
    'event',
    'version',
    'task',
    'agent',
    'callbacks',
    'callback_urls',
    'mission_control_url',
    'output_directory',
    'prompt_markdown',
    'issued_at',
  ],
  properties: {
    event: { const: 'mck.task.dispatch' },
    version: { const: 1 },
    task: {
      type: 'object',
      additionalProperties: true,
      required: ['id', 'title', 'priority'],
      properties: {
        id: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        description: { type: ['string', 'null'] },
        priority: { enum: ['low', 'normal', 'high', 'urgent'] },
        due_date: { type: ['string', 'null'] },
        github_source: { type: ['object', 'null'] },
        dispatch_metadata: { type: ['object', 'null'] },
      },
    },
    agent: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'role', 'runtime_type'],
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        role: { type: 'string', minLength: 1 },
        runtime_type: { enum: ['manual', 'openclaw', 'webhook'] },
      },
    },
    callbacks: { $ref: '#/$defs/callbacks' },
    callback_urls: { $ref: '#/$defs/callbacks' },
    mission_control_url: { type: 'string', minLength: 1 },
    output_directory: { type: 'string', minLength: 1 },
    prompt_markdown: { type: 'string', minLength: 1 },
    issued_at: { type: 'string', minLength: 1 },
  },
  $defs: {
    callbacks: {
      type: 'object',
      additionalProperties: false,
      required: ['activity', 'deliverable', 'status', 'dispatch'],
      properties: {
        activity: { type: 'string', minLength: 1 },
        deliverable: { type: 'string', minLength: 1 },
        status: { type: 'string', minLength: 1 },
        dispatch: { type: 'string', minLength: 1 },
      },
    },
  },
} as const;

export interface WebhookPayloadValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string, errors: string[]) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function validateCallbacks(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of ['activity', 'deliverable', 'status', 'dispatch']) {
    requireString(value[key], `${path}.${key}`, errors);
  }
}

export function validateWebhookDispatchPayload(payload: unknown): WebhookPayloadValidationResult {
  const errors: string[] = [];
  if (!isRecord(payload)) {
    return { valid: false, errors: ['payload must be an object'] };
  }

  if (payload.event !== 'mck.task.dispatch') errors.push('event must be mck.task.dispatch');
  if (payload.version !== 1) errors.push('version must be 1');

  if (!isRecord(payload.task)) {
    errors.push('task must be an object');
  } else {
    requireString(payload.task.id, 'task.id', errors);
    requireString(payload.task.title, 'task.title', errors);
    if (!['low', 'normal', 'high', 'urgent'].includes(String(payload.task.priority))) {
      errors.push('task.priority must be low, normal, high, or urgent');
    }
  }

  if (!isRecord(payload.agent)) {
    errors.push('agent must be an object');
  } else {
    requireString(payload.agent.id, 'agent.id', errors);
    requireString(payload.agent.name, 'agent.name', errors);
    requireString(payload.agent.role, 'agent.role', errors);
    if (!['manual', 'openclaw', 'webhook'].includes(String(payload.agent.runtime_type))) {
      errors.push('agent.runtime_type must be manual, openclaw, or webhook');
    }
  }

  validateCallbacks(payload.callbacks, 'callbacks', errors);
  validateCallbacks(payload.callback_urls, 'callback_urls', errors);
  requireString(payload.mission_control_url, 'mission_control_url', errors);
  requireString(payload.output_directory, 'output_directory', errors);
  requireString(payload.prompt_markdown, 'prompt_markdown', errors);
  requireString(payload.issued_at, 'issued_at', errors);

  return { valid: errors.length === 0, errors };
}

export function assertWebhookDispatchPayload(payload: WebhookDispatchPayload): void {
  const validation = validateWebhookDispatchPayload(payload);
  if (!validation.valid) {
    throw new Error(`Invalid webhook dispatch payload: ${validation.errors.join('; ')}`);
  }
}
