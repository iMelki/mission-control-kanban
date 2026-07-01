import { NextResponse } from 'next/server';
import { getRuntimeHealthSummary } from '@/lib/runtime-operations';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = getRuntimeHealthSummary();
  return NextResponse.json(health, { status: health.ok ? 200 : 207 });
}
