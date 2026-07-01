import { NextResponse } from 'next/server';
import { DispatchAdapterError, dispatchTaskToAssignedAgent } from '@/lib/dispatch-adapters';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tasks/[id]/dispatch
 *
 * Dispatches a task through its assigned agent's runtime adapter.
 * Manual agents return a handoff prompt without moving the task forward.
 * OpenClaw and webhook agents only move the task to in_progress after the
 * external runtime accepts the dispatch.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const result = await dispatchTaskToAssignedAgent(id);
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
