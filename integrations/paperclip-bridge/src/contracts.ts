import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  factoryChangedPathsMatchScope,
  factoryPathValidationError,
} from "./factory-paths.js";

export const FACTORY_MCK_BASE_URL = "http://127.0.0.1:3021";
export const FACTORY_MCK_LIFECYCLE_URL = `${FACTORY_MCK_BASE_URL}/api/webhooks/agent-completion`;
export const FACTORY_MISSION_CONTROL_BASE_URL = "http://127.0.0.1:3001";
export const FACTORY_PAPERCLIP_BASE_URL = "http://127.0.0.1:5113";

export type LifecycleStatus =
  | "started"
  | "testing"
  | "review"
  | "completed"
  | "blocked"
  | "needs_human"
  | "failed"
  | "cancelled";

export const FACTORY_TASK_ENVELOPE_V1_SCHEMA_VERSION =
  "agent-settings.factory-task-envelope.v1" as const;
export const FACTORY_RUN_RECEIPT_V1_SCHEMA_VERSION =
  "agent-settings.factory-run-receipt.v1" as const;
export const FACTORY_RUN_RECEIPT_V2_SCHEMA_VERSION =
  "agent-settings.factory-run-receipt.v2" as const;

export interface CanonicalFactoryTaskEnvelopeV1 {
  schemaVersion: typeof FACTORY_TASK_ENVELOPE_V1_SCHEMA_VERSION;
  envelopeId: string;
  correlationId: string;
  createdAtUtc: string;
  origin: {
    source: "github-project" | "mck" | "manual" | "paperclip";
    taskId: string;
    attemptId: string;
    deliveryId: string;
    taskRevisionSha256: string;
    github: {
      owner: "iMelki";
      repository: string;
      issueNumber: number;
      projectNumber: number;
      projectItemId: string | null;
    };
  };
  repository: {
    path: string;
    slug: string;
    originRemote: string;
    branch: "dev";
    baseSha: string;
    allowedPaths: string[];
    preservedDirtyPaths?: string[];
  };
  work: {
    title: string;
    acceptanceCriteria: string[];
    testRequirements: string[];
    risk: "low" | "medium" | "high" | "critical";
    reviewMode: "independent" | "pair-review" | "human-final";
    rollback: {
      strategy: string;
      verification: string;
    };
  };
  execution: {
    capabilityProfile: string;
    maxRepairAttempts: number;
    timeoutSeconds: number;
    concurrentMutatingBuilders: 1;
    repositoryManifest: {
      path: ".agentic-factory.json";
      sha256: string;
    };
    callbacks: Array<{
      kind: "mck-lifecycle" | "mission-control-outcome" | "paperclip-event";
      url: string;
      localOnly: true;
      authenticationRef: string;
    }>;
  };
  privacy: {
    containsSecrets: false;
    containsDirectPersonalIdentifiers: false;
    rawPrivateLogsIncluded: false;
  };
}

export interface MckDispatchV2 {
  event: "mck.task.dispatch";
  version: 2;
  dispatch: {
    attempt_id: string;
    delivery_id: string;
    correlation_id: string;
    task_revision: string;
  };
  task: {
    id: string;
    title: string;
    description?: string;
    priority: "low" | "normal" | "high" | "urgent";
    github_source: {
      repo_owner: string;
      repo_name: string;
      issue_number: number;
      issue_url: string;
      project_item_id?: string;
    };
    dispatch_metadata?: Record<string, unknown>;
  };
  agent: {
    id: string;
    name: string;
    role: string;
    runtime_type: "webhook";
  };
  callbacks: {
    lifecycle: string;
    [key: string]: string;
  };
  callback_urls: {
    lifecycle: string;
    [key: string]: string;
  };
  mission_control_url: string;
  output_directory: string;
  prompt_markdown: string;
  issued_at: string;
  factory_contract: {
    schema_version: "factory-task-envelope.v1";
    envelope_id: string;
    repository: {
      slug: string;
      owner: string;
      name: string;
      active_branch: "dev";
      base_sha: string;
      allowed_file_scope: string[];
    };
    acceptance_criteria: string[];
    test_requirements: string[];
    risk_level: string;
    review_mode: string;
    impact: string;
    rollback_plan: string;
    safety_rules: string[];
    limits: {
      max_repair_attempts: 2;
      concurrent_mutating_builders: 1;
    };
    envelope: CanonicalFactoryTaskEnvelopeV1;
    envelope_sha256: string;
  };
}

export interface MckDispatchV1 {
  event: "mck.task.dispatch";
  version: 1;
  task: MckDispatchV2["task"];
  agent: MckDispatchV2["agent"];
  callbacks: Record<string, string>;
  callback_urls: Record<string, string>;
  mission_control_url: string;
  output_directory: string;
  prompt_markdown: string;
  issued_at: string;
}

export type MckDispatch = MckDispatchV1 | MckDispatchV2;

