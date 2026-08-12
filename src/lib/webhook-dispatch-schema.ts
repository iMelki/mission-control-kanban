import type { WebhookDispatchPayload } from './agent-runtimes';
import type { WebhookDispatchPayloadV2 } from './factory-dispatch';
import { factoryPathValidationError } from '../../integrations/paperclip-bridge/src/factory-paths';
import {
  FACTORY_TASK_ENVELOPE_V1_SCHEMA_VERSION,
  canonicalFactorySha256,
  validateCanonicalFactoryTaskEnvelope,
} from '../../integrations/paperclip-bridge/src/contracts';
import { FACTORY_V2_WORK_CONTRACT_LIMITS } from './dispatch-contract';

export const WEBHOOK_DISPATCH_SCHEMA_ID = 'https://mission-control-kanban.local/schemas/webhook-dispatch-payload.v1.json';
export const WEBHOOK_DISPATCH_V2_SCHEMA_ID = 'https://mission-control-kanban.local/schemas/webhook-dispatch-payload.v2.json';
/**
 * Stable local identity for the canonical envelope definition published inside
 * the v2 dispatch schema. The published schema previously pointed `envelope` at
 * a raw.githubusercontent.com URL on the mutable agent-settings `dev` branch, so
 * an external consumer's validation result could change without any MCK release.
 */
export const FACTORY_TASK_ENVELOPE_SCHEMA_ID = 'https://mission-control-kanban.local/schemas/factory-task-envelope.v1.json';
const FACTORY_MCK_BASE_URL = 'http://127.0.0.1:3021';
const FACTORY_MCK_LIFECYCLE_URL = `${FACTORY_MCK_BASE_URL}/api/webhooks/agent-completion`;

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

