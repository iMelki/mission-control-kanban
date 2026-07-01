import { NextRequest, NextResponse } from 'next/server';
import { getWebhookCallbackDeliveries, pruneWebhookCallbackDeliveries } from '@/lib/webhook-callback-operations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 100);
  return NextResponse.json({
    deliveries: getWebhookCallbackDeliveries({ limit }),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run !== false;
  return NextResponse.json(pruneWebhookCallbackDeliveries({ dryRun }));
}
