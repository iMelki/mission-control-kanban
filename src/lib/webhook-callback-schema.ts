import { factoryPathValidationError } from '../../integrations/paperclip-bridge/src/factory-paths';
import {
  FACTORY_RUN_RECEIPT_V1_SCHEMA_VERSION,
  FACTORY_RUN_RECEIPT_V2_SCHEMA_VERSION,
  canonicalFactoryDigest,
  projectFactoryReceiptAuthority,
  validateReceipt as validateBridgeReceipt,
  type FactoryReceiptAuthorityProjection,
} from '../../integrations/paperclip-bridge/src/contracts';

export type WebhookCallbackMode = 'direct' | 'session' | 'canonical';
export type WebhookLifecycleStatus =
  | 'started'
  | 'testing'
  | 'review'
  | 'completed'
  | 'blocked'
  | 'needs_human'
  | 'failed'
  | 'cancelled';

export interface FactoryRunReceipt {
  schemaVersion:
    | 'agent-settings.factory-run-receipt.v1'
    | 'agent-settings.factory-run-receipt.v2';
  receiptId: string;
  envelopeId: string;
  correlationId: string;
  taskRevisionSha256: string;
  status: 'succeeded';
  run: {
    builderAgentId?: string;
    paperclipIssueId: string;
    paperclipRunId: string;
    workspaceId: string;
    roleProfile: string;
    profileManifestSha256: string;
    effectiveConfigSha256: string;
    toolInventorySha256: string;
    startedAtUtc: string;
    finishedAtUtc: string;
    durationMs: number;
    mutationIntent: 'release';
  };
  repository: {
    slug: string;
    branch: 'dev';
    baseSha: string;
    headBeforeReleaseSha: string;
    candidateSnapshotSha256: string;
    expectedIndexTreeSha?: string | null;
    expectedIndexEntries?: Array<Record<string, unknown>>;
    modeEvidence?: unknown[];
    finalSha: string;
    changedPaths: string[];
  };
  commands: Array<{
    id: string;
    stage: 'validation' | 'release';
    argv: string[];
    workingDirectory: string;
    startedAtUtc: string;
    finishedAtUtc: string;
    durationMs: number;
    status: 'passed';
    exitCode: 0;
    stdoutSha256: string;
    stderrSha256: string;
  }>;
  tests: { total: number; passed: number; failed: 0; skipped: number };
  artifacts: Array<{ path: string; sha256: string; mediaType: string }>;
  metrics: {
    inputWorkItems: number;
    processedItems: number;
    changedItems: number;
    retryCount: number;
    deferralCount: number;
    errorCount: 0;
    inputTokens: number | null;
    outputTokens: number | null;
    billedCents: number | null;
    hostPressure: 'unknown' | 'normal' | 'elevated' | 'critical';
    backendLatencyMs: number | null;
    freshnessAtUtc: string;
    caller: string;
  };
  review: {
    reviewerId: string;
    reviewerRunId?: string;
    roleProfile?: string;
    profileManifestSha256?: string;
    effectiveConfigSha256?: string;
    toolInventorySha256?: string;
    sessionProvenanceSha256?: string;
    decision: 'accept';
    freshSession: true;
    builderSessionReused: false;
    reviewedAtUtc: string;
    evidenceSha256: string;
  };
  approvals: Array<Record<string, unknown>>;
  release: {
    attempted: true;
    pushed: true;
    remoteRef: 'refs/heads/dev';
    commitSha: string;
    remoteReadbackSha: string;
    remoteReadbackTreeSha?: string;
    startedAtUtc: string;
    finishedAtUtc: string;
    paperclipAgentId?: string;
    paperclipRunId?: string;
    roleProfile?: string;
    effectiveConfigSha256?: string;
    toolInventorySha256?: string;
  };
  publications: Array<Record<string, unknown>>;
  reconciliation: {
    mck: string;
    paperclip: string;
    missionControl: string;
    githubProject: string;
    git: string;
  };
  privacy: {
    secretsIncluded: false;
    directContactOrPaymentIdentifiersIncluded: false;
    rawPrivateLogsIncluded: false;
    redactionApplied: boolean;
  };
  errors: string[];
}

