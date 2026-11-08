/**
 * In-browser stand-in for the Mission Control API, used only by the static
 * demo build. It answers the routes the board needs from fictional fixtures
 * and keeps writes in memory (mirrored to sessionStorage), so the board is
 * fully interactive without a server or database.
 *
 * Integrations (OpenClaw, n8n, GitHub, webhooks, files, Paperclip, runtime
 * probes) are not emulated: they answer 503 with "Not available in the demo".
 */

import {
  normalizeDispatchMetadata,
  validateDispatchMetadata,
} from '@/lib/dispatch-contract';
import type { Agent, Task, TaskDependencySummary, TaskStatus, WorkspaceStats } from '@/lib/types';
import {
  DEMO_STATE_VERSION,
  buildDemoState,
  type DemoDependencyRecord,
  type DemoState,
  type DemoTaskRecord,
} from './fixtures';

export const DEMO_UNAVAILABLE_MESSAGE = 'Not available in the demo';

const STORAGE_KEY = 'mck-demo-state';
const TASK_STATUSES: TaskStatus[] = ['planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'done'];
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

export interface DemoResponse {
  status: number;
  body: unknown;
}

let state: DemoState | null = null;

function loadState(): DemoState {
  if (state) return state;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed && parsed.version === DEMO_STATE_VERSION) {
        state = parsed;
        return state;
      }
    }
  } catch {
    // Storage blocked or corrupt: fall back to fresh fixtures.
  }
  state = buildDemoState();
  return state;
}

function saveState() {
  if (!state) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: changes stay in memory for this page only.
  }
}

