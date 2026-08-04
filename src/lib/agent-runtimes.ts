import type { Agent, AgentRuntimeConfig, AgentRuntimeType, Task, Workspace } from './types';

export const AGENT_RUNTIME_TYPES: AgentRuntimeType[] = ['manual', 'openclaw', 'webhook'];
export const DEFAULT_WEBHOOK_SIGNATURE_SECRET_ENV = 'MCK_WEBHOOK_SIGNATURE_SECRET';

export const AGENT_RUNTIME_LABELS: Record<AgentRuntimeType, string> = {
  manual: 'Manual handoff',
  openclaw: 'OpenClaw auto',
  webhook: 'Webhook auto',
};

export const AGENT_RUNTIME_DESCRIPTIONS: Record<AgentRuntimeType, string> = {
  manual: 'MCK tracks ownership only. Copy the handoff prompt into the agent\'s native surface.',
  openclaw: 'MCK dispatches through the OpenClaw gateway and session map.',
  webhook: 'MCK POSTs a canonical dispatch payload to the configured webhook endpoint.',
};

export interface CallbackUrls {
  activity: string;
  deliverable: string;
  status: string;
  dispatch: string;
}

export interface LifecycleCallbackUrls extends CallbackUrls {
  lifecycle: string;
}

export interface ManualHandoffPromptInput {
  task: Pick<
    Task,
    | 'id'
    | 'title'
    | 'description'
    | 'priority'
    | 'due_date'
    | 'dispatch_metadata'
    | 'github_source'
  >;
  agent?: Pick<Agent, 'name' | 'role' | 'runtime_type'> | null;
  missionControlUrl: string;
  projectsPath: string;
  mode?: 'manual' | 'auto';
}

export interface WebhookDispatchPayload {
  event: 'mck.task.dispatch';
  version: 1;
  task: {
    id: string;
    title: string;
    description?: string;
    priority: string;
    due_date?: string | null;
    github_source?: Task['github_source'];
    dispatch_metadata?: Task['dispatch_metadata'];
  };
  agent: {
    id: string;
    name: string;
    role: string;
    runtime_type: AgentRuntimeType;
  };
  callbacks: CallbackUrls;
  callback_urls: CallbackUrls;
  mission_control_url: string;
  output_directory: string;
  prompt_markdown: string;
  issued_at: string;
}

export interface FactoryDispatchIdentity {
  attempt_id: string;
  delivery_id: string;
  correlation_id: string;
  task_revision: string;
}

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
  };
}

export type AnyWebhookDispatchPayload = WebhookDispatchPayload | WebhookDispatchPayloadV2;

export interface RuntimeAdapterDescriptor {
  type: AgentRuntimeType;
  label: string;
  supports_auto_dispatch: boolean;
}

export interface ResolvedAgentRuntime {
  requested_type: AgentRuntimeType;
  effective_type: AgentRuntimeType;
  dispatch_enabled: boolean;
  supports_auto_dispatch: boolean;
  label: string;
  reason?: string;
}

export function normalizeAgentRuntimeType(value: unknown): AgentRuntimeType {
  return AGENT_RUNTIME_TYPES.indexOf(value as AgentRuntimeType) >= 0 ? (value as AgentRuntimeType) : 'manual';
}

export function normalizeDispatchEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function parseAgentRuntimeConfig(value: unknown): AgentRuntimeConfig {
  if (!value) return {};
  if (typeof value === 'object') return value as AgentRuntimeConfig;
  if (typeof value !== 'string') return {};

  const trimmed = value.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null ? parsed as AgentRuntimeConfig : {};
  } catch {
    return { notes: trimmed };
  }
}

export function serializeAgentRuntimeConfig(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify({ notes: trimmed });
    }
  }
  return JSON.stringify(value);
}

export function normalizeWorkspaceRuntimePolicy(workspace?: Partial<Workspace> | null) {
  return {
    default_runtime_type: normalizeAgentRuntimeType(workspace?.default_runtime_type),
    default_runtime_config: parseAgentRuntimeConfig(workspace?.default_runtime_config),
    default_dispatch_enabled: normalizeDispatchEnabled(workspace?.default_dispatch_enabled),
  };
}

export function resolveAgentRuntimeDefaults(
  input: { runtime_type?: unknown; runtime_config?: unknown; dispatch_enabled?: unknown },
  workspace?: Partial<Workspace> | null,
) {
  const policy = normalizeWorkspaceRuntimePolicy(workspace);
  return {
    runtime_type: input.runtime_type === undefined ? policy.default_runtime_type : normalizeAgentRuntimeType(input.runtime_type),
    runtime_config: input.runtime_config === undefined ? policy.default_runtime_config : parseAgentRuntimeConfig(input.runtime_config),
    dispatch_enabled: input.dispatch_enabled === undefined ? policy.default_dispatch_enabled : normalizeDispatchEnabled(input.dispatch_enabled),
    inherited_from_workspace: input.runtime_type === undefined && input.runtime_config === undefined && input.dispatch_enabled === undefined,
  };
}