export interface NormalizedWebhookCallback {
  mode: WebhookCallbackMode;
  event_type: string;
  task_id?: string;
  session_id?: string;
  attempt_id?: string;
  correlation_id?: string;
  task_revision?: string;
  receipt?: FactoryRunReceipt;
  receipt_authority?: FactoryReceiptAuthorityProjection;
  summary: string;
  status: WebhookLifecycleStatus;
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

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validStatus(value: unknown): value is NormalizedWebhookCallback['status'] {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}

function validLifecycleStatus(value: unknown): value is WebhookLifecycleStatus {
  return [
    'started',
    'testing',
    'review',
    'completed',
    'blocked',
    'needs_human',
    'failed',
    'cancelled',
  ].includes(String(value));
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

export const webhookLifecycleCallbackPayloadJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mission-control-kanban.local/schemas/webhook-callback-lifecycle.v2.json',
  title: 'MCK Webhook Callback Lifecycle',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'type',
    'task_id',
    'attempt_id',
    'correlation_id',
    'task_revision',
    'status',
    'occurred_at',
    'summary',
  ],
  properties: {
    schema_version: { const: '2' },
    type: { const: 'mck.callback.lifecycle' },
    task_id: { type: 'string', minLength: 1, maxLength: 160 },
    attempt_id: { type: 'string', minLength: 1, maxLength: 160 },
    correlation_id: { type: 'string', minLength: 1, maxLength: 240 },
    task_revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    status: { enum: ['started', 'testing', 'review', 'completed', 'blocked', 'needs_human', 'failed', 'cancelled'] },
    occurred_at: { type: 'string', format: 'date-time' },
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
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
    receipt: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'receiptId',
        'envelopeId',
        'correlationId',
        'taskRevisionSha256',
        'status',
        'run',
        'repository',
        'commands',
        'tests',
        'artifacts',
        'metrics',
        'review',
        'approvals',
        'release',
        'publications',
        'reconciliation',
        'privacy',
        'errors',
      ],
      properties: {
        schemaVersion: {
          enum: [
            'agent-settings.factory-run-receipt.v1',
            'agent-settings.factory-run-receipt.v2',
          ],
        },
        receiptId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' },
        envelopeId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' },
        correlationId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' },
        taskRevisionSha256: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
        status: { const: 'succeeded' },
        run: {
          type: 'object',
          required: [
            'paperclipIssueId',
            'paperclipRunId',
            'workspaceId',
            'roleProfile',
            'profileManifestSha256',
            'effectiveConfigSha256',
            'toolInventorySha256',
            'startedAtUtc',
            'finishedAtUtc',
            'durationMs',
            'mutationIntent',
          ],
          properties: {
            mutationIntent: { const: 'release' },
          },
        },
        repository: {
          type: 'object',
          required: ['slug', 'branch', 'baseSha', 'headBeforeReleaseSha', 'candidateSnapshotSha256', 'finalSha', 'changedPaths'],
          properties: {
            slug: { type: 'string', pattern: '^iMelki/[^/]+$' },
            branch: { const: 'dev' },
            baseSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
            headBeforeReleaseSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
            candidateSnapshotSha256: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
            finalSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
            changedPaths: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          },
        },
        commands: {
          type: 'array',
          minItems: 1,
          allOf: [
            {
              contains: {
                type: 'object',
                required: ['stage'],
                properties: { stage: { const: 'validation' } },
              },
            },
          ],
          items: {
            type: 'object',
            required: [
              'id',
              'stage',
              'argv',
              'workingDirectory',
              'startedAtUtc',
              'finishedAtUtc',
              'durationMs',
              'status',
              'exitCode',
              'stdoutSha256',
              'stderrSha256',
            ],
            properties: {
              stage: { enum: ['validation', 'release'] },
              status: { const: 'passed' },
              exitCode: { const: 0 },
            },
          },
        },
        tests: {
          type: 'object',
          required: ['total', 'passed', 'failed', 'skipped'],
          properties: {
            total: { type: 'integer', minimum: 1 },
            passed: { type: 'integer', minimum: 1 },
            failed: { const: 0 },
            skipped: { type: 'integer', minimum: 0 },
          },
        },
        artifacts: { type: 'array' },
        metrics: {
          type: 'object',
          required: [
            'inputWorkItems',
            'processedItems',
            'changedItems',
            'retryCount',
            'deferralCount',
            'errorCount',
            'inputTokens',
            'outputTokens',
            'billedCents',
            'hostPressure',
            'backendLatencyMs',
            'freshnessAtUtc',
            'caller',
          ],
          properties: {
            retryCount: { type: 'integer', minimum: 0, maximum: 2 },
            errorCount: { const: 0 },
          },
        },
        review: {
          type: 'object',
          required: ['reviewerId', 'decision', 'freshSession', 'builderSessionReused', 'reviewedAtUtc', 'evidenceSha256'],
          properties: {
            reviewerId: { type: 'string', minLength: 3 },
            decision: { const: 'accept' },
            freshSession: { const: true },
            builderSessionReused: { const: false },
          },
        },
        approvals: { type: 'array' },
        release: {
          type: 'object',
          required: ['attempted', 'pushed', 'remoteRef', 'commitSha', 'remoteReadbackSha', 'startedAtUtc', 'finishedAtUtc'],
          properties: {
            attempted: { const: true },
            pushed: { const: true },
            remoteRef: { const: 'refs/heads/dev' },
            commitSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
            remoteReadbackSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
          },
        },
        publications: { type: 'array' },
        reconciliation: {
          type: 'object',
          required: ['mck', 'paperclip', 'missionControl', 'githubProject', 'git'],
        },
        privacy: {
          type: 'object',
          required: ['secretsIncluded', 'directContactOrPaymentIdentifiersIncluded', 'rawPrivateLogsIncluded', 'redactionApplied'],
          properties: {
            secretsIncluded: { const: false },
            directContactOrPaymentIdentifiersIncluded: { const: false },
            rawPrivateLogsIncluded: { const: false },
          },
        },
        errors: { type: 'array', maxItems: 0 },
      },
    },
    metadata: { type: 'object', additionalProperties: true },
  },
  allOf: [
    {
      if: { properties: { status: { const: 'completed' } } },
      then: {
        required: ['receipt'],
        properties: {
          receipt: {
            properties: {
              schemaVersion: { const: 'agent-settings.factory-run-receipt.v2' },
            },
          },
        },
      },
    },
  ],
} as const;

