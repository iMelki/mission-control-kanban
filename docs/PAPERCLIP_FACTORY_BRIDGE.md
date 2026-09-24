# Paperclip Software-Factory Bridge

Last updated: 2026-08-09

Issue [#47](https://github.com/iMelki/mission-control-kanban/issues/47)
adds the Day-0 bridge between Mission Control Kanban (MCK) and Paperclip.
MCK owns intake, grooming, assignment, launch, retry, and local status.
Paperclip owns execution after a signed dispatch is accepted.

Upstream contract references used for this implementation:

- [Paperclip plugin administration](https://docs.paperclip.ing/administration/plugins/)
  documents the alpha/pin-version policy, local-path installation, worker
  process, status UI, and webhook operations.
- [Paperclip plugin API](https://docs.paperclip.ing/reference/api/plugins/)
  defines the inbound
  `POST /api/plugins/:pluginId/webhooks/:endpointKey` route.
- [Paperclip plugin specification](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_SPEC.md)
  defines at-least-once event delivery, idempotent webhook handling,
  capability-gated SDK clients, and UI data/action bridges.
- [JSON Schema 2020-12 core](https://json-schema.org/draft/2020-12/draft-bhutton-json-schema-00)
  and [validation](https://json-schema.org/draft/2020-12/json-schema-validation)
  define the canonical envelope validation vocabulary.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) and the
  [community reference implementations](https://github.com/cyberphone/json-canonicalization)
  informed deterministic recursive-key canonicalization for the contract's
  schema-constrained JSON value domain.
- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
  support stable delivery identities, signature verification before work, and
  replay-safe processing.

## Golden path

```text
GitHub / Project
  → MCK task and dispatch attempt
  → signed Paperclip plugin webhook
  → parent issue
  → plan
  → build
  → deterministic validation
  → independent review
  → release
  → signed lifecycle receipt
  → MCK and Mission Control
```

The graph is sequential. Only one Builder stage is created, and the contract
limits repair to two attempts. MCK never treats HTTP acceptance as completion.

## Components

- `src/lib/dispatch-adapters.ts` creates the pending v2 attempt before POST,
  calculates stable identity and task revision, signs exact bytes, then updates
  the same row.
- `src/lib/factory-dispatch.ts` is the server-only canonical-envelope builder;
  it keeps Node hashing and plugin contracts out of client runtime bundles.
- `src/lib/webhook-dispatch-schema.ts` owns the v1 and v2 outbound schemas.
- `src/app/api/webhooks/agent-completion/route.ts` verifies and reconciles
  lifecycle callbacks.
- `integrations/paperclip-bridge` is the installable Paperclip plugin.
- `.agentic-factory.json` is the repository-owned exact-argv validation and
  release policy.

## Configure MCK

Configure an MCK webhook agent with secret references, not secret values:

```json
{
  "webhook_url": "http://127.0.0.1:5113/api/plugins/imelki.mck-paperclip-bridge/webhooks/mck-dispatch",
  "dispatch_version": 2,
  "signature_secret_env": "MCK_WEBHOOK_SIGNATURE_SECRET",
  "timeout_ms": 30000
}
```

Keep `dispatch_enabled` off until MCK's signed webhook health wizard reports
both `reachable=true` and `verified=true`. The health request is `mck.ping`; it
does not create a Paperclip issue.

## Build and install the plugin

```powershell
Set-Location 'S:\source\CCAI\Assistants\tools\mission-control-kanban\integrations\paperclip-bridge'
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

Install the absolute local package path with Paperclip Plugin Manager or its
loopback installation API. Configure:

- factory company and project IDs;
- distinct Director, Builder, Validator, Reviewer, and Integrator agent IDs;
- `dispatchSecretRef` for MCK outbound signatures;
- `callbackSecretRef` for Paperclip lifecycle signatures;
- `missionControlOutcomeSecretRef` for the separately scoped Mission Control
  factory-outcome HMAC secret;
- loopback Mission Control base URL;
- GitHub publication mode, default `apply`.

The three HMAC fields use Paperclip's `format: "secret-ref"` picker and persist
only shared `secret_ref` binding objects. Do not paste a raw secret, UUID, or
legacy string reference into plugin configuration.

For compatibility with Paperclip's current generic plugin-config route, those
three schema properties deliberately omit `type: "string"`. The route validates
configuration before extracting secret bindings, while the picker submits
object-shaped `{type:"secret_ref", secretId, version}` values. Retaining the
format marker preserves secret-path discovery and allows the host secret
handler—not a permissive string field—to validate the binding.

The allowed GitHub owner is fixed to `iMelki`. Changing it is a configuration
error, not a warning.

Apply-mode configuration also requires the exact loopback Mission Control base
`http://127.0.0.1:3001`. Dispatch v2 requires both lifecycle aliases to be
identical to
`http://127.0.0.1:3021/api/webhooks/agent-completion` and requires
`mission_control_url=http://127.0.0.1:3021`. Alternate hostnames, userinfo,
query strings, fragments, and alias drift fail before Paperclip reserves a
mapping or creates an issue.

The installable SDK and its matching `@paperclipai/shared` runtime are
immutable tarballs vendored under `integrations/paperclip-bridge/vendor`.
Both were packed from the owned Paperclip commit
`021ab2f08e07463b038c3d1472f227d2d5f68ca4`; package metadata, lockfile
integrities, adjacent provenance JSON, and SHA-256 digests bind the install to
that exact source. This avoids both a moving canary and a stale registry
`@paperclipai/shared` artifact. Replacing either tarball requires a fresh
compatibility review and Worker RPC test.

The host compatibility gate is separately pinned to the clean, owned
Paperclip `dev` commit
`aeff5ddaf25e861f2bbff5d5840be417866cae3a`. Exact-SHA migration and policy
validation passed against that checkout; the retained file attestation is
additive evidence and cannot bypass a host-SHA mismatch. This is source
compatibility evidence only, not installed-runtime or release acceptance.

The retained upstream package version causes `npm audit` to classify both the
SDK and shared runtime under
[GHSA-3pw3-v88x-xj24](https://github.com/advisories/GHSA-3pw3-v88x-xj24).
The compatible host source is newer than the advisory's patched release and
contains fix commit `32a9165ddf6308f3b46eae0653b6f583e502e538`, whose route
guards reject agent-authenticated instructions-path and bundle mutations.
Provenance records this known signal. It does not waive the exact-host gate:
the bridge must not be installed on an older Paperclip build merely because
the plugin package itself installs.

Every plugin outbound request passes `{companyId}` through Paperclip's host
HTTP gateway. Company-scoped loopback rules are installed by the factory
initializer as a separate, idempotent operation. Paperclip's startup
configuration replay calls `onConfigChanged`; the worker validates that
callback's company context and records it for scheduled reconciliation.
Webhook, event, tool, and UI calls continue to use their host-provided company
context. The worker reads and matches that configuration before issuing SQL.
Every bridge table and access path uses `company_id`, including composite
primary/unique/foreign keys, lifecycle retry selection, mapping lookup,
dashboard counts, and failure summaries. Migration 005 passes directly on the
empty pre-release database, backfills only provable issue/mapping ownership,
and rejects ambiguous legacy rows rather than guessing a tenant. The
transactional `NOT NULL` transition is the fail-closed gate; retained
pre-company indexes are harmless because the declared host disallows
destructive `DROP` statements. Exact-host policy validation plus a
digest-pinned PostgreSQL 17 harness reproduce the empty install, backfill and
composite-constraint readback, cross-company rejection, and unresolved legacy
failure with `ON_ERROR_STOP`.
Company details are returned only by the host-authorized company-scoped UI data
loader. Paperclip's context-free health hook validates configuration only and
does not query or aggregate tenant runtime state. It reports configuration
freshness without company IDs, tenant counts, or mapping rows.

## Acceptance and replay rules

MCK and the plugin sign:

```text
<delivery-id>.<unix-timestamp>.<exact-raw-json-body>
```

with HMAC-SHA-256. Both sides enforce timestamp freshness and compare
signatures without timing leaks.

The plugin stores delivery ID plus payload hash before orchestration:

- identical redelivery is an idempotent success;
- the same ID with different bytes is rejected;
- a new delivery for the same correlation reuses the existing issue graph;
- same-revision redispatch immediately replays the exact persisted
  current-stage or terminal-receipt delivery rather than synthesizing a new
  receipt;
- a changed task revision for an existing correlation is rejected before any
  issue creation or update;
- a non-`iMelki`, non-`dev`, or incomplete factory contract is rejected before
  issue creation.
- allowed scopes and receipt changed paths must be canonical,
  repository-relative forward-slash paths. Absolute, drive, UNC, empty,
  dot/dot-dot, encoded-separator, backslash, and non-NFC values are rejected,
  and every changed path must match the accepted scope.
- the contract carries `factory:<attempt-id>` as its stable envelope identity,
  and the final receipt must bind that exact identity.
- the v2 dispatch carries the complete canonical Agent Settings
  `factory-task-envelope.v1` alongside the existing snake_case compatibility
  aliases. MCK validates the schema-constrained document, requires every alias
  to match it, computes a deterministic canonical SHA-256, and persists the
  envelope ID, digest, and exact JSON on the pending attempt before network
  I/O. Lifecycle processing reparses the stored JSON, revalidates its identity,
  and recomputes its digest before accepting it as authority.
- MCK reads the owned local checkout's current `origin/dev` commit immediately
  before v2 dispatch, records it as lowercase 40-hex `repository.base_sha`,
  and includes it in the task revision. The authoritative remote read has a
  finite 30-second allowance so verified slow SSH reads do not become false
  dispatch failures.
- Paperclip creates the parent as unassigned `backlog`, stores the complete
  signed raw JSON as a markdown `mck-task-envelope` document, reads it back
  byte-for-byte, and only then activates the parent as `todo` for the Director.

Both the delivery ledger and the correlation reservation are owner-fenced.
Each claim receives a unique token and monotonic generation, with a separate
lease clock for correlation intake. A worker may complete or fail only the
generation it owns. If a lease is reclaimed, a late prior worker cannot create,
complete, fail, or repoint the replacement owner's graph.

The current Paperclip plugin API exposes a `Promise<void>` webhook hook, so the
host returns its generic acceptance response. Cross-system IDs are returned
immediately in the signed `started` lifecycle callback and remain visible in
plugin diagnostics.

## Lifecycle and completion

The plugin publishes:

- `started` when the plan stage is queued;
- `testing` when deterministic validation starts;
- `review` when the independent review starts;
- `completed` after the release issue is done and its Integrator-authored
  `factory-run-receipt`, the Validator issue's
  `factory-validation-evidence`, and the Review issue's
  `factory-release-evidence` all pass strict readback and live-run validation;
- `blocked`, `needs_human`, `failed`, or `cancelled` as evidence without false
  forward movement.

MCK binds every callback to the original attempt, correlation, task revision,
and assigned agent/runtime configuration. Lifecycle v2 requires the exact
delivery-ID-bound signature; legacy signature fallback remains v1-only.
Authentication failures never reserve a canonical replay key. After
authentication, MCK claims the delivery, validates current intent, persists
state/receipt evidence, and marks the claim accepted in one SQLite transaction,
so a transient persistence failure rolls the claim back for exact redelivery.
It rejects regressive stages and recomputes current task intent to detect stale
work.

The `completed` receipt must be
`agent-settings.factory-run-receipt.v2` and pass the same authority projection
used by Mission Control, not merely the summary checks below. Version 1 remains
readable for historical/reconciliation evidence but is explicitly
compatibility-only and cannot move a task to Done. Version 2 must prove:

1. deterministic validation passed;
2. a fresh independent reviewer accepted;
3. the Builder run/workspace plus role-profile, effective-config, and
   tool-inventory hashes are present;
4. `repository.candidateSnapshotSha256` still matches the validated candidate;
5. exact index tree/entry evidence and Reviewer session-provenance evidence are
   present;
6. an identified Integrator/Release Steward pushed the release commit to
   `refs/heads/dev`, and remote readback returned that exact SHA plus tree;
7. Paperclip and git reconciliation are matched, while downstream MCK and
   Mission Control publication may still be pending during this callback;
8. privacy flags prove that no secrets, direct contact/payment identifiers, or
   raw private logs were included.

The receipt is not trusted by itself. Before publishing `completed`, the
plugin reads Paperclip's live orchestration, issue subtree, and three exact
latest issue documents. Validator evidence must conform to
`agent-settings.factory-validation-evidence.v1`; Reviewer evidence must
conform to `agent-settings.factory-release-evidence.v1`; and the release
receipt must conform to authoritative `agent-settings.factory-run-receipt.v2`.
All three
documents must be company/issue/key scoped, current-revision Markdown, free of
user authorship, and created/updated by the configured role.

The SDK provides document body hashes, latest revision identity, and
create/update agent identity, but does not expose immutable revision/activity
run reads. The bridge therefore binds each exact raw document-body hash to its
body-declared run, proves that run is the unique current successful run for
the mapped stage, and requires the document update timestamp to fall within
that run. It does not claim unsupported revision-run provenance. This is an
additional SDK-side gate, not a replacement for Agent Settings' deterministic
release composer: the composer uses the direct Paperclip document/revision REST
surface to prove `createdByRunId` before publishing the receipt that MCK still
requires for completion.

The Validator and Reviewer documents cross-bind envelope, validation,
Process-context, validation-document, candidate snapshot, base/head SHA,
changed paths, root/stage issues, company, project, workspace, ordered
canonical command hashes, role capability hashes, decisions, and timestamps.
The receipt must agree with those bindings, approvals, and metrics. Builder,
Validator, Reviewer, and Integrator are distinct agents and runs; review starts
after validation; and the exact Integrator-authored receipt plus release
timestamps fall within the current successful release run. Any active/newer
replacement, current failure, author/hash drift, cross-company mismatch, or
open approval, budget, or invocation decision blocks completion.

## Diagnostics and recovery

Paperclip receives three plugin UI contributions:

- dashboard summary for health, freshness, stage status, run/cost/token metrics,
  pending approval/budget/invocation decisions, failures, and receipt;
- issue linkage view for parent/stage IDs and MCK correlation;
- settings diagnostics for configuration and redacted failure evidence.

MCK's Dispatch timeline shows the delivery, correlation, task revision,
lifecycle stage, envelope ID/hash, receipt version/authority/hash, and final
receipt ID. Callback and dispatch ledgers preserve
payload hashes without displaying secrets.

Lifecycle delivery persists the exact raw bytes, delivery ID, payload hash, and
accepted target before network I/O. A deterministic five-minute reconciliation
job makes at most two repair sends after the initial attempt; it always reuses
the exact row bytes, ID, hash, and target even after a newer attempt updates the
correlation mapping. Before every initial MCK send and repair attempt, the
persisted target must still equal the one permitted literal loopback lifecycle
URL; mismatch fails before secret resolution or network I/O.

MCK callback delivery and Mission Control outcome publication have independent
status, owner tokens, monotonic generations, lease timestamps, and attempt
counters. A worker finalizes only the delivery generation it owns, one
channel's activity cannot refresh the other's lease, a successful MCK callback
never suppresses a failed Mission Control publication, and exhausted MCK
retries never suppress a still-eligible Mission Control outcome. Each side
gets one initial attempt plus at most two repair attempts; exhaustion stays
degraded and operator-visible. A 2xx MCK response that rejects the lifecycle
transition records a failed delivery without advancing the correlation
mapping's current-stage/replay pointer. The plugin's `report-lifecycle` tool
can publish a governed blocked state. Do not invent a completion receipt to
repair state; reconcile the actual Paperclip run, validation, review, and
remote release evidence.

Lifecycle keys include company plus stable source event, issue, and run identity. Distinct
occurrences such as plan blocked, recovered, build blocked, or repeated
`needs_human` events therefore remain independent evidence. MCK reads callbacks
with a 1 MiB streaming limit plus independent total and inactivity deadlines;
declared and chunked oversize bodies fail before authentication.

The initial signed `started` callback to MCK is synchronous with dispatch
acceptance. Mission Control publication is intentionally left `pending` and is
sent by the reconciliation job through
`POST /api/webhooks/factory-runtime-outcomes`, using exact-body
`X-MC-Delivery-ID`, `X-MC-Timestamp`, and `X-MC-Signature` headers. This keeps a
slow Mission Control/GitHub apply off the MCK acceptance path. Any 2xx response
whose JSON explicitly contains `success:false` or `accepted:false` is treated
as a failed publication.

## Validation

Paperclip execution workspaces are disposable and do not inherit a checkout's
`node_modules`. Configure the project workspace provision command to run
`node scripts/prepare-factory-workspace.mjs` before the Builder or Validator
starts. The same exact argv is the first entry in `.agentic-factory.json`, so
an independently invoked deterministic Validator repairs a clean workspace as
well. The script installs both lockfiles with lifecycle scripts disabled and
rebuilds only the checked-in native `better-sqlite3` dependency for the host
runtime. A lockfile-, Node-, OS-, and architecture-bound marker under ignored
`node_modules` makes repeated setup and validation calls reuse the same
provision, while a short-lived lock prevents concurrent Windows `npm ci`
races. It never edits a package lockfile or executes model-generated shell.

Run the repository manifest in order or use the equivalent commands:

```powershell
npm run test:factory-webhooks
npm --prefix integrations/paperclip-bridge run typecheck
npm --prefix integrations/paperclip-bridge test
npm --prefix integrations/paperclip-bridge run build
npx tsc --noEmit --incremental false --pretty false
npm test
npm run lint
npm run build
```

The dedicated CI job repeats the plugin install, typecheck, tests, and build on
Node 24.18.0.
