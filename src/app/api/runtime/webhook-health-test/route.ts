import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne } from '@/lib/db';
import {
  buildWebhookHeaders,
  getWebhookSignatureSecret,
  getWebhookUrl,
  parseAgentRuntimeConfig,
} from '@/lib/agent-runtimes';
import { buildSignedWebhookHeaders } from '@/lib/webhook-signatures';
import type { Agent, AgentRuntimeConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HEALTH_TEST_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-MCK-Health-Check': 'true',
};

function getHealthTimeoutMs(config: Record<string, unknown>) {
  const value = typeof config.health_timeout_ms === 'number'
    ? config.health_timeout_ms
    : typeof config.timeout_ms === 'number'
      ? config.timeout_ms
      : 10_000;
  if (!Number.isFinite(value)) return 10_000;
  return Math.min(Math.max(value, 100), 30_000);
}

function resolveConfigFromBody(body: Record<string, unknown>): { config?: AgentRuntimeConfig; agent?: Agent; error?: string; status?: number } {
  const agentId = typeof body.agent_id === 'string' ? body.agent_id : '';
  const inlineRuntimeType = body.runtime_type;
  const hasInlineConfig = body.runtime_config !== undefined;

  let agent: Agent | undefined;
  if (agentId) {
    const row = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agentId]);
    if (!row) return { error: 'Agent not found', status: 404 };
    agent = row;
  }

  const effectiveRuntimeType = typeof inlineRuntimeType === 'string'
    ? inlineRuntimeType
    : agent?.runtime_type;
  if (effectiveRuntimeType !== 'webhook') {
    return { error: 'Webhook health validation requires runtime_type=webhook', status: 400 };
  }

  const config = hasInlineConfig
    ? parseAgentRuntimeConfig(body.runtime_config)
    : parseAgentRuntimeConfig(agent?.runtime_config);
  return { config, agent };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const resolved = resolveConfigFromBody(body);
  if (resolved.error || !resolved.config) {
    return NextResponse.json({ ok: false, phase: 'config', reason: resolved.error || 'No runtime config resolved' }, { status: resolved.status || 400 });
  }

  const config = resolved.config;
  const webhookUrl = getWebhookUrl(config, process.env);
  if (!webhookUrl) {
    const hasEnvPointer = typeof config.webhook_url_env === 'string' || typeof config.url_env === 'string';
    return NextResponse.json({
      ok: false,
      reachable: false,
      verified: false,
      phase: 'config',
      reason: hasEnvPointer ? 'Webhook URL env var is not configured or did not contain a valid http(s) URL' : 'No webhook_url, url, webhook_url_env, or url_env configured',
      signed: false,
      secret_env_configured: false,
    }, { status: 400 });
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
  const signature = getWebhookSignatureSecret(config, process.env);
  const signedHeaders = signature.secret
    ? buildSignedWebhookHeaders({ rawBody: payload, secret: signature.secret, deliveryId })
    : undefined;
  const headers = {
    ...buildWebhookHeaders(config, process.env),
    ...HEALTH_TEST_HEADERS,
    ...(signedHeaders || {}),
  };

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
    const reachable = true;
    const verified = response.ok && signature.configured;
    return NextResponse.json({
      ok: verified,
      reachable,
      verified,
      phase: signature.configured ? 'post_signed_ping' : 'post_unsigned_ping',
      http_status: response.status,
      latency_ms: latencyMs,
      signed: signature.configured,
      secret_env: signature.env_name,
      secret_env_configured: signature.configured,
      message: !signature.configured
        ? `Webhook responded, but signing secret env ${signature.env_name} is not configured. Auto-dispatch remains disabled.`
        : response.ok
          ? 'Webhook accepted signed non-task ping.'
          : 'Webhook ping returned a non-2xx status.',
    }, { status: !signature.configured ? 424 : response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      reachable: false,
      verified: false,
      phase: signature.configured ? 'post_signed_ping' : 'post_unsigned_ping',
      reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'request_failed',
      signed: signature.configured,
      secret_env: signature.env_name,
      secret_env_configured: signature.configured,
    }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