function validateFactoryReceiptV1(value: unknown, errors: string[]): value is FactoryRunReceipt {
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
  const digestPattern = /^sha256:[a-f0-9]{64}$/;
  const gitShaPattern = /^[a-f0-9]{40}$/;
  const nonNegativeInteger = (candidate: unknown) => Number.isInteger(candidate) && Number(candidate) >= 0;
  if (!isObject(value)) {
    errors.push('completed lifecycle callbacks require receipt proof');
    return false;
  }
  if (!hasOnlyKeys(value, [
    'schemaVersion',
    'receiptId',
    'envelopeId',
    'correlationId',
    'taskRevisionSha256',
    'status',
    'run',
    'repository',
    'commands',
    'tests',
    'artifacts',
    'metrics',
    'review',
    'approvals',
    'release',
    'publications',
    'reconciliation',
    'privacy',
    'errors',
  ])) {
    errors.push('receipt contains fields outside factory-run-receipt.v1');
  }
  if (value.schemaVersion !== 'agent-settings.factory-run-receipt.v1') {
    errors.push('receipt.schemaVersion must be agent-settings.factory-run-receipt.v1');
  }
  if (!nonEmptyString(value.receiptId) || !idPattern.test(value.receiptId)) errors.push('receipt.receiptId is invalid');
  if (!nonEmptyString(value.envelopeId) || !idPattern.test(value.envelopeId)) errors.push('receipt.envelopeId is invalid');
  if (!nonEmptyString(value.correlationId) || !idPattern.test(value.correlationId)) errors.push('receipt.correlationId is invalid');
  if (!nonEmptyString(value.taskRevisionSha256) || !digestPattern.test(value.taskRevisionSha256)) {
    errors.push('receipt.taskRevisionSha256 must be a prefixed SHA-256 digest');
  }
  if (value.status !== 'succeeded') errors.push('receipt.status must be succeeded');
  if (
    !isObject(value.run)
    || !hasOnlyKeys(value.run, [
      'paperclipIssueId',
      'paperclipRunId',
      'workspaceId',
      'roleProfile',
      'profileManifestSha256',
      'effectiveConfigSha256',
      'toolInventorySha256',
      'startedAtUtc',
      'finishedAtUtc',
      'durationMs',
      'mutationIntent',
    ])
    || !nonEmptyString(value.run.paperclipIssueId)
    || !idPattern.test(value.run.paperclipIssueId)
    || !nonEmptyString(value.run.paperclipRunId)
    || !idPattern.test(value.run.paperclipRunId)
    || !nonEmptyString(value.run.workspaceId)
    || !idPattern.test(value.run.workspaceId)
    || !nonEmptyString(value.run.roleProfile)
    || !/^factory-[a-z0-9-]{2,64}$/.test(value.run.roleProfile)
    || !nonEmptyString(value.run.profileManifestSha256)
    || !digestPattern.test(value.run.profileManifestSha256)
    || !nonEmptyString(value.run.effectiveConfigSha256)
    || !digestPattern.test(value.run.effectiveConfigSha256)
    || !nonEmptyString(value.run.toolInventorySha256)
    || !digestPattern.test(value.run.toolInventorySha256)
    || !validIsoDate(value.run.startedAtUtc)
    || !String(value.run.startedAtUtc).endsWith('Z')
    || !validIsoDate(value.run.finishedAtUtc)
    || !String(value.run.finishedAtUtc).endsWith('Z')
    || !nonNegativeInteger(value.run.durationMs)
    || value.run.mutationIntent !== 'release'
  ) {
    errors.push('receipt.run must prove the Paperclip run, workspace, profile, config, and tool hashes');
  }
  if (
    !isObject(value.repository)
    || !hasOnlyKeys(value.repository, [
      'slug',
      'branch',
      'baseSha',
      'headBeforeReleaseSha',
      'candidateSnapshotSha256',
      'finalSha',
      'changedPaths',
    ])
    || value.repository.branch !== 'dev'
    || !nonEmptyString(value.repository.slug)
    || !/^iMelki\/[A-Za-z0-9._-]{1,100}$/.test(value.repository.slug)
    || !nonEmptyString(value.repository.baseSha)
    || !gitShaPattern.test(value.repository.baseSha)
    || !nonEmptyString(value.repository.headBeforeReleaseSha)
    || !gitShaPattern.test(value.repository.headBeforeReleaseSha)
    || !nonEmptyString(value.repository.candidateSnapshotSha256)
    || !digestPattern.test(value.repository.candidateSnapshotSha256)
    || !nonEmptyString(value.repository.finalSha)
    || !gitShaPattern.test(value.repository.finalSha)
    || !Array.isArray(value.repository.changedPaths)
    || value.repository.changedPaths.length === 0
    || value.repository.changedPaths.length > 512
    || new Set(value.repository.changedPaths).size !== value.repository.changedPaths.length
    || value.repository.changedPaths.some(
      (path) => factoryPathValidationError(path, 'changed') !== null,
    )
  ) {
    errors.push('receipt.repository must prove an owned dev candidate snapshot and final SHA');
  }
  if (
    !Array.isArray(value.commands)
    || value.commands.length === 0
    || !value.commands.some((command) => isObject(command) && command.stage === 'validation')
    || value.commands.length > 256
    || value.commands.some((command) => (
      !isObject(command)
      || !hasOnlyKeys(command, [
        'id',
        'stage',
        'argv',
        'workingDirectory',
        'startedAtUtc',
        'finishedAtUtc',
        'durationMs',
        'status',
        'exitCode',
        'stdoutSha256',
        'stderrSha256',
      ])
      || !nonEmptyString(command.id)
      || !idPattern.test(command.id)
      || !['validation', 'release'].includes(String(command.stage))
      || !Array.isArray(command.argv)
      || command.argv.length === 0
      || command.argv.length > 128
      || command.argv.some((argument) => typeof argument !== 'string' || argument.length > 4096)
      || !nonEmptyString(command.workingDirectory)
      || command.workingDirectory.length > 1024
      || !validIsoDate(command.startedAtUtc)
      || !String(command.startedAtUtc).endsWith('Z')
      || !validIsoDate(command.finishedAtUtc)
      || !String(command.finishedAtUtc).endsWith('Z')
      || !nonNegativeInteger(command.durationMs)
      || command.status !== 'passed'
      || command.exitCode !== 0
      || !nonEmptyString(command.stdoutSha256)
      || !digestPattern.test(command.stdoutSha256)
      || !nonEmptyString(command.stderrSha256)
      || !digestPattern.test(command.stderrSha256)
    ))
    || !isObject(value.tests)
    || !hasOnlyKeys(value.tests, ['total', 'passed', 'failed', 'skipped'])
    || !nonNegativeInteger(value.tests.total)
    || !nonNegativeInteger(value.tests.passed)
    || Number(value.tests.total) < 1
    || Number(value.tests.passed) < 1
    || value.tests.failed !== 0
    || !nonNegativeInteger(value.tests.skipped)
    || value.tests.total !== Number(value.tests.passed) + Number(value.tests.skipped)
  ) {
    errors.push('receipt commands and tests must prove deterministic validation passed');
  }
  if (
    !Array.isArray(value.artifacts)
    || value.artifacts.length > 256
    || value.artifacts.some((artifact) => (
      !isObject(artifact)
      || !hasOnlyKeys(artifact, ['path', 'sha256', 'mediaType'])
      || !nonEmptyString(artifact.path)
      || artifact.path.length > 1024
      || !nonEmptyString(artifact.sha256)
      || !digestPattern.test(artifact.sha256)
      || !nonEmptyString(artifact.mediaType)
      || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(artifact.mediaType)
    ))
  ) {
    errors.push('receipt.artifacts must be privacy-safe hashed artifact references');
  }
  if (
    !isObject(value.metrics)
    || !hasOnlyKeys(value.metrics, [
      'inputWorkItems',
      'processedItems',
      'changedItems',
      'retryCount',
      'deferralCount',
      'errorCount',
      'inputTokens',
      'outputTokens',
      'billedCents',
      'hostPressure',
      'backendLatencyMs',
      'freshnessAtUtc',
      'caller',
    ])
    || !nonNegativeInteger(value.metrics.inputWorkItems)
    || !nonNegativeInteger(value.metrics.processedItems)
    || !nonNegativeInteger(value.metrics.changedItems)
    || !nonNegativeInteger(value.metrics.retryCount)
    || Number(value.metrics.retryCount) > 2
    || !nonNegativeInteger(value.metrics.deferralCount)
    || value.metrics.errorCount !== 0
    || (value.metrics.inputTokens !== null && !nonNegativeInteger(value.metrics.inputTokens))
    || (value.metrics.outputTokens !== null && !nonNegativeInteger(value.metrics.outputTokens))
    || (value.metrics.billedCents !== null && !nonNegativeInteger(value.metrics.billedCents))
    || !['unknown', 'normal', 'elevated', 'critical'].includes(String(value.metrics.hostPressure))
    || (value.metrics.backendLatencyMs !== null && !nonNegativeInteger(value.metrics.backendLatencyMs))
    || !validIsoDate(value.metrics.freshnessAtUtc)
    || !String(value.metrics.freshnessAtUtc).endsWith('Z')
    || !nonEmptyString(value.metrics.caller)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value.metrics.caller)
  ) {
    errors.push('receipt.metrics must contain bounded factory run accounting');
  }
  if (
    !isObject(value.review)
    || !hasOnlyKeys(value.review, [
      'reviewerId',
      'decision',
      'freshSession',
      'builderSessionReused',
      'reviewedAtUtc',
      'evidenceSha256',
    ])
    || value.review.decision !== 'accept'
    || value.review.freshSession !== true
    || value.review.builderSessionReused !== false
    || !boundedString(value.review.reviewerId, 160)
    || !validIsoDate(value.review.reviewedAtUtc)
    || !String(value.review.reviewedAtUtc).endsWith('Z')
    || !nonEmptyString(value.review.evidenceSha256)
    || !digestPattern.test(value.review.evidenceSha256)
  ) {
    errors.push('receipt.review must prove an accepted independent reviewer');
  }
  if (
    !Array.isArray(value.approvals)
    || value.approvals.length > 64
    || value.approvals.some((approval) => (
      !isObject(approval)
      || !hasOnlyKeys(approval, ['requestId', 'kind', 'status', 'resolvedAtUtc'])
      || !nonEmptyString(approval.requestId)
      || !idPattern.test(approval.requestId)
      || !['paperclip-approval', 'tool-gateway-action', 'request-confirmation', 'human-release'].includes(String(approval.kind))
      || !['pending', 'approved', 'rejected', 'expired'].includes(String(approval.status))
      || (approval.resolvedAtUtc !== null && (!validIsoDate(approval.resolvedAtUtc) || !String(approval.resolvedAtUtc).endsWith('Z')))
    ))
  ) {
    errors.push('receipt.approvals must be a bounded evidence array');
  }
  if (
    !isObject(value.release)
    || !hasOnlyKeys(value.release, [
      'attempted',
      'pushed',
      'remoteRef',
      'commitSha',
      'remoteReadbackSha',
      'startedAtUtc',
      'finishedAtUtc',
    ])
    || value.release.attempted !== true
    || value.release.pushed !== true
    || value.release.remoteRef !== 'refs/heads/dev'
    || !nonEmptyString(value.release.commitSha)
    || !gitShaPattern.test(value.release.commitSha)
    || value.release.remoteReadbackSha !== value.release.commitSha
    || (isObject(value.repository) && value.repository.finalSha !== value.release.commitSha)
    || !validIsoDate(value.release.startedAtUtc)
    || !String(value.release.startedAtUtc).endsWith('Z')
    || !validIsoDate(value.release.finishedAtUtc)
    || !String(value.release.finishedAtUtc).endsWith('Z')
  ) {
    errors.push('receipt.release must prove pushed origin/dev remote readback');
  }
  const reconciliationStates = new Set(['not_attempted', 'pending', 'matched', 'drifted', 'failed']);
  const reconciliation = isObject(value.reconciliation) ? value.reconciliation : null;
  if (
    !Array.isArray(value.publications)
    || value.publications.length > 64
    || value.publications.some((publication) => (
      !isObject(publication)
      || !hasOnlyKeys(publication, ['target', 'deliveryId', 'status', 'publishedAtUtc'])
      || !['mck', 'mission-control', 'github', 'github-project', 'paperclip'].includes(String(publication.target))
      || !nonEmptyString(publication.deliveryId)
      || !idPattern.test(publication.deliveryId)
      || !['pending', 'delivered', 'failed', 'skipped'].includes(String(publication.status))
      || (publication.publishedAtUtc !== null && (!validIsoDate(publication.publishedAtUtc) || !String(publication.publishedAtUtc).endsWith('Z')))
    ))
    || !reconciliation
    || !hasOnlyKeys(reconciliation, ['mck', 'paperclip', 'missionControl', 'githubProject', 'git'])
    || !['mck', 'paperclip', 'missionControl', 'githubProject', 'git'].every(
      (key) => reconciliationStates.has(String(reconciliation?.[key])),
    )
    || reconciliation?.paperclip !== 'matched'
    || reconciliation?.git !== 'matched'
  ) {
    errors.push('receipt publications and reconciliation evidence are incomplete');
  }
  if (
    !isObject(value.privacy)
    || !hasOnlyKeys(value.privacy, [
      'secretsIncluded',
      'directContactOrPaymentIdentifiersIncluded',
      'rawPrivateLogsIncluded',
      'redactionApplied',
    ])
    || value.privacy.secretsIncluded !== false
    || value.privacy.directContactOrPaymentIdentifiersIncluded !== false
    || value.privacy.rawPrivateLogsIncluded !== false
    || typeof value.privacy.redactionApplied !== 'boolean'
    || !Array.isArray(value.errors)
    || value.errors.length !== 0
  ) {
    errors.push('receipt.privacy must prove no secrets, contact/payment identifiers, or raw private logs');
  }
  return errors.length === 0;
}

