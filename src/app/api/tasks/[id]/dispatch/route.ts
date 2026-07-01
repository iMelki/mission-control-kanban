import { NextResponse } from 'next/server';
import { DispatchAdapterError, dispatchTaskToAssignedAgent, getDispatchAttempts } from '@/lib/dispatch-adapters';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tasks/[id]/dispatch
 *
 * Returns the recorded runtime dispatch attempt timeline for the task.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    return NextResponse.json({ attempts: getDispatchAttempts(id) });
  } catch (error) {
    console.error('Failed to fetch dispatch attempts:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch dispatch attempts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks/[id]/dispatch
 *
 * Dispatches a task through its assigned agent's runtime adapter.
 * Manual agents return a handoff prompt without moving the task forward.
 * OpenClaw and webhook agents only move the task to in_progress after the
 * external runtime accepts the dispatch. Passing { retry: true } is only
 * accepted for failed/timeout webhook dispatch attempts.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await dispatchTaskToAssignedAgent(id, {
      retry: Boolean(body.retry),
      confirm: Boolean(body.confirm),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to dispatch task:', error);
    if (error instanceof DispatchAdapterError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to dispatch task' },
      { status: 500 }
    );
  }
}
