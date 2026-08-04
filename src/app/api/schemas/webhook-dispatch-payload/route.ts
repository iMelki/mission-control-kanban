import { NextResponse } from 'next/server';
import {
  webhookDispatchPayloadJsonSchema,
  webhookDispatchPayloadV2JsonSchema,
  WEBHOOK_DISPATCH_SCHEMA_ID,
  WEBHOOK_DISPATCH_V2_SCHEMA_ID,
} from '@/lib/webhook-dispatch-schema';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const download = url.searchParams.get('download') === '1';
  const version = url.searchParams.get('version') === '2' ? 2 : 1;
  const payload = version === 2 ? webhookDispatchPayloadV2JsonSchema : webhookDispatchPayloadJsonSchema;
  const schemaId = version === 2 ? WEBHOOK_DISPATCH_V2_SCHEMA_ID : WEBHOOK_DISPATCH_SCHEMA_ID;
  return NextResponse.json(payload, {
    headers: {
      'Content-Type': 'application/schema+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Schema-Id': schemaId,
      ...(download ? { 'Content-Disposition': `attachment; filename="mck-webhook-dispatch-payload.v${version}.schema.json"` } : {}),
    },
  });
}