export interface FactoryReceipt {
  schemaVersion:
    | typeof FACTORY_RUN_RECEIPT_V1_SCHEMA_VERSION
    | typeof FACTORY_RUN_RECEIPT_V2_SCHEMA_VERSION;
  receiptId: string;
  envelopeId: string;
  correlationId: string;
  taskRevisionSha256: string;
  status: "succeeded";
  run: {
    builderAgentId: string;
    paperclipIssueId: string;
    paperclipRunId: string;
    workspaceId: string;
    roleProfile: string;
    profileManifestSha256: string;
    effectiveConfigSha256: string;
    toolInventorySha256: string;
    startedAtUtc: string;
    finishedAtUtc: string;
    durationMs: number;
    mutationIntent: "release";
  };
  repository: {
    slug: string;
    branch: "dev";
    baseSha: string;
    headBeforeReleaseSha: string;
    candidateSnapshotSha256: string;
    expectedIndexTreeSha?: string | null;
    expectedIndexEntries?: Array<{
      path: string;
      state: "present" | "deleted";
      mode: string | null;
      blobOid: string | null;
    }>;
    modeEvidence?: unknown[];
    finalSha: string;
    changedPaths: string[];
  };
  commands: Array<{
    id: string;
    stage: "validation" | "release";
    argv: string[];
    workingDirectory: string;
    startedAtUtc: string;
    finishedAtUtc: string;
    durationMs: number;
    status: "passed";
    exitCode: 0;
    stdoutSha256: string;
    stderrSha256: string;
  }>;
  tests: { total: number; passed: number; failed: 0; skipped: number };
  artifacts: Array<{ path: string; sha256: string; mediaType: string }>;
  metrics: {
    inputWorkItems: number;
    processedItems: number;
    changedItems: number;
    retryCount: number;
    deferralCount: number;
    errorCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
    billedCents: number | null;
    hostPressure: "unknown" | "normal" | "elevated" | "critical";
    backendLatencyMs: number | null;
    freshnessAtUtc: string;
    caller: string;
  };
  review: {
    reviewerId: string;
    reviewerRunId: string;
    roleProfile: "factory-independent-reviewer";
    profileManifestSha256: string;
    effectiveConfigSha256: string;
    toolInventorySha256: string;
    sessionProvenanceSha256?: string;
    decision: "accept";
    freshSession: true;
    builderSessionReused: false;
    reviewedAtUtc: string;
    evidenceSha256: string;
  };
  approvals: Array<{
    requestId: string;
    kind: "paperclip-approval" | "tool-gateway-action" | "request-confirmation" | "human-release";
    requiredForRelease: boolean;
    status: "pending" | "approved" | "rejected" | "expired";
    resolvedAtUtc: string | null;
  }>;
  release: {
    attempted: true;
    pushed: true;
    remoteRef: "refs/heads/dev";
    commitSha: string;
    remoteReadbackSha: string;
    remoteReadbackTreeSha?: string;
    startedAtUtc: string;
    finishedAtUtc: string;
    paperclipAgentId?: string;
    paperclipRunId?: string;
    roleProfile?: string;
    effectiveConfigSha256?: string;
    toolInventorySha256?: string;
  };
  publications: Array<{
    target: "mck" | "mission-control" | "github" | "github-project" | "paperclip";
    deliveryId: string;
    status: "pending" | "delivered" | "failed" | "skipped";
    publishedAtUtc: string | null;
  }>;
  reconciliation: {
    mck: string;
    paperclip: string;
    missionControl: string;
    githubProject: string;
    git: string;
  };
  privacy: {
    secretsIncluded: false;
    directContactOrPaymentIdentifiersIncluded: false;
    rawPrivateLogsIncluded: false;
    redactionApplied: boolean;
  };
  errors: string[];
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function headerValue(headers: Record<string, string | string[]>, name: string) {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return Array.isArray(match) ? match[0] : match;
}

export function verifyMckSignature(input: {
  rawBody: string;
  headers: Record<string, string | string[]>;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
  requireCanonicalDeliveryId?: boolean;
}) {
  const canonicalDeliveryId = headerValue(input.headers, "x-mck-delivery-id");
  const legacyDeliveryId = headerValue(input.headers, "x-mck-delivery");
  if (
    canonicalDeliveryId
    && legacyDeliveryId
    && canonicalDeliveryId !== legacyDeliveryId
  ) {
    return { ok: false as const, reason: "conflicting_delivery_id" };
  }
  const deliveryId = input.requireCanonicalDeliveryId
    ? canonicalDeliveryId
    : canonicalDeliveryId ?? legacyDeliveryId;
  const timestamp = headerValue(input.headers, "x-mck-timestamp");
  const signature = headerValue(input.headers, "x-mck-signature");
  if (!deliveryId) return { ok: false as const, reason: "missing_delivery_id" };
  if (!timestamp || !Number.isFinite(Number(timestamp))) return { ok: false as const, reason: "bad_timestamp" };
  if (!signature) return { ok: false as const, reason: "missing_signature" };
  if (!input.secret) return { ok: false as const, reason: "missing_secret" };
  const ageSeconds = Math.abs((input.nowMs ?? Date.now()) / 1000 - Number(timestamp));
  if (ageSeconds > (input.toleranceSeconds ?? 300)) return { ok: false as const, reason: "stale_timestamp" };
  const expected = `sha256=${createHmac("sha256", input.secret)
    .update(`${deliveryId}.${timestamp}.${input.rawBody}`, "utf8")
    .digest("hex")}`;
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return { ok: false as const, reason: "bad_signature" };
  }
  return { ok: true as const, deliveryId, timestamp, payloadHash: sha256(input.rawBody) };
}

export function signMckPayload(input: {
  rawBody: string;
  deliveryId: string;
  secret: string;
  timestamp?: number;
}) {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  return {
    "Content-Type": "application/json",
    "X-MCK-Delivery": input.deliveryId,
    "X-MCK-Delivery-ID": input.deliveryId,
    "X-MCK-Timestamp": timestamp,
    "X-MCK-Signature": `sha256=${createHmac("sha256", input.secret)
      .update(`${input.deliveryId}.${timestamp}.${input.rawBody}`, "utf8")
      .digest("hex")}`,
  };
}

export function signMissionControlOutcome(input: {
  rawBody: string;
  deliveryId: string;
  secret: string;
  timestamp?: number;
}) {
  if (Buffer.byteLength(input.secret, "utf8") < 32) {
    throw new Error("Mission Control outcome signing secret must contain at least 32 bytes");
  }
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  return {
    "Content-Type": "application/json",
    "X-MC-Delivery-ID": input.deliveryId,
    "X-MC-Timestamp": timestamp,
    "X-MC-Signature": `sha256=${createHmac("sha256", input.secret)
      .update(`${input.deliveryId}.${timestamp}.${input.rawBody}`, "utf8")
      .digest("hex")}`,
  };
}

