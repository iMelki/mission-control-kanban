import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import {
  addTaskDependency,
  listDependencyCandidates,
  listTaskDependencies,
  removeTaskDependency,
} from '@/lib/task-dependencies';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const task = queryOne<{ workspace_id: string }>('SELECT workspace_id FROM tasks WHERE id = ?', [id]);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  return NextResponse.json({
    ...listTaskDependencies(id),
    candidates: listDependencyCandidates(id, task.workspace_id),
  });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const blockedByTaskId = typeof body.blocked_by_task_id === 'string' ? body.blocked_by_task_id : '';
    const note = typeof body.note === 'string' ? body.note : undefined;
    if (!blockedByTaskId) return NextResponse.json({ error: 'blocked_by_task_id is required' }, { status: 400 });
    return NextResponse.json(addTaskDependency(id, blockedByTaskId, note));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to add dependency' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const dependencyId = searchParams.get('dependency_id');
  if (!dependencyId) return NextResponse.json({ error: 'dependency_id is required' }, { status: 400 });
  return NextResponse.json(removeTaskDependency(id, dependencyId));
}