export function resetDemoState() {
  state = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function newId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

const ok = (body: unknown): DemoResponse => ({ status: 200, body });
const created = (body: unknown): DemoResponse => ({ status: 201, body });
const notFound = (what: string): DemoResponse => ({ status: 404, body: { error: `${what} not found` } });
const badRequest = (error: string): DemoResponse => ({ status: 400, body: { error } });
export const unavailable = (): DemoResponse => ({
  status: 503,
  body: { error: DEMO_UNAVAILABLE_MESSAGE, demo: true },
});

function findTask(id: string) {
  return loadState().tasks.find((item) => item.id === id);
}

function findAgent(id: string | undefined | null) {
  if (!id) return undefined;
  return loadState().agents.find((item) => item.id === id);
}

function dependencySummaries(taskId: string): { blocked_by: TaskDependencySummary[]; blocking: TaskDependencySummary[] } {
  const { dependencies } = loadState();
  const toSummary = (dep: DemoDependencyRecord): TaskDependencySummary => {
    const blocker = findTask(dep.blocked_by_task_id);
    const blocked = findTask(dep.task_id);
    return {
      ...dep,
      blocked_by_title: blocker?.title,
      blocked_by_status: blocker?.status,
      blocking_title: blocked?.title,
      blocking_status: blocked?.status,
    };
  };
  return {
    blocked_by: dependencies.filter((dep) => dep.task_id === taskId).map(toSummary),
    blocking: dependencies.filter((dep) => dep.blocked_by_task_id === taskId).map(toSummary),
  };
}

function serializeTask(record: DemoTaskRecord): Task {
  const metadata = normalizeDispatchMetadata(record.dispatch_metadata);
  const validation = validateDispatchMetadata(metadata);
  const agent = findAgent(record.assigned_agent_id);
  const deps = dependencySummaries(record.id);
  return {
    ...record,
    dispatch_metadata: metadata,
    dispatch_ready: validation.canDispatch,
    // The real API gates imported GitHub work on the contract. The demo has no
    // GitHub-sourced tasks, so nothing is held in Inbox by the gate.
    dispatch_blockers: [],
    blocked_by: deps.blocked_by,
    blocking: deps.blocking,
    assigned_agent: agent
      ? ({
          id: agent.id,
          name: agent.name,
          avatar_emoji: agent.avatar_emoji,
          runtime_type: agent.runtime_type,
          runtime_config: agent.runtime_config,
          dispatch_enabled: agent.dispatch_enabled,
        } as Agent)
      : undefined,
  };
}

function logEvent(type: string, message: string, taskId?: string, agentId?: string) {
  const current = loadState();
  current.events.unshift({
    id: newId('ev'),
    type: type as never,
    task_id: taskId,
    agent_id: agentId,
    agent: findAgent(agentId),
    message,
    created_at: new Date().toISOString(),
  });
  current.events = current.events.slice(0, 200);
}

function logActivity(taskId: string, message: string, activityType: 'updated' | 'status_changed' | 'completed' | 'spawned', agentId?: string) {
  loadState().activities.push({
    id: newId('act'),
    task_id: taskId,
    agent_id: agentId,
    activity_type: activityType,
    message,
    created_at: new Date().toISOString(),
  });
}

function workspaceStats(workspaceId: string): Pick<WorkspaceStats, 'taskCounts' | 'agentCount'> {
  const current = loadState();
  const tasks = current.tasks.filter((item) => item.workspace_id === workspaceId);
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>;
  for (const item of tasks) counts[item.status] += 1;
  return {
    taskCounts: { ...counts, total: tasks.length },
    agentCount: current.agents.filter((item) => item.workspace_id === workspaceId).length,
  };
}

type Body = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function handleWorkspaces(method: string, parts: string[], url: URL, body: Body): DemoResponse {
  const current = loadState();
  if (parts.length === 0) {
    if (method === 'GET') {
      const withStats = url.searchParams.get('stats') === 'true';
      return ok(current.workspaces.map((ws) => (withStats ? { ...ws, ...workspaceStats(ws.id) } : ws)));
    }
    // New workspaces would need a page the static export did not prerender.
    return unavailable();
  }

  const workspace = current.workspaces.find((ws) => ws.id === parts[0] || ws.slug === parts[0]);
  if (!workspace) return notFound('Workspace');
  if (parts.length > 1) return unavailable(); // github-sync and friends

  if (method === 'GET') return ok(workspace);
  if (method === 'PATCH') {
    const allowed = ['name', 'description', 'icon', 'default_runtime_type', 'default_runtime_config', 'default_dispatch_enabled'];
    for (const key of allowed) {
      if (key in body) (workspace as unknown as Body)[key] = body[key];
    }
    workspace.updated_at = new Date().toISOString();
    saveState();
    return ok(workspace);
  }
  return unavailable();
}

function applyTaskPatch(record: DemoTaskRecord, body: Body, log = true) {
  const previousStatus = record.status;
  const title = asString(body.title);
  if (title && title.trim()) record.title = title.trim();
  if ('description' in body) record.description = asString(body.description) ?? undefined;
  if (typeof body.priority === 'string' && PRIORITIES.has(body.priority)) record.priority = body.priority as DemoTaskRecord['priority'];
  if ('assigned_agent_id' in body) {
    const agentId = asString(body.assigned_agent_id);
    record.assigned_agent_id = agentId && findAgent(agentId) ? agentId : undefined;
  }
  if ('due_date' in body) record.due_date = asString(body.due_date) || undefined;
  if ('dispatch_metadata' in body) record.dispatch_metadata = normalizeDispatchMetadata(body.dispatch_metadata);
  if (typeof body.status === 'string' && (TASK_STATUSES as string[]).includes(body.status)) {
    record.status = body.status as TaskStatus;
  }
  record.updated_at = new Date().toISOString();
  if (!log) return;

  if (record.status !== previousStatus) {
    const label = record.status.replace('_', ' ');
    logEvent(record.status === 'done' ? 'task_completed' : 'task_status_changed', `Task "${record.title}" moved to ${label}`, record.id, record.assigned_agent_id);
    logActivity(record.id, `Moved from ${previousStatus.replace('_', ' ')} to ${label}`, record.status === 'done' ? 'completed' : 'status_changed', record.assigned_agent_id);
  } else {
    logActivity(record.id, 'Task details updated', 'updated');
  }
}

function handleTasks(method: string, parts: string[], url: URL, body: Body): DemoResponse {
  const current = loadState();

  if (parts.length === 0) {
    if (method === 'GET') {
      const workspaceId = url.searchParams.get('workspace_id');
      const status = url.searchParams.get('status');
      const agentId = url.searchParams.get('assigned_agent_id');
      const statuses = status ? status.split(',') : null;
      const list = current.tasks
        .filter((item) => !workspaceId || item.workspace_id === workspaceId)
        .filter((item) => !statuses || statuses.includes(item.status))
        .filter((item) => !agentId || item.assigned_agent_id === agentId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return ok(list.map(serializeTask));
    }
    if (method === 'POST') {
      const title = asString(body.title)?.trim();
      if (!title) return badRequest('Title is required');
      const now = new Date().toISOString();
      const workspaceId = asString(body.workspace_id) || current.workspaces[0].id;
      const record: DemoTaskRecord = {
        id: newId('task'),
        title,
        status: 'inbox',
        priority: 'normal',
        workspace_id: current.workspaces.some((ws) => ws.id === workspaceId) ? workspaceId : current.workspaces[0].id,
        business_id: 'default',
        created_at: now,
        updated_at: now,
      };
      applyTaskPatch(record, { ...body, title }, false);
      current.tasks.push(record);
      logActivity(record.id, 'Task created', 'spawned');
      logEvent('task_created', `New task: ${record.title}`, record.id);
      saveState();
      return created(serializeTask(record));
    }
    return unavailable();
  }

  const record = findTask(parts[0]);
  if (!record) return notFound('Task');

  if (parts.length === 1) {
    if (method === 'GET') return ok(serializeTask(record));
    if (method === 'PATCH') {
      applyTaskPatch(record, body);
      saveState();
      return ok(serializeTask(record));
    }
    if (method === 'DELETE') {
      current.tasks = current.tasks.filter((item) => item.id !== record.id);
      current.dependencies = current.dependencies.filter((dep) => dep.task_id !== record.id && dep.blocked_by_task_id !== record.id);
      logEvent('system', `Task "${record.title}" deleted`);
      saveState();
      return ok({ success: true });
    }
    return unavailable();
  }

  const sub = parts[1];
  if (sub === 'activities' && method === 'GET') {
    const list = current.activities
      .filter((item) => item.task_id === record.id)
      .map((item) => ({ ...item, agent: findAgent(item.agent_id) }))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return ok(list);
  }
  if (sub === 'deliverables' && method === 'GET') {
    return ok(current.deliverables.filter((item) => item.task_id === record.id));
  }
  if (sub === 'subagent' && method === 'GET') return ok([]);
  if (sub === 'dispatch' && method === 'GET') return ok({ attempts: [] });
  if (sub === 'dependencies') {
    if (method === 'GET') {
      const candidates = current.tasks
        .filter((item) => item.workspace_id === record.workspace_id && item.id !== record.id)
        .map((item) => ({ id: item.id, title: item.title, status: item.status }));
      return ok({ ...dependencySummaries(record.id), candidates });
    }
    if (method === 'POST') {
      const blockerId = asString(body.blocked_by_task_id);
      if (!blockerId || !findTask(blockerId)) return badRequest('blocked_by_task_id is required');
      if (blockerId === record.id) return badRequest('A task cannot block itself');
      if (current.dependencies.some((dep) => dep.task_id === record.id && dep.blocked_by_task_id === blockerId)) {
        return badRequest('That dependency already exists');
      }
      current.dependencies.push({
        id: newId('dep'),
        task_id: record.id,
        blocked_by_task_id: blockerId,
        note: asString(body.note) || null,
        created_at: new Date().toISOString(),
      });
      saveState();
      return ok(dependencySummaries(record.id));
    }
    if (method === 'DELETE') {
      const depId = url.searchParams.get('dependency_id');
      current.dependencies = current.dependencies.filter((dep) => dep.id !== depId);
      saveState();
      return ok(dependencySummaries(record.id));
    }
  }
  // planning, dispatch POST, github-writeback, github-issue-draft, test...
  return unavailable();
}

function handleAgents(method: string, parts: string[], url: URL, body: Body): DemoResponse {
  const current = loadState();

  if (parts.length === 0) {
    if (method === 'GET') {
      const workspaceId = url.searchParams.get('workspace_id');
      return ok(current.agents.filter((item) => !workspaceId || item.workspace_id === workspaceId));
    }
    if (method === 'POST') {
      const name = asString(body.name)?.trim();
      const role = asString(body.role)?.trim();
      if (!name || !role) return badRequest('Name and role are required');
      const now = new Date().toISOString();
      const workspaceId = asString(body.workspace_id);
      const agent: Agent = {
        id: newId('agent'),
        name,
        role,
        description: asString(body.description),
        avatar_emoji: asString(body.avatar_emoji) || '🤖',
        status: 'standby',
        is_master: Boolean(body.is_master),
        // Real runtimes need a gateway or webhook, which the demo does not have.
        runtime_type: 'manual',
        runtime_config: null,
        dispatch_enabled: false,
        workspace_id: workspaceId && current.workspaces.some((ws) => ws.id === workspaceId) ? workspaceId : current.workspaces[0].id,
        created_at: now,
        updated_at: now,
      };
      current.agents.push(agent);
      logEvent('agent_joined', `${agent.name} joined the workspace`, undefined, agent.id);
      saveState();
      return created(agent);
    }
    return unavailable();
  }

  if (parts[0] === 'runtime-audit') {
    return method === 'GET' && parts.length === 1 ? ok(runtimeAudit()) : unavailable();
  }

  const agent = findAgent(parts[0]);
  if (!agent) return notFound('Agent');

  if (parts.length === 1) {
    if (method === 'GET') return ok(agent);
    if (method === 'PATCH') {
      for (const key of ['name', 'role', 'description', 'avatar_emoji', 'is_master', 'soul_md', 'user_md', 'agents_md'] as const) {
        if (key in body) (agent as unknown as Body)[key] = body[key];
      }
      if (typeof body.status === 'string' && ['standby', 'working', 'offline'].includes(body.status)) {
        agent.status = body.status as Agent['status'];
      }
      agent.updated_at = new Date().toISOString();
      saveState();
      return ok(agent);
    }
    if (method === 'DELETE') {
      current.agents = current.agents.filter((item) => item.id !== agent.id);
      for (const item of current.tasks) {
        if (item.assigned_agent_id === agent.id) item.assigned_agent_id = undefined;
      }
      saveState();
      return ok({ success: true });
    }
    return unavailable();
  }

  if (parts[1] === 'openclaw' && method === 'GET') return ok({ linked: false, session: null });
  return unavailable();
}

/** Read-only mirror of getRuntimeAudit() in src/lib/runtime-operations.ts (no webhooks in the demo). */
function runtimeAudit() {
  const rows = [...loadState().agents]
    .sort((a, b) => a.workspace_id.localeCompare(b.workspace_id) || a.name.localeCompare(b.name))
    .map((agent) => {
      const runtimeType = agent.runtime_type === 'openclaw' || agent.runtime_type === 'webhook' ? agent.runtime_type : 'manual';
      const dispatchEnabled = Boolean(agent.dispatch_enabled);
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        workspace_id: agent.workspace_id,
        status: agent.status,
        runtime_type: runtimeType,
        dispatch_enabled: dispatchEnabled,
        needs_config: false,
        dispatch_blocked: runtimeType === 'manual' || !dispatchEnabled,
        reason: runtimeType === 'manual'
          ? 'Manual agents require copy/paste handoff.'
          : !dispatchEnabled
            ? 'Auto-dispatch is disabled for this agent.'
            : 'Ready for runtime dispatch.',
        recommended_action: runtimeType === 'manual'
          ? 'manual_handoff_ok'
          : !dispatchEnabled
            ? 'enable_dispatch_when_operator_approved'
            : 'none',
      };
    });
  const summary = rows.reduce<Record<string, number>>((acc, row) => {
    acc.total = (acc.total || 0) + 1;
    acc[row.runtime_type] = (acc[row.runtime_type] || 0) + 1;
    if (row.dispatch_blocked) acc.dispatch_blocked = (acc.dispatch_blocked || 0) + 1;
    return acc;
  }, {});
  return { generated_at: new Date().toISOString(), summary, agents: rows, migration_history: [] };
}

/** Answer one same-origin `/api/...` request from the in-memory demo state. */
export function handleDemoRequest(method: string, url: URL, body: Body): DemoResponse {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [resource, ...rest] = parts;
  const upper = method.toUpperCase();

  switch (resource) {
    case 'workspaces':
      return handleWorkspaces(upper, rest, url, body);
    case 'tasks':
      return handleTasks(upper, rest, url, body);
    case 'agents':
      return handleAgents(upper, rest, url, body);
    case 'events': {
      if (upper !== 'GET' || rest.length > 0) return unavailable();
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const list = [...loadState().events]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);
      return ok(list);
    }
    case 'openclaw':
      if (upper === 'GET' && rest[0] === 'status') return ok({ connected: false, demo: true, error: DEMO_UNAVAILABLE_MESSAGE });
      if (upper === 'GET' && rest[0] === 'sessions' && rest.length === 1) return ok([]);
      return unavailable();
    case 'dispatch-attempts':
      if (upper === 'GET' && rest.length === 0) return ok({ failures: [] });
      return unavailable();
    default:
      return unavailable();
  }
}
