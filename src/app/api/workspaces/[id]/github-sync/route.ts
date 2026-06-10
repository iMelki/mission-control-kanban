import { NextRequest, NextResponse } from 'next/server';
import { syncGitHubProjectWorkspace } from '@/lib/github-project-sync';

// POST /api/workspaces/[id]/github-sync - Refresh the local workspace mirror from its linked GitHub Project
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await syncGitHubProjectWorkspace(id, { dryRun: body?.dry_run === true });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to sync GitHub Project workspace:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync GitHub Project workspace' },
      { status: 500 }
    );
  }
}
