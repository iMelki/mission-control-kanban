import type { Agent, Task } from './types';
import {
  buildLifecycleCallbackUrls,
  buildManualHandoffPrompt,
  normalizeAgentRuntimeType,
  parseAgentRuntimeConfig,
  type FactoryDispatchIdentity,
  type LifecycleCallbackUrls,
  type WebhookDispatchPayload,
} from './agent-runtimes';
import {
  FACTORY_TASK_ENVELOPE_V1_SCHEMA_VERSION,
  canonicalFactorySha256,
  type CanonicalFactoryTaskEnvelopeV1,
} from '../../integrations/paperclip-bridge/src/contracts';

export interface WebhookDispatchPayloadV2 {
  event: 'mck.task.dispatch';
  version: 2;
  dispatch: FactoryDispatchIdentity;
  task: WebhookDispatchPayload['task'];
  agent: WebhookDispatchPayload['agent'];
  callbacks: LifecycleCallbackUrls;
  callback_urls: LifecycleCallbackUrls;
  mission_control_url: string;
  output_directory: string;
  prompt_markdown: string;
  issued_at: string;
  factory_contract: {
    schema_version: 'factory-task-envelope.v1';
    envelope_id: string;
    repository: {
      slug: string;
      owner: string;
      name: string;
      active_branch: 'dev';
      base_sha: string;
      allowed_file_scope: string[];
    };
    acceptance_criteria: string[];
    test_requirements: string[];
    risk_level: string;
    review_mode: string;
    impact: string;
    rollback_plan: string;
    safety_rules: string[];
    limits: {
      max_repair_attempts: 2;
      concurrent_mutating_builders: 1;
    };
    envelope: CanonicalFactoryTaskEnvelopeV1;
    envelope_sha256: string;
  };
}

export interface FactoryRepositoryResolution {
  repositoryPath: string;
  repositorySlug: string;
  originRemote: string;
  baseSha: string;
  repositoryManifestSha256: string;
  projectNumber: number;
}

function parseRepositorySlug(task: Task) {
  const targetRepo = task.dispatch_metadata?.target_repo?.trim();
  const source = task.github_source;
  const slug = targetRepo || (source ? `${source.repo_owner}/${source.repo_name}` : '');
  const [owner = '', name = ''] = slug.split('/', 2);
  return { slug, owner, name };
}

export function buildWebhookDispatchPayloadV2(
  task: Task,
  agent: Agent,
  missionControlUrl: string,
  issuedAt: string,
  projectsPath: string,
  dispatch: FactoryDispatchIdentity,
  factoryRepository: FactoryRepositoryResolution,
): WebhookDispatchPayloadV2 {
  const callbacks = buildLifecycleCallbackUrls(task.id, missionControlUrl);
  const metadata = task.dispatch_metadata;
  const repository = parseRepositorySlug(task);
  const runtimeConfig = parseAgentRuntimeConfig(agent.runtime_config);
  const configuredCapabilityProfile = typeof runtimeConfig.capability_profile === 'string'
    ? runtimeConfig.capability_profile.trim()
    : '';
  const capabilityProfile = /^factory-[a-z0-9-]{2,64}$/.test(configuredCapabilityProfile)
    ? configuredCapabilityProfile
    : 'factory-builder';
  const configuredTimeout = Number(runtimeConfig.factory_timeout_seconds);
  const timeoutSeconds = Number.isInteger(configuredTimeout)
    && configuredTimeout >= 60
    && configuredTimeout <= 86_400
    ? configuredTimeout
    : 3_600;
  const envelope: CanonicalFactoryTaskEnvelopeV1 = {
    schemaVersion: FACTORY_TASK_ENVELOPE_V1_SCHEMA_VERSION,
    envelopeId: `factory:${dispatch.attempt_id}`,
    correlationId: dispatch.correlation_id,
    createdAtUtc: issuedAt,
    origin: {
      source: 'github-project',
      taskId: task.id,
      attemptId: dispatch.attempt_id,
      deliveryId: dispatch.delivery_id,
      taskRevisionSha256: `sha256:${dispatch.task_revision}`,
      github: {
        owner: 'iMelki',
        repository: task.github_source?.repo_name ?? repository.name,
        issueNumber: task.github_source?.issue_number ?? 0,
        projectNumber: factoryRepository.projectNumber,
        projectItemId: task.github_source?.project_item_id ?? null,
      },
    },
    repository: {
      path: factoryRepository.repositoryPath,
      slug: factoryRepository.repositorySlug,
      originRemote: factoryRepository.originRemote,
      branch: 'dev',
      baseSha: factoryRepository.baseSha,
      allowedPaths: metadata?.allowed_file_scope ?? [],
    },
    work: {
      title: task.title,
      acceptanceCriteria: metadata?.acceptance_criteria ?? [],
      testRequirements: metadata?.test_requirements ?? [],
      risk: metadata?.risk_level ?? 'medium',
      // Keep this mapping aligned with the `review_mode` alias default below
      // ('human_required' -> 'human-final'): absent metadata must produce the
      // conservative human-review default on both sides or v2 alias readback fails.
      reviewMode: metadata?.review_mode === 'pair_review'
        ? 'pair-review'
        : metadata?.review_mode === 'auto_checks_only'
          ? 'independent'
          : 'human-final',
      rollback: {
        strategy: metadata?.rollback_plan ?? '',
        verification: 'Verify origin/dev and runtime health return to the accepted base state.',
      },
    },
    execution: {
      capabilityProfile,
      maxRepairAttempts: 2,
      timeoutSeconds,
      concurrentMutatingBuilders: 1,
      repositoryManifest: {
        path: '.agentic-factory.json',
        sha256: factoryRepository.repositoryManifestSha256,
      },
      callbacks: [{
        kind: 'mck-lifecycle',
        url: callbacks.lifecycle,
        localOnly: true,
        authenticationRef: 'secret:mck-webhook-callback-signature',
      }],
    },
    privacy: {
      containsSecrets: false,
      containsDirectPersonalIdentifiers: false,
      rawPrivateLogsIncluded: false,
    },
  };
  return {
    event: 'mck.task.dispatch',
    version: 2,
    dispatch,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      due_date: task.due_date ?? null,
      github_source: task.github_source,
      dispatch_metadata: metadata,
    },
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      runtime_type: normalizeAgentRuntimeType(agent.runtime_type),
    },
    callbacks,
    callback_urls: callbacks,
    mission_control_url: missionControlUrl,
    output_directory: factoryRepository.repositoryPath,
    prompt_markdown: buildManualHandoffPrompt({
      task,
      agent,
      missionControlUrl,
      projectsPath,
      mode: 'auto',
    }),
    issued_at: issuedAt,
    factory_contract: {
      schema_version: 'factory-task-envelope.v1',
      envelope_id: envelope.envelopeId,
      repository: {
        ...repository,
        slug: factoryRepository.repositorySlug,
        active_branch: 'dev',
        base_sha: factoryRepository.baseSha,
        allowed_file_scope: metadata?.allowed_file_scope ?? [],
      },
      acceptance_criteria: metadata?.acceptance_criteria ?? [],
      test_requirements: metadata?.test_requirements ?? [],
      risk_level: metadata?.risk_level ?? 'medium',
      review_mode: metadata?.review_mode ?? 'human_required',
      impact: metadata?.impact ?? '',
      rollback_plan: metadata?.rollback_plan ?? '',
      safety_rules: metadata?.safety_rules ?? [],
      limits: {
        max_repair_attempts: 2,
        concurrent_mutating_builders: 1,
      },
      envelope,
      envelope_sha256: canonicalFactorySha256(envelope),
    },
  };
}