/**
 * Identity a caller already knows from the persisted dispatch it accepted.
 * Supplying it is what makes receipt validation a real binding check; without
 * it the validator only proves the receipt is internally well-formed, and the
 * caller stays responsible for binding it to a dispatch.
 */
export interface ExpectedFactoryReceiptIdentity {
  envelopeId: string;
  correlationId: string;
  /** Bare 64-hex task revision, without the `sha256:` prefix. */
  taskRevision: string;
  repositorySlug: string;
  repositoryBaseSha: string;
  allowedFileScope?: string[];
}

function validateFactoryReceipt(
  value: unknown,
  errors: string[],
  requireAuthoritativeCompletion: boolean,
  expectedIdentity?: ExpectedFactoryReceiptIdentity,
): { receipt?: FactoryRunReceipt; authority?: FactoryReceiptAuthorityProjection } {
  if (!isObject(value)) {
    errors.push(requireAuthoritativeCompletion
      ? 'completed lifecycle callbacks require receipt proof'
      : 'receipt must be an object when provided');
    return {};
  }
  if (value.schemaVersion === FACTORY_RUN_RECEIPT_V1_SCHEMA_VERSION) {
    const valid = validateFactoryReceiptV1(value, errors);
    if (valid && requireAuthoritativeCompletion) {
      errors.push('factory-run-receipt v1 is compatibility-read-only; completed requires v2 release authority');
    }
    if (!valid) return {};
    return {
      receipt: value as unknown as FactoryRunReceipt,
      authority: {
        schemaVersion: FACTORY_RUN_RECEIPT_V1_SCHEMA_VERSION,
        authority: 'v1-legacy-compatibility',
        receiptId: String(value.receiptId),
        status: String(value.status),
        canonicalSha256: canonicalFactoryDigest(value),
        validationSucceeded: false,
        independentReviewAccepted: false,
        remoteCommitReadbackVerified: false,
        privacyVerified: false,
      },
    };
  }
  if (value.schemaVersion !== FACTORY_RUN_RECEIPT_V2_SCHEMA_VERSION) {
    errors.push('receipt.schemaVersion must be a supported factory-run-receipt version');
    return {};
  }
  try {
    // Only a caller-supplied identity can bind this receipt to a dispatch. The
    // previous `expected` object was read back out of `value` itself, so every
    // comparison compared a field with itself and always passed; passing
    // undefined states honestly that no identity binding runs here. The v1
    // rejection that `requireAuthoritativeCompletion` used to carry is already
    // enforced by the v1 branch above, which this line is only reached past.
    const receipt = validateBridgeReceipt(
      value,
      expectedIdentity
        ? { ...expectedIdentity, requireAuthoritativeCompletion }
        : undefined,
    );
    return {
      receipt: receipt as FactoryRunReceipt,
      authority: projectFactoryReceiptAuthority(receipt),
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'receipt v2 release authority is invalid');
    return {};
  }
}

