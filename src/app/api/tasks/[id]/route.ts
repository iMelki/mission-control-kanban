import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getMissionControlUrl } from '@/lib/config';
import {
  parseDispatchMetadata,
  serializeDispatchMetadata,
  validateDispatchMetadata,
  requiresDispatchContractBeforeWorkStarts,
} from '@/lib/dispatch-contract';
import { deriveGitHubSourceIdentity, normalizeGitHubSourceIdentity } from '@/lib/github-task-import';
import { normalizeAgentRuntimeType, normalizeDispatchEnabled, shouldAutoDispatchAgent } from '@/lib/agent-runtimes';
import { listTaskDependencies } from '@/lib/task-dependencies';
import type { Task, UpdateTaskRequest, Agent } from '@/lib/types';

type TaskRow = Task & {
  assigned_agent_name?: string;
  assigned_agent_emoji?: string;
  assigned_agent_runtime_type?: string | null;
  assigned_agent_runtime_config?: string | null;
  assigned_agent_dispatch_enabled?: boolean | number | null;
  created_by_agent_name?: string;
  created_by_agent_emoji?: string;
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

// GET /api/tasks/[id] - Get a single task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = queryOne<TaskRow>(
      `SELECT t.*,
        aa.name as assigned_agent_name,
        aa.avatar_emoji as assigned_agent_emoji,
        aa.runtime_type as assigned_agent_runtime_type,
        aa.runtime_config as assigned_agent_runtime_config,
        aa.dispatch_enabled as assigned_agent_dispatch_enabled
       FROM tasks t
       LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
       WHERE t.id = ?`,
      [id]
    );

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...decorateTask(task),
      ...listTaskDependencies(id),
    });
  } catch (error) {
    console.error('Failed to fetch task:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

// PATCH /api/tasks/[id] - Update a task
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdateTaskRequest & { updated_by_agent_id?: string } = await request.json();

    const existing = queryOne<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const existingGitHubSource = normalizeGitHubSourceIdentity({
      repo_owner: existing.source_repo_owner,
      repo_name: existing.source_repo_name,
      issue_number: existing.source_issue_number,
      issue_url: existing.source_issue_url,
      project_item_id: existing.source_project_item_id,
    });

    const updates: string[] = [];
    const values: unknown[] = [];
    const now = new Date().toISOString();

    // Workflow enforcement for agent-initiated approvals
    // If an agent is trying to move review→done, they must be a master agent
    // User-initiated moves (no agent ID) are allowed
    if (body.status === 'done' && existing.status === 'review' && body.updated_by_agent_id) {
      const updatingAgent = queryOne<Agent>(
        'SELECT is_master FROM agents WHERE id = ?',
        [body.updated_by_agent_id]
      );

      if (!updatingAgent || !updatingAgent.is_master) {
        return NextResponse.json(
          { error: 'Forbidden: only master agent (Charlie) can approve tasks' },
          { status: 403 }
        );
      }
    }

    if (body.title !== undefined) {
      updates.push('title = ?');
      values.push(body.title);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description);
    }
    if (body.priority !== undefined) {
      updates.push('priority = ?');
      values.push(body.priority);
    }
    if (body.due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(body.due_date);
    }
    if (body.dispatch_metadata !== undefined) {
      updates.push('dispatch_metadata = ?');
      values.push(serializeDispatchMetadata(body.dispatch_metadata));
    }

    const shouldClearGitHubSource = Object.prototype.hasOwnProperty.call(body, 'github_source') && body.github_source === null;
    const derivedGitHubSource = shouldClearGitHubSource
      ? null
      : deriveGitHubSourceIdentity({
          github_source: body.github_source,
          dispatch_metadata: body.dispatch_metadata,
        });

    if (shouldClearGitHubSource || derivedGitHubSource) {
      const duplicate = derivedGitHubSource
        ? queryOne<Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'created_at' | 'updated_at'>>(
            `SELECT id, title, status, priority, created_at, updated_at
             FROM tasks
             WHERE id != ?
               AND (
                 (workspace_id = ? AND source_repo_owner = ? AND source_repo_name = ? AND source_issue_number = ?)
                 OR (source_project_item_id IS NOT NULL AND source_project_item_id = ?)
               )`,
            [
              id,
              existing.workspace_id,
              derivedGitHubSource.repo_owner,
              derivedGitHubSource.repo_name,
              derivedGitHubSource.issue_number,
              derivedGitHubSource.project_item_id ?? '',
            ]
          )
        : undefined;

      if (duplicate) {
        return NextResponse.json(
          {
            error: `GitHub issue already imported as task ${duplicate.id}`,
            existing_task: duplicate,
          },
          { status: 409 }
        );
      }

      updates.push('source_repo_owner = ?');
      values.push(derivedGitHubSource?.repo_owner || null);
      updates.push('source_repo_name = ?');
      values.push(derivedGitHubSource?.repo_name || null);
      updates.push('source_issue_number = ?');
      values.push(derivedGitHubSource?.issue_number || null);
      updates.push('source_issue_url = ?');
      values.push(derivedGitHubSource?.issue_url || null);
      updates.push('source_project_item_id = ?');
      values.push(derivedGitHubSource?.project_item_id || null);
    }

    const effectiveGitHubSource = shouldClearGitHubSource
      ? null
      : derivedGitHubSource ?? existingGitHubSource;
    const effectiveDispatchMetadata = body.dispatch_metadata !== undefined
      ? parseDispatchMetadata(body.dispatch_metadata)
      : parseDispatchMetadata(existing.dispatch_metadata);

    if (body.status !== undefined && requiresDispatchContractBeforeWorkStarts(body.status) && effectiveGitHubSource) {
      const validation = validateDispatchMetadata(effectiveDispatchMetadata);
      if (!validation.canDispatch) {
        return NextResponse.json(
          {
            error: `Imported GitHub tasks cannot enter ${body.status} until the dispatch contract is complete`,
            blockers: validation.blockers,
          },
          { status: 409 }
        );
      }
    }

    // Track if we need to dispatch task
    let shouldDispatch = false;

    // Handle status change
    if (body.status !== undefined && body.status !== existing.status) {
      updates.push('status = ?');
      values.push(body.status);

      // Auto-dispatch when moving to assigned
      if (body.status === 'assigned' && existing.assigned_agent_id) {
        shouldDispatch = true;
      }

      // Log status change event
      const eventType = body.status === 'done' ? 'task_completed' : 'task_status_changed';
      run(
        `INSERT INTO events (id, type, task_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), eventType, id, `Task \"${existing.title}\" moved to ${body.status}`, now]
      );
    }

    // Handle assignment change
    if (body.assigned_agent_id !== undefined && body.assigned_agent_id !== existing.assigned_agent_id) {
      updates.push('assigned_agent_id = ?');
      values.push(body.assigned_agent_id);

      if (body.assigned_agent_id) {
        const agent = queryOne<Agent>('SELECT name FROM agents WHERE id = ?', [body.assigned_agent_id]);
        if (agent) {
          run(
            `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), 'task_assigned', body.assigned_agent_id, id, `\"${existing.title}\" assigned to ${agent.name}`, now]
          );

          // Auto-dispatch if already in assigned status or being assigned now
          if (existing.status === 'assigned' || body.status === 'assigned') {
            shouldDispatch = true;
          }
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);

    // Fetch updated task with all joined fields
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

    // Broadcast task update via SSE
    if (decoratedTask) {
      broadcast({
        type: 'task_updated',
        payload: decoratedTask,
      });
    }

    // Trigger auto-dispatch if needed
    if (shouldDispatch && decoratedTask) {
      const validation = validateDispatchMetadata(decoratedTask.dispatch_metadata);

      if (!validation.canDispatch) {
        run(
          `INSERT INTO events (id, type, task_id, message, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            'system',
            id,
            `Dispatch blocked for \"${decoratedTask.title}\": ${validation.blockers.join('; ')}`,
            JSON.stringify({ blockers: validation.blockers }),
            now,
          ]
        );
      } else {
        const assignedAgent = decoratedTask.assigned_agent_id
          ? queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [decoratedTask.assigned_agent_id])
          : null;

        if (!shouldAutoDispatchAgent(assignedAgent)) {
          run(
            `INSERT INTO events (id, type, agent_id, task_id, message, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(),
              'system',
              assignedAgent?.id || null,
              id,
              `Auto-dispatch skipped for \"${decoratedTask.title}\": ${assignedAgent?.name || 'assigned agent'} requires manual handoff or dispatch is disabled`,
              JSON.stringify({
                runtime_type: assignedAgent?.runtime_type || 'manual',
                dispatch_enabled: assignedAgent?.dispatch_enabled ?? false,
              }),
              now,
            ]
          );
        } else {
          // Call dispatch endpoint asynchronously (don't wait for response)
          const missionControlUrl = getMissionControlUrl();
          fetch(`${missionControlUrl}/api/tasks/${id}/dispatch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: decoratedTask }),
          }).catch(err => {
            console.error('Auto-dispatch failed:', err);
          });
        }
      }
    }

    return NextResponse.json(decoratedTask);
  } catch (error) {
    console.error('Failed to update task:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

// DELETE /api/tasks/[id] - Delete a task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [id]);

    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Delete or nullify related records first (foreign key constraints)
    // Note: task_activities and task_deliverables have ON DELETE CASCADE
    run('DELETE FROM openclaw_sessions WHERE task_id = ?', [id]);
    run('DELETE FROM task_dispatch_attempts WHERE task_id = ?', [id]);
    run('DELETE FROM events WHERE task_id = ?', [id]);
    // Conversations reference tasks - nullify or delete
    run('UPDATE conversations SET task_id = NULL WHERE task_id = ?', [id]);

    // Now delete the task (cascades to task_activities and task_deliverables)
    run('DELETE FROM tasks WHERE id = ?', [id]);

    // Broadcast deletion via SSE
    broadcast({
      type: 'task_deleted',
      payload: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete task:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