export function assertSuccessfulPublication(input: {
  label: string;
  ok: boolean;
  status: number;
  rawBody: string;
}) {
  if (!input.ok) {
    throw new Error(`${input.label} returned HTTP ${input.status}`);
  }
  if (!input.rawBody.trim()) return;
  try {
    const parsed = JSON.parse(input.rawBody) as unknown;
    if (
      record(parsed)
      && (parsed.success === false || parsed.accepted === false)
    ) {
      throw new Error(
        `${input.label} returned ${parsed.success === false ? "success:false" : "accepted:false"}`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.endsWith("returned success:false")
        || error.message.endsWith("returned accepted:false")
      )
    ) {
      throw error;
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => text(item));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (record(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new Error("Canonical factory JSON value is not serializable");
  return serialized;
}

export function canonicalFactoryDigest(value: unknown) {
  return sha256(canonicalJson(value));
}

export function canonicalFactorySha256(value: unknown) {
  return `sha256:${canonicalFactoryDigest(value)}`;
}

function isUtc(value: unknown) {
  return text(value) && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

function isLocalCallbackUrl(value: unknown) {
  if (!text(value) || value.includes("\\") || /%(?:2f|5c|2e)/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:"
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
      && Boolean(parsed.port)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && !parsed.pathname.split("/").some((segment) => segment === "." || segment === "..");
  } catch {
    return false;
  }
}

export interface FactoryEnvelopeExpectation {
  attemptId: string;
  deliveryId: string;
  correlationId: string;
  taskRevision: string;
  taskId?: string;
  repositorySlug?: string;
  repositoryBaseSha?: string;
}

export function validateCanonicalFactoryTaskEnvelope(
  value: unknown,
  expected?: FactoryEnvelopeExpectation,
): CanonicalFactoryTaskEnvelopeV1 {
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
  const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
  const gitShaPattern = /^[a-f0-9]{40}$/;
  const repositoryPattern = /^iMelki\/[A-Za-z0-9._-]{1,100}$/;
  const remotePattern = /^(?:git@github\.com:iMelki\/|https:\/\/github\.com\/iMelki\/)[A-Za-z0-9._-]{1,100}(?:\.git)?$/;
  const authenticationRefPattern = /^[a-z][a-z0-9._:/-]{2,159}$/;
  const profilePattern = /^factory-[a-z0-9-]{2,64}$/;
  const exactKeys = (candidate: unknown, keys: readonly string[]): candidate is Record<string, unknown> => (
    record(candidate)
    && hasOnlyKeys(candidate, keys)
    && keys.every((key) => key in candidate)
  );
  const uniquePaths = (candidate: unknown, maximum: number, allowEmpty = false) => (
    Array.isArray(candidate)
    && (allowEmpty || candidate.length > 0)
    && candidate.length <= maximum
    && new Set(candidate).size === candidate.length
    && candidate.every((item) => factoryPathValidationError(item, "scope") === null)
  );

  if (!exactKeys(value, [
    "schemaVersion",
    "envelopeId",
    "correlationId",
    "createdAtUtc",
    "origin",
    "repository",
    "work",
    "execution",
    "privacy",
  ])) {
    throw new Error("Canonical factory task envelope top-level contract is invalid");
  }
  if (
    value.schemaVersion !== FACTORY_TASK_ENVELOPE_V1_SCHEMA_VERSION
    || !text(value.envelopeId)
    || !idPattern.test(value.envelopeId)
    || !text(value.correlationId)
    || !idPattern.test(value.correlationId)
    || !isUtc(value.createdAtUtc)
  ) {
    throw new Error("Canonical factory task envelope identity is invalid");
  }

  const origin = value.origin;
  const github = record(origin) ? origin.github : undefined;
  if (
    !exactKeys(origin, ["source", "taskId", "attemptId", "deliveryId", "taskRevisionSha256", "github"])
    || !["github-project", "mck", "manual", "paperclip"].includes(String(origin.source))
    || !text(origin.taskId)
    || !idPattern.test(origin.taskId)
    || !text(origin.attemptId)
    || !idPattern.test(origin.attemptId)
    || !text(origin.deliveryId)
    || !idPattern.test(origin.deliveryId)
    || !text(origin.taskRevisionSha256)
    || !sha256Pattern.test(origin.taskRevisionSha256)
    || !exactKeys(github, ["owner", "repository", "issueNumber", "projectNumber", "projectItemId"])
    || github.owner !== "iMelki"
    || typeof github.repository !== "string"
    || !/^[A-Za-z0-9._-]{1,100}$/.test(github.repository)
    || !Number.isInteger(github.issueNumber)
    || Number(github.issueNumber) < 1
    || !Number.isInteger(github.projectNumber)
    || Number(github.projectNumber) < 1
    || (github.projectItemId !== null && (!text(github.projectItemId) || github.projectItemId.length > 160))
  ) {
    throw new Error("Canonical factory task envelope origin is invalid");
  }

  const repository = value.repository;
  if (
    !record(repository)
    || !hasOnlyKeys(repository, [
      "path",
      "slug",
      "originRemote",
      "branch",
      "baseSha",
      "allowedPaths",
      "preservedDirtyPaths",
    ])
    || !["path", "slug", "originRemote", "branch", "baseSha", "allowedPaths"].every((key) => key in repository)
    || !text(repository.path)
    || repository.path.length < 3
    || repository.path.length > 1024
    || !text(repository.slug)
    || !repositoryPattern.test(repository.slug)
    || !text(repository.originRemote)
    || !remotePattern.test(repository.originRemote)
    || repository.branch !== "dev"
    || !text(repository.baseSha)
    || !gitShaPattern.test(repository.baseSha)
    || !uniquePaths(repository.allowedPaths, 512)
    || (
      repository.preservedDirtyPaths !== undefined
      && !uniquePaths(repository.preservedDirtyPaths, 128, true)
    )
  ) {
    throw new Error("Canonical factory task envelope repository is invalid");
  }

  const work = value.work;
  const rollback = record(work) ? work.rollback : undefined;
  const stringList = (candidate: unknown, minimumLength: number, maximumLength: number) => (
    Array.isArray(candidate)
    && candidate.length > 0
    && candidate.length <= 64
    && candidate.every((item) => text(item) && item.length >= minimumLength && item.length <= maximumLength)
  );
  if (
    !exactKeys(work, ["title", "acceptanceCriteria", "testRequirements", "risk", "reviewMode", "rollback"])
    || !text(work.title)
    || work.title.length < 8
    || work.title.length > 240
    || !stringList(work.acceptanceCriteria, 8, 1_000)
    || !stringList(work.testRequirements, 3, 500)
    || !["low", "medium", "high", "critical"].includes(String(work.risk))
    || !["independent", "pair-review", "human-final"].includes(String(work.reviewMode))
    || !exactKeys(rollback, ["strategy", "verification"])
    || !text(rollback.strategy)
    || rollback.strategy.length < 8
    || rollback.strategy.length > 1_000
    || !text(rollback.verification)
    || rollback.verification.length < 8
    || rollback.verification.length > 1_000
  ) {
    throw new Error("Canonical factory task envelope work contract is invalid");
  }

  const execution = value.execution;
  const manifest = record(execution) ? execution.repositoryManifest : undefined;
  if (
    !exactKeys(execution, [
      "capabilityProfile",
      "maxRepairAttempts",
      "timeoutSeconds",
      "concurrentMutatingBuilders",
      "repositoryManifest",
      "callbacks",
    ])
    || !text(execution.capabilityProfile)
    || !profilePattern.test(execution.capabilityProfile)
    || !Number.isInteger(execution.maxRepairAttempts)
    || Number(execution.maxRepairAttempts) < 0
    || Number(execution.maxRepairAttempts) > 2
    || !Number.isInteger(execution.timeoutSeconds)
    || Number(execution.timeoutSeconds) < 60
    || Number(execution.timeoutSeconds) > 86_400
    || execution.concurrentMutatingBuilders !== 1
    || !exactKeys(manifest, ["path", "sha256"])
    || manifest.path !== ".agentic-factory.json"
    || !text(manifest.sha256)
    || !sha256Pattern.test(manifest.sha256)
    || !Array.isArray(execution.callbacks)
    || execution.callbacks.length < 1
    || execution.callbacks.length > 8
    || execution.callbacks.some((callback) => (
      !exactKeys(callback, ["kind", "url", "localOnly", "authenticationRef"])
      || !["mck-lifecycle", "mission-control-outcome", "paperclip-event"].includes(String(callback.kind))
      || !isLocalCallbackUrl(callback.url)
      || callback.localOnly !== true
      || !text(callback.authenticationRef)
      || !authenticationRefPattern.test(callback.authenticationRef)
    ))
  ) {
    throw new Error("Canonical factory task envelope execution contract is invalid");
  }

  const privacy = value.privacy;
  if (
    !exactKeys(privacy, ["containsSecrets", "containsDirectPersonalIdentifiers", "rawPrivateLogsIncluded"])
    || privacy.containsSecrets !== false
    || privacy.containsDirectPersonalIdentifiers !== false
    || privacy.rawPrivateLogsIncluded !== false
  ) {
    throw new Error("Canonical factory task envelope privacy boundary is invalid");
  }

  if (expected && (
    origin.attemptId !== expected.attemptId
    || origin.deliveryId !== expected.deliveryId
    || value.correlationId !== expected.correlationId
    || origin.taskRevisionSha256 !== `sha256:${expected.taskRevision}`
    || (expected.taskId !== undefined && origin.taskId !== expected.taskId)
    || (expected.repositorySlug !== undefined && repository.slug !== expected.repositorySlug)
    || (expected.repositoryBaseSha !== undefined && repository.baseSha !== expected.repositoryBaseSha)
  )) {
    throw new Error("Canonical factory task envelope does not match its dispatch identity");
  }

  return value as unknown as CanonicalFactoryTaskEnvelopeV1;
}

export function assertCorrelationRevision(
  existing: { task_revision: string } | null,
  incomingTaskRevision: string,
) {
  if (existing && existing.task_revision !== incomingTaskRevision) {
    throw new Error("task_revision_conflict");
  }
}

export function parseDispatch(value: unknown, allowedOwner = "iMelki"): MckDispatch {
  if (!record(value) || value.event !== "mck.task.dispatch" || (value.version !== 1 && value.version !== 2)) {
    throw new Error("Unsupported MCK dispatch payload");
  }
  if (!record(value.task) || !text(value.task.id) || !text(value.task.title)) {
    throw new Error("Dispatch task identity is incomplete");
  }
  const source = value.task.github_source;
  if (!record(source) || source.repo_owner !== allowedOwner || !text(source.repo_name)) {
    throw new Error(`Dispatch repository owner must be ${allowedOwner}`);
  }
  if (!Number.isInteger(source.issue_number) || Number(source.issue_number) < 1 || !text(source.issue_url)) {
    throw new Error("Dispatch GitHub issue identity is incomplete");
  }
  let issueUrl: URL;
  try {
    issueUrl = new URL(source.issue_url);
  } catch {
    throw new Error("Dispatch GitHub issue URL is invalid");
  }
  const expectedIssuePath = `/${allowedOwner}/${source.repo_name}/issues/${source.issue_number}`;
  if (
    issueUrl.protocol !== "https:"
    || issueUrl.hostname.toLowerCase() !== "github.com"
    || issueUrl.port
    || issueUrl.username
    || issueUrl.password
    || issueUrl.search
    || issueUrl.hash
    || issueUrl.pathname !== expectedIssuePath
  ) {
    throw new Error("Dispatch GitHub issue URL does not match the owned repository identity");
  }
  if (value.version === 2) {
    if (!record(value.dispatch)) throw new Error("Dispatch v2 identity is required");
    for (const key of ["attempt_id", "delivery_id", "correlation_id", "task_revision"]) {
      if (!text(value.dispatch[key])) throw new Error(`dispatch.${key} is required`);
    }
    if (!/^[a-f0-9]{64}$/.test(String(value.dispatch.task_revision))) {
      throw new Error("dispatch.task_revision must be a SHA-256 digest");
    }
    if (!record(value.agent) || value.agent.runtime_type !== "webhook") {
      throw new Error("Dispatch v2 requires a webhook agent");
    }
    if (
      !record(value.callbacks)
      || !text(value.callbacks.lifecycle)
      || !record(value.callback_urls)
      || !text(value.callback_urls.lifecycle)
    ) {
      throw new Error("Dispatch v2 lifecycle callback is required");
    }
    if (
      value.callbacks.lifecycle !== value.callback_urls.lifecycle
      || value.callbacks.lifecycle !== FACTORY_MCK_LIFECYCLE_URL
      || value.mission_control_url !== FACTORY_MCK_BASE_URL
    ) {
      throw new Error("Dispatch v2 loopback callback identity is not allowed");
    }
    const contract = value.factory_contract;
    if (!record(contract)) {
      throw new Error("Factory contract repository is required");
    }
    const repository = contract.repository;
    if (!record(repository)) {
      throw new Error("Factory contract repository is required");
    }
    const legacyAllowedPaths = Array.isArray(repository.allowed_file_scope)
      ? repository.allowed_file_scope
      : [];
    if (
      contract.schema_version !== "factory-task-envelope.v1"
      || !text(contract.envelope_id)
      || contract.envelope_id !== `factory:${String(value.dispatch.attempt_id)}`
      || repository.owner !== allowedOwner
      || !text(repository.name)
      || repository.name !== source.repo_name
      || repository.active_branch !== "dev"
      || typeof repository.base_sha !== "string"
      || !/^[a-f0-9]{40}$/.test(repository.base_sha)
      || repository.slug !== `${repository.owner}/${repository.name}`
    ) {
      throw new Error("Factory contract repository identity is not allowed");
    }
    const envelope = validateCanonicalFactoryTaskEnvelope(contract.envelope, {
      attemptId: String(value.dispatch.attempt_id),
      deliveryId: String(value.dispatch.delivery_id),
      correlationId: String(value.dispatch.correlation_id),
      taskRevision: String(value.dispatch.task_revision),
      taskId: String(value.task.id),
      repositorySlug: String(repository.slug),
      repositoryBaseSha: String(repository.base_sha),
    });
    const sameStringArray = (left: unknown, right: string[]) => (
      Array.isArray(left)
      && left.length === right.length
      && left.every((item, index) => item === right[index])
    );
    const canonicalReviewMode = contract.review_mode === "pair_review"
      ? "pair-review"
      : contract.review_mode === "human_required"
        ? "human-final"
        : "independent";
    if (
      contract.envelope_id !== envelope.envelopeId
      || !text(contract.envelope_sha256)
      || contract.envelope_sha256 !== canonicalFactorySha256(envelope)
      || envelope.origin.github.repository !== source.repo_name
      || envelope.origin.github.issueNumber !== source.issue_number
      || envelope.origin.github.projectItemId !== (source.project_item_id ?? null)
      || !sameStringArray(legacyAllowedPaths, envelope.repository.allowedPaths)
      || !sameStringArray(contract.acceptance_criteria, envelope.work.acceptanceCriteria)
      || !sameStringArray(contract.test_requirements, envelope.work.testRequirements)
      || contract.risk_level !== envelope.work.risk
      || canonicalReviewMode !== envelope.work.reviewMode
      || contract.rollback_plan !== envelope.work.rollback.strategy
      || !record(contract.limits)
      || contract.limits.max_repair_attempts !== envelope.execution.maxRepairAttempts
      || contract.limits.concurrent_mutating_builders !== envelope.execution.concurrentMutatingBuilders
    ) {
      throw new Error("Factory contract aliases do not match the canonical envelope readback");
    }
    if (
      !nonEmptyStringArray(repository.allowed_file_scope)
      || repository.allowed_file_scope.some(
        (scope) => factoryPathValidationError(scope, "scope") !== null,
      )
      || !nonEmptyStringArray(contract.acceptance_criteria)
      || !nonEmptyStringArray(contract.test_requirements)
      || !text(contract.impact)
      || !text(contract.rollback_plan)
      || !Array.isArray(contract.safety_rules)
      || !contract.safety_rules.every((item) => text(item))
      || !["low", "medium", "high", "critical"].includes(String(contract.risk_level))
      || !["human_required", "auto_checks_only", "pair_review"].includes(String(contract.review_mode))
      || !record(contract.limits)
      || contract.limits.max_repair_attempts !== 2
      || contract.limits.concurrent_mutating_builders !== 1
    ) {
      throw new Error("Factory dispatch contract is incomplete");
    }
  }
  return value as unknown as MckDispatch;
}

export function validateReceipt(
  value: unknown,
  expected?: {
    envelopeId: string;
    correlationId: string;
    taskRevision: string;
    repositorySlug: string;
    repositoryBaseSha: string;
    allowedFileScope?: string[];
    requireAuthoritativeCompletion?: boolean;
  },
): FactoryReceipt {
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
  const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
  const gitShaPattern = /^[a-f0-9]{40}$/;
  const isUtc = (candidate: unknown) => (
    text(candidate)
    && candidate.endsWith("Z")
    && Number.isFinite(Date.parse(candidate))
  );
  const isNonNegativeInteger = (candidate: unknown) => (
    Number.isInteger(candidate)
    && Number(candidate) >= 0
  );
  const isV2 = record(value) && value.schemaVersion === FACTORY_RUN_RECEIPT_V2_SCHEMA_VERSION;
  if (
    !record(value)
    || !hasOnlyKeys(value, [
      "schemaVersion",
      "receiptId",
      "envelopeId",
      "correlationId",
      "taskRevisionSha256",
      "status",
      "run",
      "repository",
      "commands",
      "tests",
      "artifacts",
      "metrics",
      "review",
      "approvals",
      "release",
      "publications",
      "reconciliation",
      "privacy",
      "errors",
    ])
    || (
      value.schemaVersion !== FACTORY_RUN_RECEIPT_V1_SCHEMA_VERSION
      && value.schemaVersion !== FACTORY_RUN_RECEIPT_V2_SCHEMA_VERSION
    )
    || !text(value.receiptId)
    || !idPattern.test(value.receiptId)
    || !text(value.envelopeId)
    || !idPattern.test(value.envelopeId)
    || value.status !== "succeeded"
  ) {
    throw new Error("Factory receipt identity is invalid");
  }
  if (expected?.requireAuthoritativeCompletion && !isV2) {
    throw new Error("factory-run-receipt v1 is compatibility-read-only; completion requires v2 release authority");
  }
  if (
    !text(value.correlationId)
    || !idPattern.test(value.correlationId)
    || !text(value.taskRevisionSha256)
    || !sha256Pattern.test(value.taskRevisionSha256)
    || (
      expected
      && (
        value.envelopeId !== expected.envelopeId
        ||
        value.correlationId !== expected.correlationId
        || value.taskRevisionSha256 !== `sha256:${expected.taskRevision}`
      )
    )
  ) {
    throw new Error("Factory receipt does not match the accepted correlation and task revision");
  }
  if (
    !record(value.run)
    || !hasOnlyKeys(value.run, [
      "builderAgentId",
      "paperclipIssueId",
      "paperclipRunId",
      "workspaceId",
      "roleProfile",
      "profileManifestSha256",
      "effectiveConfigSha256",
      "toolInventorySha256",
      "startedAtUtc",
      "finishedAtUtc",
      "durationMs",
      "mutationIntent",
    ])
    || !text(value.run.builderAgentId)
    || !idPattern.test(value.run.builderAgentId)
    || !text(value.run.paperclipIssueId)
    || !idPattern.test(value.run.paperclipIssueId)
    || !text(value.run.paperclipRunId)
    || !idPattern.test(value.run.paperclipRunId)
    || !text(value.run.workspaceId)
    || !idPattern.test(value.run.workspaceId)
    || !text(value.run.roleProfile)
    || !/^factory-[a-z0-9-]{2,64}$/.test(value.run.roleProfile)
    || !text(value.run.profileManifestSha256)
    || !sha256Pattern.test(value.run.profileManifestSha256)
    || !text(value.run.effectiveConfigSha256)
    || !sha256Pattern.test(value.run.effectiveConfigSha256)
    || !text(value.run.toolInventorySha256)
    || !sha256Pattern.test(value.run.toolInventorySha256)
    || !isUtc(value.run.startedAtUtc)
    || !isUtc(value.run.finishedAtUtc)
    || !isNonNegativeInteger(value.run.durationMs)
    || value.run.mutationIntent !== "release"
  ) {
    throw new Error("Factory receipt does not prove its Paperclip run and effective capability identity");
  }
  if (
    !record(value.repository)
    || !hasOnlyKeys(value.repository, [
      "slug",
      "branch",
      "baseSha",
      "headBeforeReleaseSha",
      "candidateSnapshotSha256",
      "expectedIndexTreeSha",
      "expectedIndexEntries",
      "modeEvidence",
      "finalSha",
      "changedPaths",
    ])
    || !text(value.repository.slug)
    || !/^iMelki\/[A-Za-z0-9._-]{1,100}$/.test(value.repository.slug)
    || value.repository.branch !== "dev"
    || !text(value.repository.baseSha)
    || !gitShaPattern.test(value.repository.baseSha)
    || !text(value.repository.headBeforeReleaseSha)
    || !gitShaPattern.test(value.repository.headBeforeReleaseSha)
    || !text(value.repository.candidateSnapshotSha256)
    || !sha256Pattern.test(value.repository.candidateSnapshotSha256)
    || (
      value.repository.expectedIndexTreeSha !== undefined
      && value.repository.expectedIndexTreeSha !== null
      && (
        !text(value.repository.expectedIndexTreeSha)
        || !gitShaPattern.test(value.repository.expectedIndexTreeSha)
      )
    )
    || (
      isV2
      && (
        !text(value.repository.expectedIndexTreeSha)
        || !gitShaPattern.test(value.repository.expectedIndexTreeSha)
        || !Array.isArray(value.repository.expectedIndexEntries)
        || value.repository.expectedIndexEntries.length === 0
        || !Array.isArray(value.repository.modeEvidence)
      )
    )
    || (
      value.repository.expectedIndexEntries !== undefined
      && (
        !Array.isArray(value.repository.expectedIndexEntries)
        || value.repository.expectedIndexEntries.length > 512
        || value.repository.expectedIndexEntries.some((entry) => (
          !record(entry)
          || !hasOnlyKeys(entry, ["path", "state", "mode", "blobOid"])
          || factoryPathValidationError(entry.path, "changed") !== null
          || !["present", "deleted"].includes(String(entry.state))
          || (
            entry.state === "present"
            && (
              typeof entry.mode !== "string"
              || !/^[0-7]{6}$/.test(entry.mode)
              || typeof entry.blobOid !== "string"
              || !gitShaPattern.test(entry.blobOid)
            )
          )
          || (
            entry.state === "deleted"
            && (entry.mode !== null || entry.blobOid !== null)
          )
        ))
      )
    )
    || !text(value.repository.finalSha)
    || !gitShaPattern.test(value.repository.finalSha)
    || !Array.isArray(value.repository.changedPaths)
    || value.repository.changedPaths.length === 0
    || value.repository.changedPaths.length > 512
    || new Set(value.repository.changedPaths).size !== value.repository.changedPaths.length
    || value.repository.changedPaths.some((path) => (
      factoryPathValidationError(path, "changed") !== null
    ))
  ) {
    throw new Error("Factory receipt does not prove an owned dev candidate snapshot");
  }
  if (
    expected
    && (
      value.repository.slug !== expected.repositorySlug
      || value.repository.baseSha !== expected.repositoryBaseSha
      || (
        expected.allowedFileScope
        && !factoryChangedPathsMatchScope(
          value.repository.changedPaths as string[],
          expected.allowedFileScope,
        )
      )
    )
  ) {
    throw new Error("Factory receipt repository does not match the accepted factory contract");
  }
  if (
    !Array.isArray(value.commands)
    || value.commands.length === 0
    || value.commands.length > 256
    || !value.commands.some((command) => record(command) && command.stage === "validation")
    || (!isV2 && !value.commands.some((command) => record(command) && command.stage === "release"))
    || value.commands.some((command) => (
      !record(command)
      || !hasOnlyKeys(command, [
        "id",
        "stage",
        "argv",
        "workingDirectory",
        "startedAtUtc",
        "finishedAtUtc",
        "durationMs",
        "status",
        "exitCode",
        "stdoutSha256",
        "stderrSha256",
      ])
      || !text(command.id)
      || !idPattern.test(command.id)
      || !["validation", "release"].includes(String(command.stage))
      || !Array.isArray(command.argv)
      || command.argv.length === 0
      || command.argv.length > 128
      || command.argv.some((argument) => typeof argument !== "string" || argument.length > 4096)
      || !text(command.workingDirectory)
      || command.workingDirectory.length > 1024
      || !isUtc(command.startedAtUtc)
      || !isUtc(command.finishedAtUtc)
      || !isNonNegativeInteger(command.durationMs)
      || command.status !== "passed"
      || command.exitCode !== 0
      || !text(command.stdoutSha256)
      || !sha256Pattern.test(command.stdoutSha256)
      || !text(command.stderrSha256)
      || !sha256Pattern.test(command.stderrSha256)
    ))
    || !record(value.tests)
    || !hasOnlyKeys(value.tests, ["total", "passed", "failed", "skipped"])
    || !isNonNegativeInteger(value.tests.total)
    || Number(value.tests.total) < 1
    || !isNonNegativeInteger(value.tests.passed)
    || Number(value.tests.passed) < 1
    || value.tests.failed !== 0
    || !isNonNegativeInteger(value.tests.skipped)
    || value.tests.total !== Number(value.tests.passed) + Number(value.tests.skipped)
  ) {
    throw new Error("Factory receipt does not prove deterministic validation");
  }
  if (
    !Array.isArray(value.artifacts)
    || value.artifacts.length > 256
    || value.artifacts.some((artifact) => (
      !record(artifact)
      || !hasOnlyKeys(artifact, ["path", "sha256", "mediaType"])
      || !text(artifact.path)
      || artifact.path.length > 1024
      || !text(artifact.sha256)
      || !sha256Pattern.test(artifact.sha256)
      || !text(artifact.mediaType)
      || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(artifact.mediaType)
    ))
  ) {
    throw new Error("Factory receipt artifacts are invalid");
  }
  if (
    !record(value.metrics)
    || !hasOnlyKeys(value.metrics, [
      "inputWorkItems",
      "processedItems",
      "changedItems",
      "retryCount",
      "deferralCount",
      "errorCount",
      "inputTokens",
      "outputTokens",
      "billedCents",
      "hostPressure",
      "backendLatencyMs",
      "freshnessAtUtc",
      "caller",
    ])
    || !isNonNegativeInteger(value.metrics.inputWorkItems)
    || !isNonNegativeInteger(value.metrics.processedItems)
    || !isNonNegativeInteger(value.metrics.changedItems)
    || !isNonNegativeInteger(value.metrics.retryCount)
    || Number(value.metrics.retryCount) > 2
    || !isNonNegativeInteger(value.metrics.deferralCount)
    || value.metrics.errorCount !== 0
    || (value.metrics.inputTokens !== null && !isNonNegativeInteger(value.metrics.inputTokens))
    || (value.metrics.outputTokens !== null && !isNonNegativeInteger(value.metrics.outputTokens))
    || (value.metrics.billedCents !== null && !isNonNegativeInteger(value.metrics.billedCents))
    || !["unknown", "normal", "elevated", "critical"].includes(String(value.metrics.hostPressure))
    || (value.metrics.backendLatencyMs !== null && !isNonNegativeInteger(value.metrics.backendLatencyMs))
    || !isUtc(value.metrics.freshnessAtUtc)
    || !text(value.metrics.caller)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value.metrics.caller)
  ) {
    throw new Error("Factory receipt run metrics are invalid");
  }
  if (
    !record(value.review)
    || !hasOnlyKeys(value.review, [
      "reviewerId",
      "reviewerRunId",
      "roleProfile",
      "profileManifestSha256",
      "effectiveConfigSha256",
      "toolInventorySha256",
      "sessionProvenanceSha256",
      "decision",
      "freshSession",
      "builderSessionReused",
      "reviewedAtUtc",
      "evidenceSha256",
    ])
    || value.review.decision !== "accept"
    || value.review.freshSession !== true
    || value.review.builderSessionReused !== false
    || !text(value.review.reviewerId)
    || !idPattern.test(value.review.reviewerId)
    || !text(value.review.reviewerRunId)
    || !idPattern.test(value.review.reviewerRunId)
    || value.review.roleProfile !== "factory-independent-reviewer"
    || !text(value.review.profileManifestSha256)
    || !sha256Pattern.test(value.review.profileManifestSha256)
    || !text(value.review.effectiveConfigSha256)
    || !sha256Pattern.test(value.review.effectiveConfigSha256)
    || !text(value.review.toolInventorySha256)
    || !sha256Pattern.test(value.review.toolInventorySha256)
    || (
      isV2
      && (
        !text(value.review.sessionProvenanceSha256)
        || !sha256Pattern.test(value.review.sessionProvenanceSha256)
      )
    )
    || !isUtc(value.review.reviewedAtUtc)
    || !text(value.review.evidenceSha256)
    || !sha256Pattern.test(value.review.evidenceSha256)
  ) {
    throw new Error("Factory receipt does not prove independent accepted review");
  }
  if (
    !Array.isArray(value.approvals)
    || value.approvals.length > 64
    || value.approvals.some((approval) => (
      !record(approval)
      || !hasOnlyKeys(approval, [
        "requestId",
        "kind",
        "requiredForRelease",
        "status",
        "resolvedAtUtc",
      ])
      || !text(approval.requestId)
      || !idPattern.test(approval.requestId)
      || !["paperclip-approval", "tool-gateway-action", "request-confirmation", "human-release"].includes(String(approval.kind))
      || typeof approval.requiredForRelease !== "boolean"
      || !["pending", "approved", "rejected", "expired"].includes(String(approval.status))
      || (approval.resolvedAtUtc !== null && !isUtc(approval.resolvedAtUtc))
      || (
        approval.requiredForRelease === true
        && (approval.status !== "approved" || !isUtc(approval.resolvedAtUtc))
      )
    ))
  ) {
    throw new Error("Factory receipt approval evidence is invalid");
  }
  if (
    !record(value.release)
    || !hasOnlyKeys(value.release, [
      "attempted",
      "pushed",
      "remoteRef",
      "commitSha",
      "remoteReadbackSha",
      "remoteReadbackTreeSha",
      "startedAtUtc",
      "finishedAtUtc",
      "paperclipAgentId",
      "paperclipRunId",
      "roleProfile",
      "effectiveConfigSha256",
      "toolInventorySha256",
    ])
    || value.release.attempted !== true
    || value.release.pushed !== true
    || value.release.remoteRef !== "refs/heads/dev"
    || !text(value.release.commitSha)
    || !gitShaPattern.test(value.release.commitSha)
    || value.release.remoteReadbackSha !== value.release.commitSha
    || value.repository.finalSha !== value.release.commitSha
    || (
      isV2
      && (
        !text(value.release.remoteReadbackTreeSha)
        || !gitShaPattern.test(value.release.remoteReadbackTreeSha)
        || !text(value.release.paperclipAgentId)
        || !idPattern.test(value.release.paperclipAgentId)
        || !text(value.release.paperclipRunId)
        || !idPattern.test(value.release.paperclipRunId)
        || value.release.roleProfile !== "factory-integrator-release-steward"
        || !text(value.release.effectiveConfigSha256)
        || !sha256Pattern.test(value.release.effectiveConfigSha256)
        || !text(value.release.toolInventorySha256)
        || !sha256Pattern.test(value.release.toolInventorySha256)
      )
    )
    || !isUtc(value.release.startedAtUtc)
    || !isUtc(value.release.finishedAtUtc)
  ) {
    throw new Error("Factory receipt does not prove pushed origin/dev remote readback");
  }
  const reconciliationStates = new Set(["not_attempted", "pending", "matched", "drifted", "failed"]);
  const reconciliation = record(value.reconciliation) ? value.reconciliation : null;
  if (
    !Array.isArray(value.publications)
    || value.publications.length > 64
    || value.publications.some((publication) => (
      !record(publication)
      || !hasOnlyKeys(publication, ["target", "deliveryId", "status", "publishedAtUtc"])
      || !["mck", "mission-control", "github", "github-project", "paperclip"].includes(String(publication.target))
      || !text(publication.deliveryId)
      || !idPattern.test(publication.deliveryId)
      || !["pending", "delivered", "failed", "skipped"].includes(String(publication.status))
      || (publication.publishedAtUtc !== null && !isUtc(publication.publishedAtUtc))
    ))
    || !reconciliation
    || !hasOnlyKeys(reconciliation, ["mck", "paperclip", "missionControl", "githubProject", "git"])
    || !["mck", "paperclip", "missionControl", "githubProject", "git"].every(
      (key) => reconciliationStates.has(String(reconciliation?.[key])),
    )
    || reconciliation?.paperclip !== "matched"
    || reconciliation?.git !== "matched"
  ) {
    throw new Error("Factory receipt publication and reconciliation evidence is invalid");
  }
  if (
    !record(value.privacy)
    || !hasOnlyKeys(value.privacy, [
      "secretsIncluded",
      "directContactOrPaymentIdentifiersIncluded",
      "rawPrivateLogsIncluded",
      "redactionApplied",
    ])
    || value.privacy.secretsIncluded !== false
    || value.privacy.directContactOrPaymentIdentifiersIncluded !== false
    || value.privacy.rawPrivateLogsIncluded !== false
    || typeof value.privacy.redactionApplied !== "boolean"
    || !Array.isArray(value.errors)
    || value.errors.length !== 0
  ) {
    throw new Error("Factory receipt privacy boundary is not proven");
  }
  return value as unknown as FactoryReceipt;
}

export type FactoryReceiptAuthority =
  | "v1-legacy-compatibility"
  | "v2-release-authority";

export interface FactoryReceiptAuthorityProjection {
  schemaVersion: string;
  authority: FactoryReceiptAuthority;
  receiptId: string;
  status: string;
  canonicalSha256: string;
  validationSucceeded: boolean;
  independentReviewAccepted: boolean;
  remoteCommitReadbackVerified: boolean;
  privacyVerified: boolean;
}

export function projectFactoryReceiptAuthority(receipt: FactoryReceipt): FactoryReceiptAuthorityProjection {
  const authoritative = receipt.schemaVersion === FACTORY_RUN_RECEIPT_V2_SCHEMA_VERSION;
  return {
    schemaVersion: receipt.schemaVersion,
    authority: authoritative ? "v2-release-authority" : "v1-legacy-compatibility",
    receiptId: receipt.receiptId,
    status: receipt.status,
    canonicalSha256: canonicalFactoryDigest(receipt),
    validationSucceeded: authoritative,
    independentReviewAccepted: authoritative,
    remoteCommitReadbackVerified: authoritative,
    privacyVerified: authoritative,
  };
}

export function redactDiagnostic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnostic);
  if (!record(value)) {
    if (typeof value !== "string") return value;
    return redactDiagnosticString(value);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (/authorization|token|secret|password|signature|hmac|api[_-]?key/i.test(key)) {
      return [key, "[redacted]"];
    }
    return [key, redactDiagnostic(child)];
  }));
}

