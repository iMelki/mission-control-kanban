import { NextRequest, NextResponse } from 'next/server';
import { webhookCallbackPayloadJsonSchema } from '@/lib/webhook-callback-schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const response = NextResponse.json(webhookCallbackPayloadJsonSchema, {
    headers: {
      'Content-Type': 'application/schema+json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Schema-Id': webhookCallbackPayloadJsonSchema.$id,
    },
  });
  if (searchParams.get('download') === '1') {
    response.headers.set('Content-Disposition', 'attachment; filename="mck-webhook-callback-completion.schema.json"');
  }
  return response;
}
