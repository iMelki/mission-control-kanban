# Webhook Bridge Callback Examples

Last updated: 2026-07-29

MCK bridge authors can report task completion to:

```text
POST /api/webhooks/agent-completion
```

## Canonical callback payload

The v1 completion contract remains supported:

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

## Factory lifecycle callback v2

Dispatch v2 bridges report each execution stage with the stable identities
from the accepted dispatch:

```json
{
  "schema_version": "2",
  "type": "mck.callback.lifecycle",
  "task_id": "task-id",
  "attempt_id": "596c0f76-3a87-42fc-b5b3-95cd38f540c8",
  "correlation_id": "mck:assistants:task-id",
  "task_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "status": "review",
  "occurred_at": "2026-07-29T12:00:00.000Z",
  "summary": "Independent review started",
  "result": {
    "paperclip_parent_issue_id": "paperclip-issue-id",
    "paperclip_stage_issue_ids": {
      "plan": "paperclip-plan-id",
      "build": "paperclip-build-id",
      "validate": "paperclip-validate-id",
      "review": "paperclip-review-id",
      "release": "paperclip-release-id"
    }
  }
}
```

Supported statuses and MCK effects:

| Lifecycle status | MCK task status |
| --- | --- |
| `started` | `in_progress` |
| `testing` | `testing` |
| `review` | `review` |
| `completed` | `done`, but only with the receipt proof below |
| `blocked`, `needs_human`, `failed`, `cancelled` | Evidence is recorded without false forward movement |

Fetch the v2 schema with:

- `GET /api/schemas/webhook-callback-completion?version=2`
- `GET /api/schemas/webhook-callback-completion?version=2&download=1`

### Completion receipt gate

`completed` is rejected unless it includes deterministic validation,
independent accepted review, and pushed `dev` release evidence:

```json
{
  "schema_version": "2",
  "type": "mck.callback.lifecycle",
  "task_id": "task-id",
  "attempt_id": "596c0f76-3a87-42fc-b5b3-95cd38f540c8",
  "correlation_id": "mck:assistants:task-id",
  "task_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "status": "completed",
  "occurred_at": "2026-07-29T12:30:00.000Z",
  "summary": "Validation, review, commit, push, and readback passed.",
  "receipt": {
    "schemaVersion": "agent-settings.factory-run-receipt.v1",
    "receiptId": "factory-receipt-596c0f76",
    "envelopeId": "factory:596c0f76-3a87-42fc-b5b3-95cd38f540c8",
    "correlationId": "mck:assistants:task-id",
    "taskRevisionSha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "status": "succeeded",
    "run": {
      "paperclipIssueId": "paperclip-issue-596c0f76",
      "paperclipRunId": "paperclip-run-596c0f76",
      "workspaceId": "paperclip-workspace-596c0f76",
      "roleProfile": "factory-release-steward",
      "profileManifestSha256": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "effectiveConfigSha256": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      "toolInventorySha256": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      "startedAtUtc": "2026-07-29T12:00:00.000Z",
      "finishedAtUtc": "2026-07-29T12:30:00.000Z",
      "durationMs": 1800000,
      "mutationIntent": "release"
    },
    "repository": {
      "slug": "iMelki/mission-control-kanban",
      "branch": "dev",
      "baseSha": "9999999999999999999999999999999999999999",
      "headBeforeReleaseSha": "8888888888888888888888888888888888888888",
      "candidateSnapshotSha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "finalSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "changedPaths": ["src/lib/dispatch-adapters.ts"]
    },
    "commands": [
      {
        "id": "command:factory-validation",
        "stage": "validation",
        "status": "passed",
        "argv": ["npm", "test"],
        "workingDirectory": ".",
        "startedAtUtc": "2026-07-29T12:10:00.000Z",
        "finishedAtUtc": "2026-07-29T12:20:00.000Z",
        "durationMs": 600000,
        "exitCode": 0,
        "stdoutSha256": "sha256:4444444444444444444444444444444444444444444444444444444444444444",
        "stderrSha256": "sha256:5555555555555555555555555555555555555555555555555555555555555555"
      }
    ],
    "tests": {
      "total": 1,
      "passed": 1,
      "failed": 0,
      "skipped": 0
    },
    "artifacts": [],
    "metrics": {
      "inputWorkItems": 1,
      "processedItems": 1,
      "changedItems": 1,
      "retryCount": 0,
      "deferralCount": 0,
      "errorCount": 0,
      "inputTokens": 1200,
      "outputTokens": 600,
      "billedCents": 0,
      "hostPressure": "normal",
      "backendLatencyMs": 42,
      "freshnessAtUtc": "2026-07-29T12:30:00.000Z",
      "caller": "paperclip"
    },
    "review": {
      "reviewerId": "independent-reviewer-agent",
      "decision": "accept",
      "freshSession": true,
      "builderSessionReused": false,
      "reviewedAtUtc": "2026-07-29T12:25:00.000Z",
      "evidenceSha256": "sha256:6666666666666666666666666666666666666666666666666666666666666666"
    },
    "approvals": [],
    "release": {
      "attempted": true,
      "pushed": true,
      "remoteRef": "refs/heads/dev",
      "commitSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "remoteReadbackSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "startedAtUtc": "2026-07-29T12:25:00.000Z",
      "finishedAtUtc": "2026-07-29T12:30:00.000Z"
    },
    "publications": [],
    "reconciliation": {
      "mck": "pending",
      "paperclip": "matched",
      "missionControl": "pending",
      "githubProject": "pending",
      "git": "matched"
    },
    "privacy": {
      "secretsIncluded": false,
      "directContactOrPaymentIdentifiersIncluded": false,
      "rawPrivateLogsIncluded": false,
      "redactionApplied": true
    },
    "errors": []
  }
}
```

MCK verifies that the attempt, correlation, and revision still match. It also
recomputes current task intent—including the assigned agent and normalized
runtime configuration—and rejects a callback if either changed after dispatch.
`candidateSnapshotSha256` binds the exact validated bytes to release; the
Release tool recomputes it before staging and pushing. Agent Settings owns the
complete canonical receipt schema, which the bridge treats as versioned and
forward-compatible:
<https://github.com/iMelki/agent-settings/blob/dev/shared/schemas/software-factory/factory-run-receipt.v1.schema.json>.

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

MCK rejects stale timestamps. Duplicate deliveries with identical bytes return
success with `duplicate: true` and do not mutate the task again. Reusing a
delivery ID with different bytes returns `409 payload_conflict`. Lifecycle v2
does not accept the legacy, delivery-unbound signature or the
`X-MCK-Delivery` alias. Signature failures are rejected before the canonical
replay ledger is touched. The valid callback claim, task/attempt/revision
checks, state updates, receipt persistence, and final accepted marker commit in
one SQLite transaction, so a persistence failure rolls back the claim and an
exact redelivery can retry.

The receiver checks a declared `Content-Length` before reading, streams no more
than 1 MiB, and enforces independent 10-second total and 2-second inactivity
deadlines. Chunked bodies are supported and are signed over the exact
reassembled bytes; oversized, truncated, stalled, or invalid UTF-8 bodies fail
before schema processing.

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
- Preserve lifecycle ordering. MCK rejects regressive stage updates.
- Do not send `completed` until the exact receipt is final and immutable.
- Keep every `receipt.repository.changedPaths` entry canonical and within the
  accepted dispatch `allowed_file_scope`.
- Use the non-task webhook health ping endpoint before sending real work.
