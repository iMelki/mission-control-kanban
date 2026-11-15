import { NextResponse } from 'next/server';
import { getOpenClawClient, type OpenClawClient } from '@/lib/openclaw/client';
import { toPublicGatewayError } from '@/lib/openclaw/public-error';

type OpenClawStatusClient = Pick<OpenClawClient, 'isConnected' | 'connect' | 'listSessions'>;

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:28789';

function gatewayUrl(): string {
  return process.env.OPENCLAW_GATEWAY_URL || DEFAULT_GATEWAY_URL;
}

/** Build the /api/openclaw/status JSON response. Accepts a client for tests. */
export async function getOpenClawStatus(client: OpenClawStatusClient = getOpenClawClient()) {
  try {
    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json({
          connected: false,
          error: 'Failed to connect to OpenClaw Gateway',
          gateway_url: gatewayUrl(),
        });
      }
    }

    try {
      const sessions = await client.listSessions();
      return NextResponse.json({
        connected: true,
        sessions_count: sessions.length,
        sessions,
        gateway_url: gatewayUrl(),
      });
    } catch (err) {
      const publicError = toPublicGatewayError(err, 'Connected but failed to list sessions');
      return NextResponse.json({
        connected: true,
        error: publicError.message,
        ...(publicError.code !== undefined ? { error_code: publicError.code } : {}),
        gateway_url: gatewayUrl(),
      });
    }
  } catch (error) {
    const publicError = toPublicGatewayError(error, 'Unknown error');
    console.error('OpenClaw status check failed:', publicError.message);
    return NextResponse.json(
      {
        connected: false,
        error: publicError.message,
        ...(publicError.code !== undefined ? { error_code: publicError.code } : {}),
      },
      { status: 500 },
    );
  }
}
