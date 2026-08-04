import { NextRequest, NextResponse } from 'next/server';
import { getDispatchFailureQueue } from '@/lib/runtime-operations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspace_id') || undefined;
  const limit = Number(searchParams.get('limit') || 100);
  return NextResponse.json({
    failures: getDispatchFailureQueue({ workspaceId, limit }),
  });
}
