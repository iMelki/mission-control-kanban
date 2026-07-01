import { NextRequest, NextResponse } from 'next/server';
import { applyRuntimeAuditMigration, getRuntimeAudit } from '@/lib/runtime-operations';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getRuntimeAudit());
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run !== false;
  const agentIds = Array.isArray(body.agent_ids)
    ? body.agent_ids.filter((value: unknown): value is string => typeof value === 'string')
    : undefined;
  return NextResponse.json(applyRuntimeAuditMigration({ dryRun, agentIds }));
}
