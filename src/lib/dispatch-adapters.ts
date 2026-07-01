import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';
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
  getWebhookUrl,
  parseAgentRuntimeConfig,
  resolveAgentRuntime,
} from '@/lib/agent-runtimes';
import type { Agent, AgentRuntimeType, OpenClawSession, Task } from '@/lib/types';

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
  return Math.min(Math.max(1_000, Math.floor(numeric)), MAX_WEBHOOK_TIMEOUT_MS);
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
  if (!client.isConnected()) {
    try {
      await client.connect();
    } catch (err) {
      console.error('Failed to connect to OpenClaw Gateway:', err);
      throw new DispatchAdapterError('Failed to connect to OpenClaw Gateway', 503);
    }
  }

  let session = queryOne<OpenClawSession>(
    'SELECT * FROM openclaw_sessions WHERE agent_id = ? AND status = ?',
    [agent.id, 'active']
  );

  const now = new Date().toISOString();

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
    throw new DispatchAdapterError(
      `Failed to send task to OpenClaw agent: ${err instanceof Error ? err.message : 'Unknown error'}`,
      500
    );
  }

  markTaskDispatched(task, agent, 'openclaw', `Task "${task.title}" dispatched to ${agent.name} via OpenClaw`, now);

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
  const headers = buildWebhookHeaders(config, process.env);
  const timeoutMs = getWebhookTimeoutMs(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('Webhook dispatch failed:', err);
    const wasAbort = err instanceof Error && err.name === 'AbortError';
    throw new DispatchAdapterError(
      wasAbort
        ? `Webhook dispatch timed out after ${timeoutMs}ms`
        : `Webhook dispatch failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      wasAbort ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new DispatchAdapterError(
      `Webhook dispatch returned HTTP ${response.status}`,
      502,
      { status: response.status, body: responseText.slice(0, 1000) }
    );
  }

  markTaskDispatched(task, agent, 'webhook', `Task "${task.title}" dispatched to ${agent.name} via webhook`, now);

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

export async function dispatchTaskToAssignedAgent(taskId: string): Promise<DispatchResult> {
  const task = loadTask(taskId);
  if (!task.assigned_agent_id) {
    throw new DispatchAdapterError('Task has no assigned agent', 400);
  }

  const agent = loadAgent(task.assigned_agent_id);
  const resolved = resolveAgentRuntime(agent);

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