export function getDispatchAdapter(runtimeType: unknown): RuntimeAdapterDescriptor {
  const type = normalizeAgentRuntimeType(runtimeType);
  return {
    type,
    label: AGENT_RUNTIME_LABELS[type],
    supports_auto_dispatch: type === 'openclaw' || type === 'webhook',
  };
}

export function resolveAgentRuntime(agent?: Partial<Agent> | null): ResolvedAgentRuntime {
  const requestedType = normalizeAgentRuntimeType(agent?.runtime_type);
  const adapter = getDispatchAdapter(requestedType);
  const dispatchEnabled = normalizeDispatchEnabled(agent?.dispatch_enabled);

  if (!agent) {
    return {
      requested_type: 'manual',
      effective_type: 'manual',
      dispatch_enabled: false,
      supports_auto_dispatch: false,
      label: AGENT_RUNTIME_LABELS.manual,
      reason: 'No assigned agent',
    };
  }

  if (!adapter.supports_auto_dispatch) {
    return {
      requested_type: requestedType,
      effective_type: 'manual',
      dispatch_enabled: dispatchEnabled,
      supports_auto_dispatch: false,
      label: AGENT_RUNTIME_LABELS.manual,
      reason: 'Runtime is manual handoff',
    };
  }

  if (!dispatchEnabled) {
    return {
      requested_type: requestedType,
      effective_type: 'manual',
      dispatch_enabled: false,
      supports_auto_dispatch: adapter.supports_auto_dispatch,
      label: AGENT_RUNTIME_LABELS.manual,
      reason: `${adapter.label} is configured but dispatch is disabled`,
    };
  }

  return {
    requested_type: requestedType,
    effective_type: requestedType,
    dispatch_enabled: true,
    supports_auto_dispatch: true,
    label: adapter.label,
  };
}

export function shouldAutoDispatchAgent(agent?: Partial<Agent> | null): boolean {
  const runtime = resolveAgentRuntime(agent);
  return runtime.effective_type === 'openclaw' || runtime.effective_type === 'webhook';
}

export function buildCallbackUrls(taskId: string, missionControlUrl: string): CallbackUrls {
  const base = missionControlUrl.replace(/\/$/, '');
  return {
    activity: `${base}/api/tasks/${taskId}/activities`,
    deliverable: `${base}/api/tasks/${taskId}/deliverables`,
    status: `${base}/api/tasks/${taskId}`,
    dispatch: `${base}/api/tasks/${taskId}/dispatch`,
  };
}

export function buildLifecycleCallbackUrls(taskId: string, missionControlUrl: string): LifecycleCallbackUrls {
  const base = missionControlUrl.replace(/\/$/, '');
  return {
    ...buildCallbackUrls(taskId, missionControlUrl),
    lifecycle: `${base}/api/webhooks/agent-completion`,
  };
}

export function buildOutputDirectory(task: Pick<Task, 'title'>, projectsPath: string): string {
  const projectDir = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mission-control-task';
  return `${projectsPath.replace(/\/$/, '')}/${projectDir}`;
}

function formatList(label: string, values?: string[]) {
  if (!values?.length) return `**${label}:** Not specified`;
  return `**${label}:**\n${values.map((value) => `- ${value}`).join('\n')}`;
}

