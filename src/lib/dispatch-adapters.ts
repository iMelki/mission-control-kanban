import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getMissionControlUrl, getProjectsPath } from '@/lib/config';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { parseDispatchMetadata, validateDispatchMetadata } from '@/lib/dispatch-contract';
import { normalizeGitHubSourceIdentity } from '@/lib/github-task-import';
import { normalizeAgentForResponse, type AgentRow } from '@/lib/agent-api';
import {
  buildCallbackUrls,
  buildManualHandoffPrompt,
  buildWebhookDispatchPayload,
  buildWebhookHeaders,
  getWebhookSignatureSecret,
  getWebhookUrl,
  parseAgentRuntimeConfig,
  resolveAgentRuntime,
} from '@/lib/agent-runtimes';
import { validateWebhookDispatchPayload } from '@/lib/webhook-dispatch-schema';
import { checkDispatchRetryBudget } from '@/lib/runtime-operations';
import { buildSignedWebhookHeaders } from '@/lib/webhook-signatures';
import type { Agent, AgentRuntimeType, DispatchAttemptStatus, OpenClawSession, Task, TaskDispatchAttempt } from '@/lib/types';

type TaskDispatchRow = Omit<Task, 'dispatch_metadata' | 'github_source' | 'assigned_agent'> & {
  dispatch_metadata?: string | null;
  source_repo_owner?: string | null;
  source_repo_name?: string | null;
  source_issue_number?: number | null;
  source_issue_url?: string | null;
  source_project_item_id?: string | null;
};

const DEFAULT_WEBHOOK_TIMEOUT_MS = 30_000;
const MAX_WEBHOOK_TIMEOUT_MS = 120_000;
const MIN_WEBHOOK_TIMEOUT_MS = 100;

export interface DispatchOptions {
  retry?: boolean;
  confirm?: boolean;
  dryRun?: boolean;
}

interface RecordDispatchAttemptInput {
  task: Task;
  agent: Agent;
  runtimeType: AgentRuntimeType;
  status: DispatchAttemptStatus;
  message: string;
  now: string;
  adapterName?: string;
  httpStatus?: number | null;
  webhookUrl?: string | null;
  errorMessage?: string | null;
  requestPayload?: unknown;
  responseBody?: string | null;
}

function redactUrlForResponse(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[invalid webhook url]';
  }
}

function getWebhookTimeoutMs(config: ReturnType<typeof parseAgentRuntimeConfig>) {
  const raw = config.timeout_ms ?? config.webhook_timeout_ms;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_WEBHOOK_TIMEOUT_MS;
  }
  return Math.min(Math.max(MIN_WEBHOOK_TIMEOUT_MS, Math.floor(numeric)), MAX_WEBHOOK_TIMEOUT_MS);
}

function nextAttemptNumber(taskId: string) {
  const latest = queryOne<{ attempt_number: number }>(
    'SELECT attempt_number FROM task_dispatch_attempts WHERE task_id = ? ORDER BY attempt_number DESC LIMIT 1',
    [taskId]
  );
  return (latest?.attempt_number ?? 0) + 1;
}

function safeJsonStringify(value: unknown) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'Payload could not be serialized for audit' });
  }
}

