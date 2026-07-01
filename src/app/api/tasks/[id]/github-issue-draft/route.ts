import { NextResponse } from 'next/server';
import {
  applyGitHubIssueDraft,
  buildGitHubIssueDraftPayload,
  loadTaskForIssueDraft,
} from '@/lib/github-issue-drafts';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const task = loadTaskForIssueDraft(id);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  return NextResponse.json(buildGitHubIssueDraftPayload(task));
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const task = loadTaskForIssueDraft(id);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run !== false;
  const plan = buildGitHubIssueDraftPayload(task);
  if (dryRun) return NextResponse.json(plan);
  try {
    const applied = await applyGitHubIssueDraft({
      task,
      confirmationText: typeof body.confirmation_text === 'string' ? body.confirmation_text : '',
    });
    return NextResponse.json(applied);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub issue create/update failed';
    const status = error instanceof Error && error.name === 'ConfirmationError' ? 400 : 502;
    return NextResponse.json({ error: message, ...plan }, { status });
  }
}
