import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { parseDispatchMetadata } from '@/lib/dispatch-contract';
import { normalizeGitHubSourceIdentity } from '@/lib/github-task-import';
import { buildGitHubIssueDraftFromTask } from '@/lib/github-issue-drafts';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const row = queryOne<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  const task = {
    ...row,
    dispatch_metadata: parseDispatchMetadata(row.dispatch_metadata),
    github_source: normalizeGitHubSourceIdentity({
      repo_owner: row.source_repo_owner,
      repo_name: row.source_repo_name,
      issue_number: row.source_issue_number,
      issue_url: row.source_issue_url,
      project_item_id: row.source_project_item_id,
    }),
  } as unknown as Task;
  return NextResponse.json({ dry_run: true, draft: buildGitHubIssueDraftFromTask(task) });
}
