import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from '@/lib/events';
import { getDb } from '@/lib/db';
import { parseDispatchMetadata, validateDispatchMetadata } from '@/lib/dispatch-contract';
import {
  applyGitHubWriteback,
  buildWritebackActivityMessage,
  planGitHubWriteback,
  type GitHubWritebackTaskSnapshot,
} from '@/lib/github-writeback';
import type {
  GitHubWritebackLog,
  Task,
  TaskActivity,
} from '@/lib/types';

type TaskRow = Task & {
  assigned_agent_name?: string | null;
  dispatch_metadata?: string | null;
  source_repo_owner?: string | null;
  source_repo_name?: string | null;
  source_issue_number?: number | null;
  source_issue_url?: string | null;
  source_project_item_id?: string | null;
};

type WritebackLogRow = GitHubWritebackLog;

function mapLogRow(row: WritebackLogRow): GitHubWritebackLog {
  return {
    ...row,
  };
}

function buildTaskSnapshot(task: TaskRow): GitHubWritebackTaskSnapshot | undefined {
  if (!task.source_repo_owner || !task.source_repo_name || !task.source_issue_number || !task.source_issue_url) {
    return undefined;
  }

  const dispatchMetadata = parseDispatchMetadata(task.dispatch_metadata);
  const validation = validateDispatchMetadata(dispatchMetadata);

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    assigned_agent_name: task.assigned_agent_name,
    github_source: {
      repo_owner: task.source_repo_owner,
      repo_name: task.source_repo_name,
      issue_number: task.source_issue_number,
      issue_url: task.source_issue_url,
      project_item_id: task.source_project_item_id ?? undefined,
    },
    dispatch_metadata: dispatchMetadata,
    dispatch_blockers: validation.blockers,
  };
}

function logActivity(taskId: string, message: string, metadata: Record<string, unknown>) {
  const db = getDb();
  const activityId = uuidv4();
  db.prepare(`
    INSERT INTO task_activities (id, task_id, activity_type, message, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(activityId, taskId, 'github_writeback', message, JSON.stringify(metadata));

  const activity: TaskActivity = {
    id: activityId,
    task_id: taskId,
    activity_type: 'github_writeback',
    message,
    metadata: JSON.stringify(metadata),
    created_at: new Date().toISOString(),
  };

  broadcast({
    type: 'activity_logged',
    payload: activity,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const logs = db.prepare(`
      SELECT *
      FROM github_writeback_logs
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(id) as WritebackLogRow[];

    return NextResponse.json(logs.map(mapLogRow));
  } catch (error) {
    console.error('Failed to fetch GitHub write-back logs:', error);
    return NextResponse.json({ error: 'Failed to fetch GitHub write-back logs' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dry_run !== false;

    const db = getDb();
    const task = db.prepare(`
      SELECT
        t.*,
        a.name AS assigned_agent_name
      FROM tasks t
      LEFT JOIN agents a ON t.assigned_agent_id = a.id
      WHERE t.id = ?
    `).get(id) as TaskRow | undefined;

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const snapshot = buildTaskSnapshot(task);
    if (!snapshot) {
      return NextResponse.json({ error: 'Task is not linked to a GitHub issue' }, { status: 400 });
    }

    const plan = await planGitHubWriteback(snapshot);
    const repoRef = `${snapshot.github_source.repo_owner}/${snapshot.github_source.repo_name}#${snapshot.github_source.issue_number}`;
    const existingApplied = dryRun
      ? undefined
      : db.prepare(`
          SELECT id
          FROM github_writeback_logs
          WHERE task_id = ? AND mode = 'apply' AND status = 'applied' AND signature = ?
          LIMIT 1
        `).get(id, plan.signature) as { id: string } | undefined;

    let status: GitHubWritebackLog['status'] = dryRun ? 'planned' : 'applied';
    let responsePayload: unknown = {
      warnings: plan.warnings,
    };
    let errorMessage: string | null = null;

    if (existingApplied) {
      status = 'skipped';
      responsePayload = {
        warnings: plan.warnings,
        reason: 'already_applied',
        existing_log_id: existingApplied.id,
      };
    } else if (!dryRun) {
      try {
        const result = await applyGitHubWriteback(snapshot, plan);
        responsePayload = result;
      } catch (error) {
        status = 'failed';
        errorMessage = error instanceof Error ? error.message : 'GitHub write-back failed';
      }
    }

    const logId = uuidv4();
    db.prepare(`
      INSERT INTO github_writeback_logs (
        id,
        task_id,
        mode,
        status,
        signature,
        issue_comment_body,
        project_updates,
        response_payload,
        error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      id,
      dryRun ? 'dry_run' : 'apply',
      status,
      plan.signature,
      plan.issue_comment_body,
      JSON.stringify(plan.project_updates),
      JSON.stringify(responsePayload),
      errorMessage
    );

    const activityMessage = buildWritebackActivityMessage(dryRun ? 'dry_run' : 'apply', status, repoRef);
    logActivity(id, activityMessage, {
      mode: dryRun ? 'dry_run' : 'apply',
      status,
      repo_ref: repoRef,
      signature: plan.signature,
      issue_comment_body: plan.issue_comment_body,
      project_updates: plan.project_updates,
      response_payload: responsePayload,
      error_message: errorMessage,
    });

    const response = {
      id: logId,
      mode: dryRun ? 'dry_run' : 'apply',
      status,
      signature: plan.signature,
      issue_comment_body: plan.issue_comment_body,
      project_updates: plan.project_updates,
      warnings: plan.warnings,
      response_payload: responsePayload,
      error_message: errorMessage,
    };

    return NextResponse.json(response, { status: status === 'failed' ? 502 : 200 });
  } catch (error) {
    console.error('Failed to process GitHub write-back:', error);
    return NextResponse.json({ error: 'Failed to process GitHub write-back' }, { status: 500 });
  }
}
