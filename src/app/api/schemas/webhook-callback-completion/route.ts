import { NextRequest, NextResponse } from 'next/server';
import {
  webhookCallbackPayloadJsonSchema,
  webhookLifecycleCallbackPayloadJsonSchema,
} from '@/lib/webhook-callback-schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const version = searchParams.get('version') === '2' ? 2 : 1;
  const schema = version === 2 ? webhookLifecycleCallbackPayloadJsonSchema : webhookCallbackPayloadJsonSchema;
  const response = NextResponse.json(schema, {
    headers: {
      'Content-Type': 'application/schema+json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Schema-Id': schema.$id,
    },
  });
  if (searchParams.get('download') === '1') {
    response.headers.set('Content-Disposition', `attachment; filename="mck-webhook-callback-v${version}.schema.json"`);
  }
  return response;
}