function recordDispatchAttempt({
  task,
  agent,
  runtimeType,
  status,
  message,
  now,
  adapterName,
  httpStatus,
  webhookUrl,
  errorMessage,
  requestPayload,
  responseBody,
}: RecordDispatchAttemptInput) {
  run(
    `INSERT INTO task_dispatch_attempts (
      id, task_id, agent_id, runtime_type, adapter_name, status, attempt_number,
      message, http_status, webhook_url, error_message, request_payload, response_body, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      task.id,
      agent.id,
      runtimeType,
      adapterName ?? runtimeType,
      status,
      nextAttemptNumber(task.id),
      message,
      httpStatus ?? null,
      webhookUrl ?? null,
      errorMessage ?? null,
      requestPayload ? safeJsonStringify(requestPayload) : null,
      responseBody ?? null,
      now,
    ]
  );
}

export function getDispatchAttempts(taskId: string, limit = 20): TaskDispatchAttempt[] {
  return queryAll<TaskDispatchAttempt>(
    `SELECT * FROM task_dispatch_attempts
     WHERE task_id = ?
     ORDER BY attempt_number DESC, created_at DESC
     LIMIT ?`,
    [taskId, limit]
  );
}

function getLatestDispatchAttempt(taskId: string): TaskDispatchAttempt | undefined {
  return queryOne<TaskDispatchAttempt>(
    `SELECT * FROM task_dispatch_attempts
     WHERE task_id = ?
     ORDER BY attempt_number DESC, created_at DESC
     LIMIT 1`,
    [taskId]
  );
}

export interface DispatchResult {
  success: boolean;
  task_id: string;
  agent_id: string;
  runtime_type: AgentRuntimeType;
  requested_runtime_type: AgentRuntimeType;
  dispatched: boolean;
  message: string;
  handoff_prompt?: string;
  callbacks?: ReturnType<typeof buildCallbackUrls>;
  session_id?: string;
  webhook_status?: number;
  webhook_url?: string;
  reason?: string;
  dry_run?: boolean;
  would_dispatch?: boolean;
  request_payload?: unknown;
  validation_errors?: string[];
}

export class DispatchAdapterError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'DispatchAdapterError';
    this.status = status;
    this.details = details;
  }
}

function taskFromRow(row: TaskDispatchRow): Task {
  const githubSource = normalizeGitHubSourceIdentity({
    repo_owner: row.source_repo_owner,
    repo_name: row.source_repo_name,
    issue_number: row.source_issue_number,
    issue_url: row.source_issue_url,
    project_item_id: row.source_project_item_id,
  });

  const {
    source_repo_owner,
    source_repo_name,
    source_issue_number,
    source_issue_url,
    source_project_item_id,
    dispatch_metadata,
    ...rest
  } = row;

  return {
    ...rest,
    dispatch_metadata: parseDispatchMetadata(dispatch_metadata),
    github_source: githubSource,
  };
}

function loadTask(taskId: string): Task {
  const task = queryOne<TaskDispatchRow>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) {
    throw new DispatchAdapterError('Task not found', 404);
  }
  if (!task.assigned_agent_id) {
    throw new DispatchAdapterError('Task has no assigned agent', 400);
  }
  return taskFromRow(task);
}

function loadAgent(agentId: string): Agent {
  const agent = queryOne<AgentRow>('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) {
    throw new DispatchAdapterError('Assigned agent not found', 404);
  }
  return normalizeAgentForResponse(agent) as Agent;
}

function markTaskDispatched(task: Task, agent: Agent, runtimeType: AgentRuntimeType, message: string, now: string) {
  run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['in_progress', now, task.id]);
  run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['working', now, agent.id]);
  run(
    `INSERT INTO events (id, type, agent_id, task_id, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      'task_dispatched',
      agent.id,
      task.id,
      message,
      JSON.stringify({ runtime_type: runtimeType, dispatched: true }),
      now,
    ]
  );

  const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [task.id]);
  if (updatedTask) {
    broadcast({
      type: 'task_updated',
      payload: updatedTask,
    });
  }
}

function logManualHandoff(task: Task, agent: Agent, reason: string | undefined, handoffPrompt: string, now: string) {
  const metadata = JSON.stringify({
    runtime_type: agent.runtime_type,
    effective_runtime_type: 'manual',
    dispatch_enabled: agent.dispatch_enabled,
    reason,
  });

  run(
    `INSERT INTO events (id, type, agent_id, task_id, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      'task_dispatched',
      agent.id,
      task.id,
      `Manual handoff prompt generated for "${task.title}" and ${agent.name}`,
      metadata,
      now,
    ]
  );

  run(
    `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      task.id,
      agent.id,
      'updated',
      `Manual handoff prompt generated. MCK did not auto-launch ${agent.name}.`,
      JSON.stringify({ reason, handoff_prompt_preview: handoffPrompt.slice(0, 500) }),
      now,
    ]
  );
}

async function dispatchManual(task: Task, agent: Agent, reason?: string): Promise<DispatchResult> {
  const missionControlUrl = getMissionControlUrl();
  const projectsPath = getProjectsPath();
  const now = new Date().toISOString();
  const handoffPrompt = buildManualHandoffPrompt({
    task,
    agent,
    missionControlUrl,
    projectsPath,
  });

  logManualHandoff(task, agent, reason, handoffPrompt, now);
  recordDispatchAttempt({
    task,
    agent,
    runtimeType: 'manual',
    status: 'manual',
    message: 'Manual handoff prompt generated; no runtime auto-launch was attempted.',
    now,
    adapterName: 'manual',
  });

  return {
    success: true,
    task_id: task.id,
    agent_id: agent.id,
    runtime_type: 'manual',
    requested_runtime_type: agent.runtime_type,
    dispatched: false,
    message: 'Manual handoff prompt generated; task status was not moved forward automatically.',
    handoff_prompt: handoffPrompt,
    callbacks: buildCallbackUrls(task.id, missionControlUrl),
    reason,
  };
}