export const webhookDispatchPayloadV2JsonSchema = {
  $id: WEBHOOK_DISPATCH_V2_SCHEMA_ID,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Mission Control Kanban factory webhook dispatch payload',
  type: 'object',
  additionalProperties: false,
  required: [
    'event',
    'version',
    'dispatch',
    'task',
    'agent',
    'callbacks',
    'callback_urls',
    'mission_control_url',
    'output_directory',
    'prompt_markdown',
    'issued_at',
    'factory_contract',
  ],
  properties: {
    ...webhookDispatchPayloadJsonSchema.properties,
    version: { const: 2 },
    dispatch: {
      type: 'object',
      additionalProperties: false,
      required: ['attempt_id', 'delivery_id', 'correlation_id', 'task_revision'],
      properties: {
        attempt_id: { type: 'string', minLength: 1, maxLength: 160 },
        delivery_id: { type: 'string', minLength: 1, maxLength: 200 },
        correlation_id: { type: 'string', minLength: 1, maxLength: 240 },
        task_revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
    callbacks: {
      ...webhookDispatchPayloadJsonSchema.$defs.callbacks,
      required: ['activity', 'deliverable', 'status', 'dispatch', 'lifecycle'],
      properties: {
        ...webhookDispatchPayloadJsonSchema.$defs.callbacks.properties,
        lifecycle: { const: FACTORY_MCK_LIFECYCLE_URL },
      },
    },
    callback_urls: {
      ...webhookDispatchPayloadJsonSchema.$defs.callbacks,
      required: ['activity', 'deliverable', 'status', 'dispatch', 'lifecycle'],
      properties: {
        ...webhookDispatchPayloadJsonSchema.$defs.callbacks.properties,
        lifecycle: { const: FACTORY_MCK_LIFECYCLE_URL },
      },
    },
    mission_control_url: { const: FACTORY_MCK_BASE_URL },
    factory_contract: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schema_version',
        'envelope_id',
        'repository',
        'acceptance_criteria',
        'test_requirements',
        'risk_level',
        'review_mode',
        'impact',
        'rollback_plan',
        'safety_rules',
        'limits',
        'envelope',
        'envelope_sha256',
      ],
      properties: {
        schema_version: { const: 'factory-task-envelope.v1' },
        envelope_id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' },
        repository: {
          type: 'object',
          additionalProperties: false,
          required: ['slug', 'owner', 'name', 'active_branch', 'base_sha', 'allowed_file_scope'],
          properties: {
            slug: { type: 'string', pattern: '^iMelki/[^/]+$' },
            owner: { const: 'iMelki' },
            name: { type: 'string', minLength: 1 },
            active_branch: { const: 'dev' },
            base_sha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
            allowed_file_scope: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          },
        },
        acceptance_criteria: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        test_requirements: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        risk_level: { enum: ['low', 'medium', 'high', 'critical'] },
        review_mode: { enum: ['human_required', 'auto_checks_only', 'pair_review'] },
        impact: { type: 'string', minLength: 1 },
        rollback_plan: { type: 'string', minLength: 1 },
        safety_rules: { type: 'array', items: { type: 'string', minLength: 1 } },
        limits: {
          type: 'object',
          additionalProperties: false,
          required: ['max_repair_attempts', 'concurrent_mutating_builders'],
          properties: {
            max_repair_attempts: { const: 2 },
            concurrent_mutating_builders: { const: 1 },
          },
        },
        envelope: { $ref: '#/$defs/factory_task_envelope' },
        envelope_sha256: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      },
    },
  },
  $defs: {
    factory_task_envelope: {
      $id: FACTORY_TASK_ENVELOPE_SCHEMA_ID,
      title: 'Canonical factory task envelope (agent-settings factory-task-envelope.v1)',
      description: [
        'Local, version-pinned definition of the canonical envelope. The authoritative',
        'check is validateCanonicalFactoryTaskEnvelope in',
        'integrations/paperclip-bridge/src/contracts.ts, which this repository runs on',
        'every dispatch; this definition exists so published consumers resolve the',
        'envelope from the served document instead of a mutable upstream branch URL.',
      ].join(' '),
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'envelopeId',
        'correlationId',
        'createdAtUtc',
        'origin',
        'repository',
        'work',
        'execution',
        'privacy',
      ],
      properties: {
        schemaVersion: { const: FACTORY_TASK_ENVELOPE_V1_SCHEMA_VERSION },
        envelopeId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' },
        correlationId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' },
        createdAtUtc: { type: 'string', minLength: 1 },
        origin: { type: 'object' },
        repository: { type: 'object' },
        work: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'acceptanceCriteria', 'testRequirements', 'risk', 'reviewMode', 'rollback'],
          properties: {
            title: {
              type: 'string',
              minLength: FACTORY_V2_WORK_CONTRACT_LIMITS.title.min,
              maxLength: FACTORY_V2_WORK_CONTRACT_LIMITS.title.max,
            },
            acceptanceCriteria: {
              type: 'array',
              minItems: 1,
              maxItems: FACTORY_V2_WORK_CONTRACT_LIMITS.list_items.max,
              items: {
                type: 'string',
                minLength: FACTORY_V2_WORK_CONTRACT_LIMITS.acceptance_criteria.min,
                maxLength: FACTORY_V2_WORK_CONTRACT_LIMITS.acceptance_criteria.max,
              },
            },
            testRequirements: {
              type: 'array',
              minItems: 1,
              maxItems: FACTORY_V2_WORK_CONTRACT_LIMITS.list_items.max,
              items: {
                type: 'string',
                minLength: FACTORY_V2_WORK_CONTRACT_LIMITS.test_requirements.min,
                maxLength: FACTORY_V2_WORK_CONTRACT_LIMITS.test_requirements.max,
              },
            },
            risk: { enum: ['low', 'medium', 'high', 'critical'] },
            reviewMode: { enum: ['independent', 'pair-review', 'human-final'] },
            rollback: {
              type: 'object',
              additionalProperties: false,
              required: ['strategy', 'verification'],
              properties: {
                strategy: {
                  type: 'string',
                  minLength: FACTORY_V2_WORK_CONTRACT_LIMITS.rollback_plan.min,
                  maxLength: FACTORY_V2_WORK_CONTRACT_LIMITS.rollback_plan.max,
                },
                verification: {
                  type: 'string',
                  minLength: FACTORY_V2_WORK_CONTRACT_LIMITS.rollback_plan.min,
                  maxLength: FACTORY_V2_WORK_CONTRACT_LIMITS.rollback_plan.max,
                },
              },
            },
          },
        },
        execution: { type: 'object' },
        privacy: { type: 'object' },
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

function validateLifecycleCallbacks(value: unknown, path: string, errors: string[]) {
  validateCallbacks(value, path, errors);
  if (isRecord(value)) requireString(value.lifecycle, `${path}.lifecycle`, errors);
}

function requireStringArray(value: unknown, path: string, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    errors.push(`${path} must be a non-empty string array`);
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

export function validateWebhookDispatchPayloadV2(payload: unknown): WebhookPayloadValidationResult {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['payload must be an object'] };
  if (payload.event !== 'mck.task.dispatch') errors.push('event must be mck.task.dispatch');
  if (payload.version !== 2) errors.push('version must be 2');

  if (!isRecord(payload.dispatch)) {
    errors.push('dispatch must be an object');
  } else {
    for (const key of ['attempt_id', 'delivery_id', 'correlation_id', 'task_revision']) {
      requireString(payload.dispatch[key], `dispatch.${key}`, errors);
    }
    if (
      typeof payload.dispatch.task_revision === 'string'
      && !/^[a-f0-9]{64}$/.test(payload.dispatch.task_revision)
    ) {
      errors.push('dispatch.task_revision must be a lowercase SHA-256 hex digest');
    }
  }

  if (!isRecord(payload.task)) {
    errors.push('task must be an object');
  } else {
    requireString(payload.task.id, 'task.id', errors);
    requireString(payload.task.title, 'task.title', errors);
    if (!isRecord(payload.task.github_source) || payload.task.github_source.repo_owner !== 'iMelki') {
      errors.push('task.github_source.repo_owner must be iMelki');
    }
  }

  if (!isRecord(payload.agent)) {
    errors.push('agent must be an object');
  } else {
    requireString(payload.agent.id, 'agent.id', errors);
    requireString(payload.agent.name, 'agent.name', errors);
    requireString(payload.agent.role, 'agent.role', errors);
    if (payload.agent.runtime_type !== 'webhook') errors.push('agent.runtime_type must be webhook');
  }

  validateLifecycleCallbacks(payload.callbacks, 'callbacks', errors);
  validateLifecycleCallbacks(payload.callback_urls, 'callback_urls', errors);
  requireString(payload.mission_control_url, 'mission_control_url', errors);
  if (
    isRecord(payload.callbacks)
    && isRecord(payload.callback_urls)
    && payload.callbacks.lifecycle !== payload.callback_urls.lifecycle
  ) {
    errors.push('callbacks.lifecycle and callback_urls.lifecycle must be identical');
  }
  if (
    isRecord(payload.callbacks)
    && payload.callbacks.lifecycle !== FACTORY_MCK_LIFECYCLE_URL
  ) {
    errors.push(`callbacks.lifecycle must be ${FACTORY_MCK_LIFECYCLE_URL}`);
  }
  if (payload.mission_control_url !== FACTORY_MCK_BASE_URL) {
    errors.push(`mission_control_url must be ${FACTORY_MCK_BASE_URL}`);
  }
  requireString(payload.output_directory, 'output_directory', errors);
  requireString(payload.prompt_markdown, 'prompt_markdown', errors);
  requireString(payload.issued_at, 'issued_at', errors);

  if (!isRecord(payload.factory_contract)) {
    errors.push('factory_contract must be an object');
  } else {
    const contract = payload.factory_contract;
    if (contract.schema_version !== 'factory-task-envelope.v1') {
      errors.push('factory_contract.schema_version must be factory-task-envelope.v1');
    }
    if (
      typeof contract.envelope_id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(contract.envelope_id)
    ) {
      errors.push('factory_contract.envelope_id must be a stable factory envelope identity');
    } else if (
      isRecord(payload.dispatch)
      && typeof payload.dispatch.attempt_id === 'string'
      && contract.envelope_id !== `factory:${payload.dispatch.attempt_id}`
    ) {
      errors.push('factory_contract.envelope_id must bind the dispatch attempt');
    }
    if (!isRecord(contract.repository)) {
      errors.push('factory_contract.repository must be an object');
    } else {
      if (contract.repository.owner !== 'iMelki') errors.push('factory_contract.repository.owner must be iMelki');
      if (
        typeof contract.repository.slug !== 'string'
        || !/^iMelki\/[^/]+$/.test(contract.repository.slug)
      ) {
        errors.push('factory_contract.repository.slug must identify an iMelki repository');
      }
      if (contract.repository.active_branch !== 'dev') errors.push('factory_contract.repository.active_branch must be dev');
      if (
        typeof contract.repository.base_sha !== 'string'
        || !/^[a-f0-9]{40}$/.test(contract.repository.base_sha)
      ) {
        errors.push('factory_contract.repository.base_sha must be a lowercase 40-hex Git commit');
      }
      requireStringArray(contract.repository.allowed_file_scope, 'factory_contract.repository.allowed_file_scope', errors);
      if (Array.isArray(contract.repository.allowed_file_scope)) {
        contract.repository.allowed_file_scope.forEach((scope, index) => {
          const pathError = factoryPathValidationError(scope, 'scope');
          if (pathError) {
            errors.push(`factory_contract.repository.allowed_file_scope[${index}] ${pathError}`);
          }
        });
      }
    }
    try {
      const envelope = validateCanonicalFactoryTaskEnvelope(contract.envelope, {
        attemptId: isRecord(payload.dispatch) ? String(payload.dispatch.attempt_id ?? '') : '',
        deliveryId: isRecord(payload.dispatch) ? String(payload.dispatch.delivery_id ?? '') : '',
        correlationId: isRecord(payload.dispatch) ? String(payload.dispatch.correlation_id ?? '') : '',
        taskRevision: isRecord(payload.dispatch) ? String(payload.dispatch.task_revision ?? '') : '',
        taskId: isRecord(payload.task) ? String(payload.task.id ?? '') : '',
        repositorySlug: isRecord(contract.repository)
          ? String(contract.repository.slug ?? '')
          : undefined,
        repositoryBaseSha: isRecord(contract.repository)
          ? String(contract.repository.base_sha ?? '')
          : undefined,
      });
      if (
        contract.envelope_id !== envelope.envelopeId
        || contract.envelope_sha256 !== canonicalFactorySha256(envelope)
        || (
          isRecord(payload.task)
          && isRecord(payload.task.github_source)
          && (
            envelope.origin.github.repository !== payload.task.github_source.repo_name
            || envelope.origin.github.issueNumber !== payload.task.github_source.issue_number
            || envelope.origin.github.projectItemId !== (payload.task.github_source.project_item_id ?? null)
          )
        )
      ) {
        errors.push('factory_contract canonical envelope hash or alias readback does not match');
      }
      const repositoryAliases = isRecord(contract.repository) ? contract.repository : null;
      const allowedFileScopeAliases = repositoryAliases && Array.isArray(repositoryAliases.allowed_file_scope)
        ? repositoryAliases.allowed_file_scope
        : null;
      const sameStringArray = (left: unknown, right: string[]) => (
        Array.isArray(left)
        && left.length === right.length
        && left.every((item, index) => item === right[index])
      );
      const canonicalReviewMode = contract.review_mode === 'pair_review'
        ? 'pair-review'
        : contract.review_mode === 'human_required'
          ? 'human-final'
          : 'independent';
      if (
        !allowedFileScopeAliases
        || !sameStringArray(allowedFileScopeAliases, envelope.repository.allowedPaths)
        || !sameStringArray(contract.acceptance_criteria, envelope.work.acceptanceCriteria)
        || !sameStringArray(contract.test_requirements, envelope.work.testRequirements)
        || contract.risk_level !== envelope.work.risk
        || canonicalReviewMode !== envelope.work.reviewMode
        || contract.rollback_plan !== envelope.work.rollback.strategy
        || !isRecord(contract.limits)
        || contract.limits.max_repair_attempts !== envelope.execution.maxRepairAttempts
        || contract.limits.concurrent_mutating_builders !== envelope.execution.concurrentMutatingBuilders
      ) {
        errors.push('factory_contract compatibility aliases do not match the canonical envelope');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'factory_contract canonical envelope is invalid');
    }
    requireStringArray(contract.acceptance_criteria, 'factory_contract.acceptance_criteria', errors);
    requireStringArray(contract.test_requirements, 'factory_contract.test_requirements', errors);
    requireString(contract.impact, 'factory_contract.impact', errors);
    requireString(contract.rollback_plan, 'factory_contract.rollback_plan', errors);
    if (!isRecord(contract.limits) || contract.limits.max_repair_attempts !== 2 || contract.limits.concurrent_mutating_builders !== 1) {
      errors.push('factory_contract.limits must enforce two repairs and one mutating builder');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertWebhookDispatchPayloadV2(payload: WebhookDispatchPayloadV2): void {
  const validation = validateWebhookDispatchPayloadV2(payload);
  if (!validation.valid) {
    throw new Error(`Invalid factory webhook dispatch payload: ${validation.errors.join('; ')}`);
  }
}
