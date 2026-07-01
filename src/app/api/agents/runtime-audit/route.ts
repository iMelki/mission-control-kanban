import { NextRequest, NextResponse } from 'next/server';
import { applyRuntimeAuditMigration, getRuntimeAudit } from '@/lib/runtime-operations';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getRuntimeAudit());
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run !== false;
  return NextResponse.json(applyRuntimeAuditMigration({ dryRun }));
}
