import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import {
  parseDispatchMetadata,
  serializeDispatchMetadata,
  validateDispatchMetadata,
  requiresDispatchContractBeforeWorkStarts,
} from '@/lib/dispatch-contract';
import { deriveGitHubSourceIdentity, normalizeGitHubSourceIdentity } from '@/lib/github-task-import';
import type { Task, CreateTaskRequest, Agent } from '@/lib/types';
import { normalizeAgentRuntimeType, normalizeDispatchEnabled } from '@/lib/agent-runtimes';

type TaskRow = Task & {
  assigned_agent_name?: string;
  assigned_agent_emoji?: string;
  assigned_agent_runtime_type?: string | null;
  assigned_agent_runtime_config?: string | null;
  assigned_agent_dispatch_enabled?: boolean | number | null;
  created_by_agent_name?: string;
  dispatch_metadata?: string | null;
  source_repo_owner?: string | null;
  source_repo_name?: string | null;
  source_issue_number?: number | null;
  source_issue_url?: string | null;
  source_project_item_id?: string | null;
};

function decorateTask(task: TaskRow) {
  const {
    dispatch_metadata,
    source_repo_owner,
    source_repo_name,
    source_issue_number,
    source_issue_url,
    source_project_item_id,
    ...rest
  } = task;
  const dispatchMetadata = parseDispatchMetadata(task.dispatch_metadata);
  const validation = validateDispatchMetadata(dispatchMetadata);
  const githubSource = normalizeGitHubSourceIdentity({
    repo_owner: source_repo_owner,
    repo_name: source_repo_name,
    issue_number: source_issue_number,
    issue_url: source_issue_url,
    project_item_id: source_project_item_id,
  });

  return {
    ...rest,
    github_source: githubSource,
    dispatch_metadata: dispatchMetadata,
    dispatch_ready: validation.canDispatch,
    dispatch_blockers: validation.blockers,
    assigned_agent: task.assigned_agent_id
      ? {
          id: task.assigned_agent_id,
          name: task.assigned_agent_name,
          avatar_emoji: task.assigned_agent_emoji,
          runtime_type: normalizeAgentRuntimeType(task.assigned_agent_runtime_type),
          runtime_config: task.assigned_agent_runtime_config,
          dispatch_enabled: normalizeDispatchEnabled(task.assigned_agent_dispatch_enabled),
        }
      : undefined,
  };
}

// GET /api/tasks - List all tasks with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const businessId = searchParams.get('business_id');
    const workspaceId = searchParams.get('workspace_id');
    const assignedAgentId = searchParams.get('assigned_agent_id');

    let sql = `
      SELECT
        t.*,
        aa.name as assigned_agent_name,
        aa.avatar_emoji as assigned_agent_emoji,
        aa.runtime_type as assigned_agent_runtime_type,
        aa.runtime_config as assigned_agent_runtime_config,
        aa.dispatch_enabled as assigned_agent_dispatch_enabled,
        ca.name as created_by_agent_name
      FROM tasks t
      LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
      LEFT JOIN agents ca ON t.created_by_agent_id = ca.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (status) {
      // Support comma-separated status values (e.g., status=inbox,testing,in_progress)
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        sql += ' AND t.status = ?';
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        sql += ` AND t.status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
      }
    }
    if (businessId) {
      sql += ' AND t.business_id = ?';
      params.push(businessId);
    }
    if (workspaceId) {
      sql += ' AND t.workspace_id = ?';
      params.push(workspaceId);
    }
    if (assignedAgentId) {
      sql += ' AND t.assigned_agent_id = ?';
      params.push(assignedAgentId);
    }

    sql += ' ORDER BY t.created_at DESC';

    const tasks = queryAll<TaskRow>(sql, params);
    return NextResponse.json(tasks.map(decorateTask));
  } catch (error) {
    console.error('Failed to fetch tasks:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskRequest = await request.json();
    console.log('[POST /api/tasks] Received body:', JSON.stringify(body));

    if (!body.title) {
      console.log('[POST /api/tasks] Title missing or empty');
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const workspaceId = (body as { workspace_id?: string }).workspace_id || 'default';
    const status = (body as { status?: string }).status || 'inbox';
    const githubSource = deriveGitHubSourceIdentity({
      github_source: body.github_source,
      dispatch_metadata: body.dispatch_metadata,
    });
    const dispatchMetadata = serializeDispatchMetadata(body.dispatch_metadata);
    const normalizedDispatchMetadata = parseDispatchMetadata(body.dispatch_metadata);

    if (githubSource) {
      if (requiresDispatchContractBeforeWorkStarts(status)) {
        const validation = validateDispatchMetadata(normalizedDispatchMetadata);
        if (!validation.canDispatch) {
          return NextResponse.json(
            {
              error: `Imported GitHub tasks cannot enter ${status} until the dispatch contract is complete`,
              blockers: validation.blockers,
            },
            { status: 409 }
          );
        }
      }

      const duplicate = queryOne<Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'created_at' | 'updated_at'>>(
        `SELECT id, title, status, priority, created_at, updated_at
         FROM tasks
         WHERE workspace_id = ? AND source_repo_owner = ? AND source_repo_name = ? AND source_issue_number = ?`,
        [workspaceId, githubSource.repo_owner, githubSource.repo_name, githubSource.issue_number]
      );

      if (duplicate) {
        return NextResponse.json(
          {
            error: `GitHub issue already imported as task ${duplicate.id}`,
            existing_task: duplicate,
          },
          { status: 409 }
        );
      }
    }

    run(
      `INSERT INTO tasks (id, title, description, status, priority, assigned_agent_id, created_by_agent_id, workspace_id, business_id, due_date, source_repo_owner, source_repo_name, source_issue_number, source_issue_url, source_project_item_id, dispatch_metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.title,
        body.description || null,
        status,
        body.priority || 'normal',
        body.assigned_agent_id || null,
        body.created_by_agent_id || null,
        workspaceId,
        body.business_id || 'default',
        body.due_date || null,
        githubSource?.repo_owner || null,
        githubSource?.repo_name || null,
        githubSource?.issue_number || null,
        githubSource?.issue_url || null,
        githubSource?.project_item_id || null,
        dispatchMetadata,
        now,
        now,
      ]
    );

    // Log event
    let eventMessage = `New task: ${body.title}`;
    if (body.created_by_agent_id) {
      const creator = queryOne<Agent>('SELECT name FROM agents WHERE id = ?', [body.created_by_agent_id]);
      if (creator) {
        eventMessage = `${creator.name} created task: ${body.title}`;
      }
    }

    run(
      `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), 'task_created', body.created_by_agent_id || null, id, eventMessage, now]
    );

    // Fetch created task with all joined fields
    const task = queryOne<TaskRow>(
      `SELECT t.*,
        aa.name as assigned_agent_name,
        aa.avatar_emoji as assigned_agent_emoji,
        aa.runtime_type as assigned_agent_runtime_type,
        aa.runtime_config as assigned_agent_runtime_config,
        aa.dispatch_enabled as assigned_agent_dispatch_enabled,
        ca.name as created_by_agent_name,
        ca.avatar_emoji as created_by_agent_emoji
       FROM tasks t
       LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
       LEFT JOIN agents ca ON t.created_by_agent_id = ca.id
       WHERE t.id = ?`,
      [id]
    );

    const decoratedTask = task ? decorateTask(task) : null;

    // Broadcast task creation via SSE
    if (decoratedTask) {
      broadcast({
        type: 'task_created',
        payload: decoratedTask,
      });
    }

    return NextResponse.json(decoratedTask, { status: 201 });
  } catch (error) {
    console.error('Failed to create task:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
