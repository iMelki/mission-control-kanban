import { NextResponse } from 'next/server';
import { getRuntimeConfigTemplateDiagnostics } from '@/lib/runtime-config-templates';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    generated_at: new Date().toISOString(),
    templates: getRuntimeConfigTemplateDiagnostics(),
  });
}
