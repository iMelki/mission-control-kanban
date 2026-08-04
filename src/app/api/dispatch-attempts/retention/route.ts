import { NextResponse } from 'next/server';
import { pruneDispatchAttemptsWithAudit } from '@/lib/runtime-operations';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run !== false;
  const result = pruneDispatchAttemptsWithAudit({ dryRun });
  return NextResponse.json(result);
}