const EMBEDDED_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const BEARER_PATTERN = /\bBearer\s+[^\s,;)]*/gi;
const HMAC_PATTERN = /\b((?:sha(?:1|224|256|384|512)|hmac(?:[-_](?:sha)?(?:1|224|256|384|512)?)|signature))\s*[:=]\s*[^\s,;)]*/gi;
const SECRET_ASSIGNMENT_PATTERN = /\b((?:api[ _-]?key|access[ _-]?key|client[ _-]?secret|auth(?:entication)?[ _-]?token|secret|password))\s*([:=])\s*[^\s,;&)]+/gi;
const API_KEY_PATTERN = /\b(?:sk_(?:live|test)_|pk_(?:live|test)_|gh[opsu]_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_\-]+/g;

function redactEmbeddedUrl(input: string) {
  return input.replace(EMBEDDED_URL_PATTERN, (candidate) => {
    // Keep punctuation outside the URL so diagnostics remain readable while
    // ensuring credentials, query strings, and fragments never survive.
    const trailing = candidate.match(/[.,!?;:)\]}]+$/)?.[0] ?? "";
    const urlText = trailing ? candidate.slice(0, -trailing.length) : candidate;
    try {
      const url = new URL(urlText);
      return `${url.protocol}//${url.host}${url.pathname}${trailing}`;
    } catch {
      const withoutQueryOrFragment = urlText.replace(/[?#].*$/, "");
      const withoutUserInfo = withoutQueryOrFragment.replace(
        /^(https?:\/\/)[^/?#\s]*@/i,
        "$1[redacted]@",
      );
      return `${withoutUserInfo}${trailing}`;
    }
  });
}

function redactDiagnosticString(input: string) {
  let redacted = redactEmbeddedUrl(input);
  redacted = redacted.replace(BEARER_PATTERN, "Bearer [redacted]");
  redacted = redacted.replace(HMAC_PATTERN, "$1=[redacted]");
  redacted = redacted.replace(SECRET_ASSIGNMENT_PATTERN, "$1$2[redacted]");
  redacted = redacted.replace(API_KEY_PATTERN, "[redacted]");
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}
