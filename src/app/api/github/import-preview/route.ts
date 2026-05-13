import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { buildGitHubImportPreviewResponse, type GitHubImportPreviewRequest } from '@/lib/github-task-import';
import type { Task } from '@/lib/types';

type ExistingTaskPreview = Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'created_at' | 'updated_at'>;

// POST /api/github/import-preview - Preview how a GitHub issue/project item would map into a local Kanban task
export async function POST(request: NextRequest) {
  try {
    const body: GitHubImportPreviewRequest = await request.json();

    if (!body.issue?.title) {
      return NextResponse.json({ error: 'GitHub issue title is required' }, { status: 400 });
    }

    const initialPreview = buildGitHubImportPreviewResponse({ request: body });
    const source = initialPreview.source_identity;

    const existingTask = source
      ? queryOne<ExistingTaskPreview>(
          `SELECT id, title, status, priority, created_at, updated_at
           FROM tasks
           WHERE source_repo_owner = ? AND source_repo_name = ? AND source_issue_number = ?`,
          [source.repo_owner, source.repo_name, source.issue_number]
        )
      : undefined;

    const response = buildGitHubImportPreviewResponse({
      request: body,
      existingTask,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to preview GitHub task import:', error);
    return NextResponse.json({ error: 'Failed to preview GitHub task import' }, { status: 500 });
  }
}