async function dispatchOpenClaw(task: Task, agent: Agent): Promise<DispatchResult> {
  const client = getOpenClawClient();
  const now = new Date().toISOString();
  if (!client.isConnected()) {
    try {
      await client.connect();
    } catch (err) {
      console.error('Failed to connect to OpenClaw Gateway:', err);
      recordDispatchAttempt({
        task,
        agent,
        runtimeType: 'openclaw',
        status: 'failed',
        message: 'OpenClaw adapter could not connect to the gateway.',
        now,
        adapterName: 'openclaw',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
      throw new DispatchAdapterError('Failed to connect to OpenClaw Gateway', 503);
    }
  }

  let session = queryOne<OpenClawSession>(
    'SELECT * FROM openclaw_sessions WHERE agent_id = ? AND status = ?',
    [agent.id, 'active']
  );

  if (!session) {
    const sessionId = uuidv4();
    const configuredSessionId = typeof agent.runtime_config === 'object' && agent.runtime_config && typeof agent.runtime_config.session_id === 'string'
      ? agent.runtime_config.session_id
      : null;
    const openclawSessionId = configuredSessionId || `mission-control-${agent.name.toLowerCase().replace(/\s+/g, '-')}`;
    const channel = typeof agent.runtime_config === 'object' && agent.runtime_config && typeof agent.runtime_config.channel === 'string'
      ? agent.runtime_config.channel
      : 'mission-control';

    run(
      `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, agent.id, openclawSessionId, channel, 'active', now, now]
    );

    session = queryOne<OpenClawSession>('SELECT * FROM openclaw_sessions WHERE id = ?', [sessionId]);

    run(
      `INSERT INTO events (id, type, agent_id, message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'agent_status_changed', agent.id, `${agent.name} session created`, now]
    );
  }

  if (!session) {
    throw new DispatchAdapterError('Failed to create agent session', 500);
  }

  const missionControlUrl = getMissionControlUrl();
  const projectsPath = getProjectsPath();
  const taskMessage = buildManualHandoffPrompt({
    task,
    agent,
    missionControlUrl,
    projectsPath,
    mode: 'auto',
  });

  try {
    const sessionKey = `agent:main:${session.openclaw_session_id}`;
    await client.call('chat.send', {
      sessionKey,
      message: taskMessage,
      idempotencyKey: `dispatch-${task.id}-${Date.now()}`,
    });
  } catch (err) {
    console.error('Failed to send message to OpenClaw agent:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    recordDispatchAttempt({
      task,
      agent,
      runtimeType: 'openclaw',
      status: 'failed',
      message: 'OpenClaw adapter failed while sending the task handoff.',
      now,
      adapterName: 'openclaw',
      errorMessage,
    });
    throw new DispatchAdapterError(
      `Failed to send task to OpenClaw agent: ${errorMessage}`,
      500
    );
  }

  markTaskDispatched(task, agent, 'openclaw', `Task "${task.title}" dispatched to ${agent.name} via OpenClaw`, now);
  recordDispatchAttempt({
    task,
    agent,
    runtimeType: 'openclaw',
    status: 'success',
    message: `Task "${task.title}" dispatched to ${agent.name} via OpenClaw`,
    now,
    adapterName: 'openclaw',
  });

  return {
    success: true,
    task_id: task.id,
    agent_id: agent.id,
    runtime_type: 'openclaw',
    requested_runtime_type: agent.runtime_type,
    dispatched: true,
    session_id: session.openclaw_session_id,
    message: 'Task dispatched to OpenClaw agent',
  };
}

function buildDispatchDryRunPreview(task: Task, agent: Agent, effectiveRuntimeType: AgentRuntimeType, reason?: string): DispatchResult {
  const missionControlUrl = getMissionControlUrl();
  const projectsPath = getProjectsPath();
  const handoffPrompt = buildManualHandoffPrompt({
    task,
    agent,
    missionControlUrl,
    projectsPath,
    mode: effectiveRuntimeType === 'manual' ? 'manual' : 'auto',
  });
  const callbacks = buildCallbackUrls(task.id, missionControlUrl);

  if (effectiveRuntimeType === 'webhook') {
    const config = parseAgentRuntimeConfig(agent.runtime_config);
    const webhookUrl = getWebhookUrl(config, process.env);
    const signature = getWebhookSignatureSecret(config, process.env);
    const payload = buildWebhookDispatchPayload(task, agent, missionControlUrl, new Date().toISOString(), projectsPath);
    const validation = validateWebhookDispatchPayload(payload);
    const ready = validation.valid && Boolean(webhookUrl) && signature.configured;
    return {
      success: ready,
      task_id: task.id,
      agent_id: agent.id,
      runtime_type: 'webhook',
      requested_runtime_type: agent.runtime_type,
      dispatched: false,
      dry_run: true,
      would_dispatch: ready,
      webhook_url: webhookUrl ? redactUrlForResponse(webhookUrl) : undefined,
      request_payload: payload,
      validation_errors: validation.valid ? undefined : validation.errors,
      message: ready
        ? 'Dry-run preview: webhook payload is valid; no request was sent.'
        : 'Dry-run preview: webhook dispatch is not ready.',
      handoff_prompt: handoffPrompt,
      callbacks,
      reason: !webhookUrl
        ? 'Webhook URL is not configured or could not be resolved from env.'
        : !signature.configured
          ? `Webhook signing secret env ${signature.env_name} is not configured.`
          : reason,
    };
  }

  return {
    success: true,
    task_id: task.id,
    agent_id: agent.id,
    runtime_type: effectiveRuntimeType,
    requested_runtime_type: agent.runtime_type,
    dispatched: false,
    dry_run: true,
    would_dispatch: effectiveRuntimeType === 'openclaw',
    message: effectiveRuntimeType === 'openclaw'
      ? 'Dry-run preview: OpenClaw handoff would be sent; no gateway call was made.'
      : 'Dry-run preview: manual handoff prompt generated; no side effects were recorded.',
    handoff_prompt: handoffPrompt,
    callbacks,
    reason,
  };
}

async function dispatchWebhook(task: Task, agent: Agent): Promise<DispatchResult> {
  const config = parseAgentRuntimeConfig(agent.runtime_config);
  const webhookUrl = getWebhookUrl(config);
  if (!webhookUrl) {
    throw new DispatchAdapterError('Webhook runtime requires runtime_config.webhook_url or runtime_config.url', 400);
  }

  const now = new Date().toISOString();
  const missionControlUrl = getMissionControlUrl();
  const projectsPath = getProjectsPath();
  const payload = buildWebhookDispatchPayload(task, agent, missionControlUrl, now, projectsPath);
  const payloadValidation = validateWebhookDispatchPayload(payload);
  if (!payloadValidation.valid) {
    recordDispatchAttempt({
      task,
      agent,
      runtimeType: 'webhook',
      status: 'failed',
      message: 'Webhook dispatch payload failed local JSON Schema validation.',
      now,
      adapterName: 'webhook',
      errorMessage: payloadValidation.errors.join('; '),
      requestPayload: payload,
      webhookUrl: redactUrlForResponse(webhookUrl),
    });
    throw new DispatchAdapterError('Webhook dispatch payload failed schema validation', 500, {
      validation_errors: payloadValidation.errors,
    });
  }
  const payloadBody = JSON.stringify(payload);
  const headers = buildWebhookHeaders(config, process.env);
  const signature = getWebhookSignatureSecret(config, process.env);
  if (!signature.secret) {
    const errorMessage = `Webhook signing secret env ${signature.env_name} is not configured.`;
    recordDispatchAttempt({
      task,
      agent,
      runtimeType: 'webhook',
      status: 'failed',
      message: 'Webhook dispatch blocked before network request.',
      now,
      adapterName: 'webhook',
      webhookUrl: redactUrlForResponse(webhookUrl),
      errorMessage,
      requestPayload: payload,
    });
    throw new DispatchAdapterError(errorMessage, 400, { secret_env: signature.env_name });
  }
  Object.assign(headers, buildSignedWebhookHeaders({
    rawBody: payloadBody,
    secret: signature.secret,
    deliveryId: `dispatch-${task.id}-${now}`,
  }));
  const timeoutMs = getWebhookTimeoutMs(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: payloadBody,
      signal: controller.signal,
    });
  } catch (err) {
    console.error('Webhook dispatch failed:', err);
    const wasAbort = err instanceof Error && err.name === 'AbortError';
    const errorMessage = wasAbort
      ? `Webhook dispatch timed out after ${timeoutMs}ms`
      : `Webhook dispatch failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
    recordDispatchAttempt({
      task,
      agent,
      runtimeType: 'webhook',
      status: wasAbort ? 'timeout' : 'failed',
      message: wasAbort ? 'Webhook dispatch timed out.' : 'Webhook dispatch failed before receiving a response.',
      now,
      adapterName: 'webhook',
      webhookUrl: redactUrlForResponse(webhookUrl),
      errorMessage,
      requestPayload: payload,
    });
    throw new DispatchAdapterError(
      errorMessage,
      wasAbort ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    recordDispatchAttempt({
      task,
      agent,
      runtimeType: 'webhook',
      status: 'failed',
      message: `Webhook dispatch returned HTTP ${response.status}.`,
      now,
      adapterName: 'webhook',
      httpStatus: response.status,
      webhookUrl: redactUrlForResponse(webhookUrl),
      errorMessage: response.statusText || `HTTP ${response.status}`,
      requestPayload: payload,
      responseBody: responseText.slice(0, 1000),
    });
    throw new DispatchAdapterError(
      `Webhook dispatch returned HTTP ${response.status}`,
      502,
      { status: response.status, body: responseText.slice(0, 1000) }
    );
  }

  markTaskDispatched(task, agent, 'webhook', `Task "${task.title}" dispatched to ${agent.name} via webhook`, now);
  recordDispatchAttempt({
    task,
    agent,
    runtimeType: 'webhook',
    status: 'success',
    message: `Task "${task.title}" dispatched to ${agent.name} via webhook`,
    now,
    adapterName: 'webhook',
    httpStatus: response.status,
    webhookUrl: redactUrlForResponse(webhookUrl),
    requestPayload: payload,
  });

  return {
    success: true,
    task_id: task.id,
    agent_id: agent.id,
    runtime_type: 'webhook',
    requested_runtime_type: agent.runtime_type,
    dispatched: true,
    webhook_status: response.status,
    webhook_url: redactUrlForResponse(webhookUrl),
    message: 'Task dispatched through webhook adapter',
  };
}

export async function dispatchTaskToAssignedAgent(taskId: string, options: DispatchOptions = {}): Promise<DispatchResult> {
  const task = loadTask(taskId);
  if (!task.assigned_agent_id) {
    throw new DispatchAdapterError('Task has no assigned agent', 400);
  }

  const agent = loadAgent(task.assigned_agent_id);
  const resolved = resolveAgentRuntime(agent);

  if (options.dryRun) {
    if (resolved.effective_type !== 'manual') {
      const validation = validateDispatchMetadata(task.dispatch_metadata);
      if (!validation.canDispatch) {
        return {
          ...buildDispatchDryRunPreview(task, agent, resolved.effective_type, resolved.reason),
          success: false,
          would_dispatch: false,
          message: `Dry-run preview: dispatch contract is incomplete: ${validation.blockers.join('; ')}`,
          validation_errors: validation.blockers,
        };
      }
    }
    return buildDispatchDryRunPreview(task, agent, resolved.effective_type, resolved.reason);
  }

  if (options.retry) {
    const latestAttempt = getLatestDispatchAttempt(task.id);
    if (resolved.effective_type !== 'webhook') {
      throw new DispatchAdapterError('Only webhook dispatch attempts can be retried safely from MCK', 400);
    }
    if (!latestAttempt || !['failed', 'timeout'].includes(latestAttempt.status)) {
      throw new DispatchAdapterError('No failed webhook dispatch attempt is available to retry', 409);
    }
    const budget = checkDispatchRetryBudget({
      taskId: task.id,
      runtimeType: resolved.effective_type,
      attemptNumber: latestAttempt.attempt_number,
      confirm: options.confirm,
    });
    if (!budget.allowed) {
      const message = budget.reason === 'missing_confirmation'
        ? 'Repeated webhook retries require explicit operator confirmation'
        : budget.reason === 'rate_limited'
          ? 'Webhook retry rate limit reached'
          : 'Too many webhook retry attempts require explicit operator confirmation';
      throw new DispatchAdapterError(message, budget.reason === 'rate_limited' ? 429 : 400, budget);
    }
  }

  if (resolved.effective_type === 'manual') {
    return dispatchManual(task, agent, resolved.reason);
  }

  const validation = validateDispatchMetadata(task.dispatch_metadata);
  if (!validation.canDispatch) {
    throw new DispatchAdapterError(
      `Dispatch contract is incomplete: ${validation.blockers.join('; ')}`,
      400,
      { blockers: validation.blockers }
    );
  }

  if (resolved.effective_type === 'openclaw') {
    return dispatchOpenClaw(task, agent);
  }

  if (resolved.effective_type === 'webhook') {
    return dispatchWebhook(task, agent);
  }

  return dispatchManual(task, agent, 'Unsupported runtime fell back to manual handoff');
}
