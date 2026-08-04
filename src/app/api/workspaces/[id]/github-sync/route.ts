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
    if (body?.issue_refs !== undefined && (
      !Array.isArray(body.issue_refs) ||
      body.issue_refs.length === 0 ||
      body.issue_refs.some((value: unknown) => typeof value !== 'string' || value.trim().length === 0)
    )) {
      return NextResponse.json(
        { error: 'issue_refs must be a non-empty array of owner/repo#number strings.' },
        { status: 400 }
      );
    }
    const result = await syncGitHubProjectWorkspace(id, {
      dryRun: body?.dry_run === true,
      issueRefs: body?.issue_refs,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to sync GitHub Project workspace:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync GitHub Project workspace' },
      { status: 500 }
    );
  }
}
