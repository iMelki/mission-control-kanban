# MCK Agentic Factory Bridge

This installable Paperclip plugin accepts Mission Control Kanban's signed
health and task-dispatch webhooks, creates one sequential Paperclip execution
graph, and returns signed lifecycle evidence to MCK and Mission Control.

## Compatibility

- Paperclip plugin API: v1
- The SDK and its matching `@paperclipai/shared` runtime are immutable,
  repository-vendored package tarballs built from owned Paperclip commit
  `021ab2f08e07463b038c3d1472f227d2d5f68ca4`. `package-lock.json` pins both
  file dependencies and their npm integrity values; adjacent provenance
  records pin their SHA-256 digests and source paths.
- Host API validated against that exact owned commit and plugin SDK/API
  version `1.0.0`; validation fails closed on any host SHA mismatch even when
  partial file attestations are present. Do not replace the tarballs with a moving canary or a
  registry package without a fresh compatibility review and Worker RPC test.
- `npm audit` reports
  [GHSA-3pw3-v88x-xj24](https://github.com/advisories/GHSA-3pw3-v88x-xj24)
  because the owned `@paperclipai/shared` package still carries the historical
  `0.3.1` label. The required host commit is a descendant of fix commit
  `32a9165ddf6308f3b46eae0653b6f583e502e538`, which blocks
  agent-authenticated instructions-path/bundle mutations. This is a documented
  semver-classification signal, not permission to install the bridge on an
  older vulnerable host.
- Every outbound request supplies the factory `companyId` to Paperclip's host
  HTTP gateway. The initializer must install the corresponding company-scoped
  loopback rules separately; the plugin never bypasses host policy.
- MCK dispatch: v1 accepted; v2 adds stable factory identity and lifecycle
  receipts
- Local/self-hosted installation only; plugin UI is trusted same-origin code

## Build and test

```powershell
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:migrations
npm run --prefix ../.. test:paperclip-host-migrations
npm run build
npm pack --dry-run
```

The Worker RPC integration test starts the real vendored SDK host over
duplex streams and proves that scheduled reconciliation scopes both
`config.get` and outbound `http.fetch` calls to the configured company.
The migration checks separately run every SQL statement through the exact
declared Paperclip host validator and exercise the empty install, legacy
backfill/composite constraints, cross-company rejection, and fail-closed
legacy cases in a short-lived digest-pinned PostgreSQL 17 container. Every
`psql` call uses `-X` and `ON_ERROR_STOP`.

## Paperclip configuration

Configure these instance settings in Plugin Manager:

- `companyId` and `projectId`
- `directorAgentId`, `builderAgentId`, `validatorAgentId`,
  `reviewerAgentId`, and `integratorAgentId`
- `dispatchSecretRef`: secret reference matching MCK's outbound HMAC secret
- `callbackSecretRef`: secret reference matching
  `MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET`
- `missionControlOutcomeSecretRef`: a separate scoped secret reference
  matching Mission Control's `MISSION_CONTROL_FACTORY_OUTCOME_SIGNATURE_SECRET`
- exact loopback `missionControlBaseUrl=http://127.0.0.1:3001`
- `githubSyncMode=apply` when Mission Control outcome publication is enabled
- `allowedRepositoryOwner=iMelki`

Choose all three HMAC values through Paperclip's secret picker. The stored values
must be shared `{ "type": "secret_ref", "secretId": "...", "version":
"latest" }` bindings; raw UUIDs, secret values, and legacy string references
fail closed.

The manifest intentionally marks these fields with `format: "secret-ref"`
without declaring JSON `type: "string"`. Paperclip's generic plugin-config API
validates the picker-submitted object before extracting its secret binding; a
string schema would reject the object while a bare UUID is correctly rejected
by the secret handler. Keep this representation until the generic host route
normalizes secret-picker values before schema validation.

`githubSyncMode=apply` fails configuration validation and health unless the
exact Mission Control URL above is present. MCK dispatch v2 likewise requires
both lifecycle aliases to equal
`http://127.0.0.1:3021/api/webhooks/agent-completion` and requires
`mission_control_url=http://127.0.0.1:3021`. Alternate hostnames, userinfo,
queries, fragments, and alias drift are rejected before issue creation.

The five roles must be distinct where the company execution policy requires
independent review. Only the Builder stage mutates source; the other stages are
sequential blockers.

Paperclip replays the persisted company configuration through
`onConfigChanged` when the worker starts. The bridge validates that callback's
company context and retains the authorized company IDs for scheduled jobs;
webhook, event, tool, and UI invocations use their own host-provided company
context. Configuration is read and matched before any plugin SQL is issued.
Every delivery, mapping, lifecycle row, primary key, unique key, foreign key,
lookup, mutation, retry, count, and diagnostics query includes `company_id`.
Migration `005_company_isolation.sql` backfills only rows whose company can be
proved from linked Paperclip issues/mappings. The empty pre-release database
migrates directly; ambiguous legacy rows fail the migration instead of being
assigned to a guessed tenant. Paperclip applies the migration transactionally;
the `NOT NULL` transition is the fail-closed gate for an unresolved company.
The two pre-company indexes remain as harmless compatibility indexes because
the declared host forbids destructive `DROP` statements.

## Install from this checkout

Build first, then install the absolute local path:

```powershell
$body = @{
  packageName = 'S:\source\CCAI\Assistants\tools\mission-control-kanban\integrations\paperclip-bridge'
  isLocalPath = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:5113/api/plugins/install' `
  -ContentType 'application/json' `
  -Body $body
```

The webhook URL is:

```text
http://127.0.0.1:5113/api/plugins/imelki.mck-paperclip-bridge/webhooks/mck-dispatch
```

Use that URL in an MCK webhook agent with:

```json
{
  "webhook_url": "http://127.0.0.1:5113/api/plugins/imelki.mck-paperclip-bridge/webhooks/mck-dispatch",
  "dispatch_version": 2,
  "signature_secret_env": "MCK_WEBHOOK_SIGNATURE_SECRET",
  "timeout_ms": 30000
}
```

Run MCK's signed webhook health wizard before setting `dispatch_enabled=true`.

## Lifecycle evidence

The bridge reports:

- `started` when the graph is created and the plan stage is queued
- `testing` when deterministic validation starts
- `review` when independent review starts
- `completed` only after three exact latest issue documents and live stage
  state jointly prove passed validation, independent accepted review, a `dev`
  commit, and a successful push
- blocked/failure states as evidence without falsely advancing MCK

The release-stage `factory-run-receipt` must conform to
`agent-settings.factory-run-receipt.v1`, be the exact latest
Integrator-authored document, and prove candidate snapshot plus remote SHA
readback. It is not sufficient by itself:

- the Validator issue must contain the exact latest
  `factory-validation-evidence` document conforming to
  `agent-settings.factory-validation-evidence.v1`;
- the Review issue must contain the exact latest `factory-release-evidence`
  document conforming to `agent-settings.factory-release-evidence.v1`;
- each document must be company/issue/key scoped, Markdown, have a current
  revision, have no user author, and have both its create/update agent equal
  the configured stage role;
- the Validator document's declared run must be the current successful
  Validator run, and its ordered command hashes must equal canonical hashes of
  the receipt's validation commands;
- the Reviewer document's declared run must be the current successful
  Reviewer run and be fresh after validation;
- the two evidence documents and receipt must agree exactly on company,
  project, root/stage issues, workspace, envelope/validation/context hashes,
  validation-document body hash, candidate snapshot, base/head SHA, changed
  paths, reviewer capabilities, approvals, metrics, and timestamps;
- the Builder, Validator, Reviewer, and Integrator must be four distinct
  agents and runs; their current successful run windows must contain their
  authored evidence, and the current Integrator release run must contain the
  exact receipt document and release timestamps.

The installed SDK exposes document-level latest revision and agent attribution
but not revision/activity run provenance. The bridge therefore does not invent
an unsupported run-author field: it binds the exact document body hash and
`updatedByAgentId` to the body-declared run ID, then requires that ID to be the
unique current successful host run and requires the document update timestamp
to fall within that run. Any user-authored document, active/newer replacement,
current failure, hash drift, or open approval/budget/invocation block prevents
completion. This bounded SDK-side attestation supplements rather than replaces
Agent Settings' deterministic release composer: the composer uses Paperclip's
direct document/revision REST endpoints to prove `createdByRunId` before it
publishes the required receipt. Agents can also call the contributed
`report-lifecycle` tool with the correlation ID.

## Idempotency and diagnostics

- The exact raw request body is HMAC verified with its delivery ID and
  timestamp.
- Dispatch v2 freezes the owned checkout's current `origin/dev` commit as
  `factory_contract.repository.base_sha`; that commit participates in the task
  revision and must match the release receipt's base SHA.
- The parent is created unassigned in `backlog`. Its full signed dispatch JSON
  is stored as the raw body of the markdown `mck-task-envelope` document,
  read back byte-for-byte, and only then moved to `todo` under the Director.
- Delivery ID plus SHA-256 payload hash prevents replay substitution.
- Issue origins and database mappings prevent duplicate execution graphs.
  Inbound delivery and correlation reservations use unique ownership tokens,
  monotonic generations, and independent lease clocks. A reclaimed worker can
  complete or fail only its own generation; a late former owner cannot mutate
  the new owner's record.
- A changed task revision for an existing correlation is rejected before graph
  creation; a new attempt for the unchanged revision reuses the graph and
  immediately replays the exact persisted current-stage or terminal-receipt
  envelope.
- Callback payloads are persisted before delivery so retries use identical
  bytes, IDs, payload hashes, and original targets even when a newer dispatch
  replaces the mutable correlation mapping.
- Persisted MCK targets are revalidated against the one permitted literal
  loopback lifecycle URL before every initial send and repair attempt. A
  corrupted or migrated target fails before secret resolution or network I/O.
- MCK callback delivery and Mission Control outcome publication have
  independent persisted status, ownership generations, lease timestamps, and
  attempt counters. A reclaimed delivery can be finalized only by its current
  owner, and one slow channel cannot make the other channel's lease appear
  fresh. Mission Control remains eligible after MCK exhausts all three
  delivery attempts.
- Company plus source event/run/issue identity participates in each lifecycle delivery key,
  so a plan blockage, recovery, later build blockage, and repeated
  `needs_human` occurrences remain separate evidence.
- Dispatch scopes and receipt paths must be canonical repository-relative
  paths; absolute, drive, UNC, backslash, empty, dot/dot-dot, encoded-separator,
  and non-normalized values fail closed. Every receipt path must match the
  accepted dispatch scope.
- MCK's lifecycle receiver preflights `Content-Length`, streams at most 1 MiB,
  and applies independent total and inactivity deadlines before parsing or
  authentication.
- The initial webhook waits for the signed MCK `started` callback but leaves
  the independently signed Mission Control publication pending for the
  reconciliation job, so a slow GitHub apply cannot delay MCK acceptance.
- A 2xx response containing `success:false` or `accepted:false` is a failed
  publication and remains eligible for bounded reconciliation. A rejected MCK
  lifecycle transition records its delivery failure but does not advance the
  mapping's current-stage/replay pointer.
- The scheduled reconciliation job makes no more than two repair sends after
  each initial delivery attempt; exhaustion remains visible as degraded
  health.
- Dashboard, task-detail, and settings contributions expose linked IDs,
  lifecycle/stage state, receipt ID, run/cost/token metrics, pending decisions,
  freshness, and redacted failures.
- Detailed diagnostics are available only through the company-scoped UI data
  loader. The context-free host health hook validates configuration only and
  does not query or aggregate tenant runtime state. It reports configuration
  freshness only and never emits company IDs, mapping rows, or tenant counts.
- Resolved secrets, authorization headers, and URL query strings are never
  persisted in diagnostics.

Paperclip's current plugin webhook hook returns `Promise<void>`, so the host
owns the generic HTTP response body. The bridge publishes the existing/new
Paperclip issue mapping in the immediate signed `started` callback and exposes
the same linkage in its UI.
