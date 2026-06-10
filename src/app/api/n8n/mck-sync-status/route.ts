import { NextRequest, NextResponse } from 'next/server';
import { getMckN8nSyncStatus, notifyMckN8nSyncAlert, recordMckN8nSyncPayload } from '@/lib/n8n-sync-status';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') ?? 5);
    return NextResponse.json(getMckN8nSyncStatus(limit));
  } catch (error) {
    console.error('Failed to load n8n MCK sync status:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load n8n MCK sync status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const latest = recordMckN8nSyncPayload(payload);
    await notifyMckN8nSyncAlert(latest);

    return NextResponse.json({
      ok: true,
      latest,
    });
  } catch (error) {
    console.error('Failed to record n8n MCK sync status:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to record n8n MCK sync status' },
      { status: 500 }
    );
  }
}
