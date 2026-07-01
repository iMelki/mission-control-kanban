import { NextResponse } from 'next/server';
import { pruneDispatchAttempts } from '@/lib/runtime-operations';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run !== false;
  const result = pruneDispatchAttempts({ dryRun });
  return NextResponse.json(result);
}