export function buildManualHandoffPrompt({
  task,
  agent,
  missionControlUrl,
  projectsPath,
  mode = 'manual',
}: ManualHandoffPromptInput): string {
  const callbacks = buildCallbackUrls(task.id, missionControlUrl);
  const metadata = task.dispatch_metadata;
  const outputDirectory = buildOutputDirectory(task, projectsPath);
  const intro = mode === 'auto'
    ? 'Mission Control is launching this task through the configured runtime adapter. Report progress through the callbacks below.'
    : 'Mission Control is tracking this task, but it did not launch your runtime automatically. Work in your native tool and report back through the callbacks below.';

  return [
    '# Mission Control handoff',
    '',
    `You are ${agent?.name ?? 'the assigned agent'}${agent?.role ? ` (${agent.role})` : ''}.`,
    intro,
    '',
    `**Task ID:** ${task.id}`,
    `**Title:** ${task.title}`,
    task.description ? `**Description:** ${task.description}` : '**Description:** Not specified',
    `**Priority:** ${task.priority.toUpperCase()}`,
    task.due_date ? `**Due:** ${task.due_date}` : undefined,
    task.github_source?.issue_url ? `**Source Issue:** ${task.github_source.issue_url}` : undefined,
    metadata?.target_repo ? `**Target Repo:** ${metadata.target_repo}` : undefined,
    metadata?.project_workstream ? `**Workstream:** ${metadata.project_workstream}` : undefined,
    '',
    `**Output directory:** ${outputDirectory}`,
    '',
    formatList('Allowed file scope', metadata?.allowed_file_scope),
    '',
    formatList('Acceptance criteria', metadata?.acceptance_criteria),
    '',
    formatList('Test requirements', metadata?.test_requirements),
    '',
    metadata?.impact ? `**Impact:** ${metadata.impact}` : '**Impact:** Not specified',
    metadata?.rollback_plan ? `**Rollback / fallback:** ${metadata.rollback_plan}` : '**Rollback / fallback:** Not specified',
    '',
    formatList('Safety rules', metadata?.safety_rules),
    '',
    '## Required callbacks',
    '',
    `1. Log progress or completion: POST ${callbacks.activity}`,
    '   Body: {"activity_type":"updated","message":"What changed"}',
    `2. Register deliverables: POST ${callbacks.deliverable}`,
    '   Body: {"deliverable_type":"file","title":"File name","path":"path/to/file"}',
    `3. Move to review when ready: PATCH ${callbacks.status}`,
    '   Body: {"status":"review"}',
    '',
    'When complete, reply with `TASK_COMPLETE: <summary>` and include the verification you actually ran.',
  ].filter(Boolean).join('\n');
}

export function buildWebhookDispatchPayload(
  task: Task,
  agent: Agent,
  missionControlUrl: string,
  issuedAt: string,
  projectsPath: string,
): WebhookDispatchPayload {
  const callbacks = buildCallbackUrls(task.id, missionControlUrl);
  return {
    event: 'mck.task.dispatch',
    version: 1,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      due_date: task.due_date ?? null,
      github_source: task.github_source,
      dispatch_metadata: task.dispatch_metadata,
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
    output_directory: buildOutputDirectory(task, projectsPath),
    prompt_markdown: buildManualHandoffPrompt({
      task,
      agent,
      missionControlUrl,
      projectsPath,
      mode: 'auto',
    }),
    issued_at: issuedAt,
  };
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
  repositoryBaseSha: string,
  repositoryPath?: string,
): WebhookDispatchPayloadV2 {
  const callbacks = buildLifecycleCallbackUrls(task.id, missionControlUrl);
  const metadata = task.dispatch_metadata;
  const repository = parseRepositorySlug(task);
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
    output_directory: repositoryPath ?? buildOutputDirectory(task, projectsPath),
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
      envelope_id: `factory:${dispatch.attempt_id}`,
      repository: {
        ...repository,
        active_branch: 'dev',
        base_sha: repositoryBaseSha,
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
    },
  };
}

export function resolveWebhookDispatchVersion(config: AgentRuntimeConfig): 1 | 2 {
  return Number(config.dispatch_version) === 2 ? 2 : 1;
}

export function getWebhookUrl(
  config: AgentRuntimeConfig,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const directUrl = typeof config.webhook_url === 'string'
    ? config.webhook_url
    : typeof config.url === 'string'
      ? config.url
      : null;
  const envKey = typeof config.webhook_url_env === 'string'
    ? config.webhook_url_env
    : typeof config.url_env === 'string'
      ? config.url_env
      : null;
  const url = directUrl || (envKey ? env[envKey] : null);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function getWebhookSignatureSecret(
  config: AgentRuntimeConfig,
  env: Record<string, string | undefined> = process.env,
) {
  const envName = typeof config.signature_secret_env === 'string' && config.signature_secret_env.trim()
    ? config.signature_secret_env.trim()
    : DEFAULT_WEBHOOK_SIGNATURE_SECRET_ENV;
  const value = env[envName]?.trim();
  return {
    env_name: envName,
    secret: value || null,
    configured: Boolean(value),
  };
}

export function buildWebhookHeaders(
  config: AgentRuntimeConfig,
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const extraHeaders = typeof config.headers === 'object' && config.headers !== null ? config.headers : undefined;
  if (extraHeaders) {
    for (const key in extraHeaders) {
      const value = extraHeaders[key];
      if (typeof value === 'string' && !/authorization|token|secret|key/i.test(key)) {
        headers[key] = value;
      }
    }
  }

  if (typeof config.bearer_token_env === 'string') {
    const token = env[config.bearer_token_env];
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return headers;
}
