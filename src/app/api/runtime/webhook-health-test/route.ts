import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne } from '@/lib/db';
import { getWebhookUrl, parseAgentRuntimeConfig } from '@/lib/agent-runtimes';
import { buildSignedWebhookHeaders } from '@/lib/webhook-signatures';
import type { Agent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HEALTH_TEST_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-MCK-Health-Check': 'true',
};

// This route is an operator-triggered health-test client: it sends a signed
// non-task ping to the configured webhook URL. It does not receive or act on
// provider webhook events, so inbound webhook signature verification is not
// applicable here; outbound signing is handled below when a secret is present.

function getHealthTimeoutMs(config: Record<string, unknown>) {
  const value = typeof config.health_timeout_ms === 'number'
    ? config.health_timeout_ms
    : typeof config.timeout_ms === 'number'
      ? config.timeout_ms
      : 10_000;
  if (!Number.isFinite(value)) return 10_000;
  return Math.min(Math.max(value, 100), 30_000);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const agentId = typeof body.agent_id === 'string' ? body.agent_id : '';
  if (!agentId) return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });

  const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.runtime_type !== 'webhook') {
    return NextResponse.json({ ok: false, phase: 'config', reason: 'Agent is not a webhook runtime' }, { status: 400 });
  }

  const config = parseAgentRuntimeConfig(agent.runtime_config);
  const webhookUrl = getWebhookUrl(config);
  if (!webhookUrl) {
    return NextResponse.json({ ok: false, phase: 'config', reason: 'No webhook_url configured' }, { status: 400 });
  }

  const deliveryId = `health-${uuidv4()}`;
  const payload = JSON.stringify({
    schema_version: '1',
    type: 'mck.ping',
    delivery_id: deliveryId,
    timestamp: new Date().toISOString(),
    challenge: uuidv4(),
    health_check: true,
  });
  const secretEnv = typeof config.signature_secret_env === 'string' ? config.signature_secret_env : 'MCK_WEBHOOK_SIGNATURE_SECRET';
  const secret = process.env[secretEnv];
  const signedHeaders = secret ? buildSignedWebhookHeaders({ rawBody: payload, secret, deliveryId }) : undefined;
  const headers = signedHeaders ? { ...HEALTH_TEST_HEADERS, ...signedHeaders } : HEALTH_TEST_HEADERS;

  const controller = new AbortController();
  const started = Date.now();
  const timeoutMs = getHealthTimeoutMs(config);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    return NextResponse.json({
      ok: response.ok,
      phase: 'post_signed_ping',
      http_status: response.status,
      latency_ms: latencyMs,
      signed: Boolean(secret),
      secret_env_configured: Boolean(secret),
      message: response.ok ? 'Webhook accepted signed non-task ping.' : 'Webhook ping returned a non-2xx status.',
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      phase: 'post_signed_ping',
      reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'request_failed',
      signed: Boolean(secret),
      secret_env_configured: Boolean(secret),
    }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
