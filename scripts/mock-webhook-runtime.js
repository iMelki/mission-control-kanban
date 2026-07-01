#!/usr/bin/env node
const http = require('node:http');
const crypto = require('node:crypto');

const port = Number(process.env.PORT || process.env.MCK_MOCK_WEBHOOK_PORT || 0);
const mode = process.env.MCK_MOCK_WEBHOOK_MODE || 'success';
const delayMs = Number(process.env.MCK_MOCK_WEBHOOK_DELAY_MS || 0);
const secret = process.env.MCK_WEBHOOK_SIGNATURE_SECRET || '';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(req, rawBody) {
  if (!secret) return { ok: true, skipped: true };
  const signature = req.headers['x-mck-signature'];
  const timestamp = req.headers['x-mck-timestamp'];
  if (typeof signature !== 'string' || typeof timestamp !== 'string') return { ok: false, reason: 'missing signature headers' };
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return {
    ok: crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
    reason: 'signature mismatch',
  };
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true, mode, signed_verification_enabled: Boolean(secret) });
    return;
  }
  if (req.method === 'POST' && req.url === '/dispatch') {
    const rawBody = await readBody(req);
    const verification = verifySignature(req, rawBody);
    const payload = JSON.parse(rawBody || '{}');
    console.log(JSON.stringify({ received_at: new Date().toISOString(), headers: req.headers, payload }, null, 2));
    if (!verification.ok) {
      send(res, 401, { ok: false, error: verification.reason });
      return;
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (mode === 'failure') {
      send(res, 500, { ok: false, error: 'Mock webhook failure mode' });
      return;
    }
    send(res, 202, { ok: true, accepted: true, mode, task_id: payload.task?.id || payload.task_id || null });
    return;
  }
  send(res, 404, { ok: false, error: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}/dispatch`;
  console.log(`MCK mock webhook runtime listening on ${url}`);
  console.log('Copyable runtime config:');
  console.log(JSON.stringify({
    provider: 'mock-webhook',
    webhook_url: url,
    bearer_token_env: 'MCK_MOCK_WEBHOOK_TOKEN',
    signature_secret_env: 'MCK_WEBHOOK_SIGNATURE_SECRET',
    timeout_ms: 5000,
    headers: { 'X-MCK-Runtime': 'mock-webhook' },
  }, null, 2));
});