export interface WebhookCallbackValidationOptions {
  /**
   * Identity of the dispatch this callback is claimed to answer, read from
   * persistence by the caller. When supplied, a completed v2 receipt must match
   * it; when omitted, the caller keeps sole responsibility for that binding
   * (the agent-completion route does this in `lifecycleRejection`).
   */
  expectedReceiptIdentity?: ExpectedFactoryReceiptIdentity;
}

export function validateWebhookCallbackPayload(
  payload: unknown,
  options?: WebhookCallbackValidationOptions,
): WebhookCallbackValidationResult {
  const errors: string[] = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['Payload must be a JSON object'] };
  }

  if (payload.type === 'mck.callback.lifecycle' || payload.schema_version === '2') {
    if (!hasOnlyKeys(payload, [
      'schema_version',
      'type',
      'task_id',
      'attempt_id',
      'correlation_id',
      'task_revision',
      'status',
      'occurred_at',
      'summary',
      'result',
      'error',
      'receipt',
      'metadata',
    ])) {
      errors.push('lifecycle callback contains undeclared fields');
    }
    if (payload.schema_version !== '2') errors.push('schema_version must be "2"');
    if (payload.type !== 'mck.callback.lifecycle') errors.push('type must be "mck.callback.lifecycle"');
    if (!boundedString(payload.task_id, 160)) errors.push('task_id is required and must be <= 160 chars');
    if (!boundedString(payload.attempt_id, 160)) errors.push('attempt_id is required and must be <= 160 chars');
    if (!boundedString(payload.correlation_id, 240)) errors.push('correlation_id is required and must be <= 240 chars');
    if (!nonEmptyString(payload.task_revision) || !/^[a-f0-9]{64}$/.test(payload.task_revision)) {
      errors.push('task_revision must be a lowercase SHA-256 hex digest');
    }
    if (!validLifecycleStatus(payload.status)) errors.push('status is not a supported lifecycle status');
    if (!validIsoDate(payload.occurred_at)) errors.push('occurred_at must be an ISO date-time string');
    if (!boundedString(payload.summary, 2000)) errors.push('summary is required and must be <= 2000 chars');
    if (payload.result !== undefined && !isObject(payload.result)) errors.push('result must be an object');
    if (payload.metadata !== undefined && !isObject(payload.metadata)) errors.push('metadata must be an object');
    if (['failed', 'blocked', 'needs_human'].includes(String(payload.status))) {
      const error = payload.error;
      if (
        error !== undefined
        && (
          !isObject(error)
          || !hasOnlyKeys(error, ['code', 'message', 'retryable'])
          || !boundedString(error.code, 120)
          || !boundedString(error.message, 1000)
          || (error.retryable !== undefined && typeof error.retryable !== 'boolean')
        )
      ) {
        errors.push('error must include bounded code and message fields');
      }
    }
    let receiptValidation: ReturnType<typeof validateFactoryReceipt> = {};
    if (payload.receipt !== undefined || payload.status === 'completed') {
      receiptValidation = validateFactoryReceipt(
        payload.receipt,
        errors,
        payload.status === 'completed',
        options?.expectedReceiptIdentity,
      );
      if (isObject(payload.receipt)) {
        if (payload.receipt.correlationId !== payload.correlation_id) {
          errors.push('receipt.correlationId must match callback correlation_id');
        }
        if (payload.receipt.taskRevisionSha256 !== `sha256:${payload.task_revision}`) {
          errors.push('receipt.taskRevisionSha256 must match callback task_revision');
        }
      }
    }
    if (errors.length) return { ok: false, errors };

    return {
      ok: true,
      errors: [],
      normalized: {
        mode: 'canonical',
        event_type: 'mck.callback.lifecycle',
        task_id: String(payload.task_id),
        attempt_id: String(payload.attempt_id),
        correlation_id: String(payload.correlation_id),
        task_revision: String(payload.task_revision),
        summary: String(payload.summary),
        status: payload.status as WebhookLifecycleStatus,
        completed_at: String(payload.occurred_at),
        receipt: receiptValidation.receipt,
        receipt_authority: receiptValidation.authority,
        raw: payload,
      },
    };
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
