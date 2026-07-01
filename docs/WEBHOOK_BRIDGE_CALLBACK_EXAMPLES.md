# Webhook Bridge Callback Examples

Last updated: 2026-07-01

MCK bridge authors can report task completion to:

```text
POST /api/webhooks/agent-completion
```

## Canonical callback payload

```json
{
  "schema_version": "1",
  "type": "mck.callback.completed",
  "task_id": "task-id",
  "attempt_id": "dispatch-attempt-id",
  "status": "completed",
  "completed_at": "2026-07-01T12:00:00.000Z",
  "summary": "Implemented, tested, committed, and pushed.",
  "result": {},
  "metadata": {}
}
```

Schema endpoint:

- `GET /api/schemas/webhook-callback-completion`
- `GET /api/schemas/webhook-callback-completion?download=1`

## Required headers for signed callbacks

When `MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET` is configured, signed callbacks must include:

```text
X-MCK-Delivery-ID: unique-delivery-id
X-MCK-Timestamp: unix-seconds
X-MCK-Signature: sha256=<hex-hmac-sha256>
```

Signature base string:

```text
<delivery-id>.<timestamp>.<raw-json-body>
```

MCK rejects stale timestamps and duplicate delivery IDs. Duplicate accepted deliveries return a success response with `duplicate: true` and do not mutate the task again.

## JavaScript signing example

```js
import crypto from 'node:crypto';

export function signMckCallback({ rawBody, deliveryId, timestamp, secret }) {
  const signed = `${deliveryId}.${timestamp}.${rawBody}`;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
}
```

## Python signing example

```python
import hashlib
import hmac

def sign_mck_callback(raw_body: bytes, delivery_id: str, timestamp: str, secret: str) -> str:
    signed = f"{delivery_id}.{timestamp}.".encode("utf-8") + raw_body
    digest = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"sha256={digest}"
```

## Safe bridge behavior

- Sign the exact raw JSON bytes you send.
- Generate one delivery ID per delivery attempt; reuse the same delivery ID for redelivery of the same attempt.
- Never put secrets in `runtime_config`; store env-var names only.
- Treat MCK 2xx duplicate responses as idempotent success.
- Use the non-task webhook health ping endpoint before sending real work.
