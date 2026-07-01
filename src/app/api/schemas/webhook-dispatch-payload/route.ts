import { NextResponse } from 'next/server';
import { webhookDispatchPayloadJsonSchema, WEBHOOK_DISPATCH_SCHEMA_ID } from '@/lib/webhook-dispatch-schema';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const download = url.searchParams.get('download') === '1';
  return NextResponse.json(webhookDispatchPayloadJsonSchema, {
    headers: {
      'Content-Type': 'application/schema+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Schema-Id': WEBHOOK_DISPATCH_SCHEMA_ID,
      ...(download ? { 'Content-Disposition': 'attachment; filename="mck-webhook-dispatch-payload.v1.schema.json"' } : {}),
    },
  });
}
