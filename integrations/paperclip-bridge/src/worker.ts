import { randomUUID } from "node:crypto";
import {
  definePlugin,
  runWorker,
  type PluginContext,
  type PluginEvent,
  type PluginWebhookInput,
  type ToolResult,
  type EnvSecretRefBinding,
} from "@paperclipai/plugin-sdk";
import {
  JOB_RECONCILE_LIFECYCLE,
  MAX_LIFECYCLE_DELIVERY_ATTEMPTS,
  ORIGIN_KIND,
  PLUGIN_ID,
  STAGE_KEYS,
  TOOL_REPORT_LIFECYCLE,
  WEBHOOK_ENDPOINT,
  type StageKey,
} from "./constants.js";
import {
  assertCorrelationRevision,
  assertSuccessfulPublication,
  FACTORY_MCK_LIFECYCLE_URL,
  FACTORY_MISSION_CONTROL_BASE_URL,
  FACTORY_PAPERCLIP_BASE_URL,
  parseDispatch,
  redactDiagnostic,
  sha256,
  signMissionControlOutcome,
  signMckPayload,
  validateReceipt,
  verifyMckSignature,
  type FactoryReceipt,
  type LifecycleStatus,
  type MckDispatch,
} from "./contracts.js";
import {
  canonicalJson,
  canonicalSha256,
  assertEvidenceRevisionRun,
  parseEvidenceDocument,
  parseFactoryReleaseEvidence,
  parseFactoryValidationEvidence,
  type FactoryReleaseEvidence,
  type FactoryValidationEvidence,
  type LatestEvidenceRevision,
} from "./evidence.js";
import { buildStageDefinitions } from "./graph.js";
import { scopedHostFetch } from "./host-http.js";

export interface BridgeConfig {
  companyId: string;
  projectId: string;
  allowedRepositoryOwner: string;
  dispatchSecretRef: EnvSecretRefBinding;
  callbackSecretRef: EnvSecretRefBinding;
  missionControlOutcomeSecretRef: EnvSecretRefBinding;
  missionControlBaseUrl?: string;
  githubSyncMode: "apply" | "disabled";
  directorAgentId: string;
  builderAgentId: string;
  validatorAgentId: string;
  reviewerAgentId: string;
  integratorAgentId: string;
}

export interface BridgeMapping {
  company_id: string;
  correlation_id: string;
  mck_task_id: string;
  attempt_id: string;
  dispatch_version: number;
  task_revision: string;
  github_issue_url: string;
  callback_url: string | null;
  envelope: MckDispatch | string;
  parent_issue_id: string | null;
  plan_issue_id: string | null;
  build_issue_id: string | null;
  validate_issue_id: string | null;
  review_issue_id: string | null;
  release_issue_id: string | null;
  intake_status: "processing" | "accepted" | "failed";
  lifecycle_status: string | null;
  receipt_id: string | null;
  last_error: string | null;
  intake_generation: number;
  intake_owner_token: string | null;
  intake_lease_started_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GraphIds {
  parent: string;
  plan: string;
  build: string;
  validate: string;
  review: string;
  release: string;
}

interface OwnerFence {
  ownerToken: string;
  generation: number;
}

interface LifecycleDelivery {
  companyId: string;
  deliveryKey: string;
  correlationId: string;
  deliveryId: string;
  callbackUrl: string;
  payload: Record<string, unknown>;
  rawBody: string;
  payloadHash: string;
  status: string;
  attemptCount: number;
  mckLeaseGeneration: number;
  outcomeDeliveryId: string | null;
  outcomeUrl: string | null;
  outcomeRawBody: string | null;
  outcomePayloadHash: string | null;
  outcomeStatus: string;
  outcomeAttemptCount: number;
  outcomeLeaseGeneration: number;
}

let currentContext: PluginContext | null = null;
const configuredCompanyIds = new Set<string>();

function table(ctx: PluginContext, name: string) {
  return `${ctx.db.namespace}.${name}`;
}

function nonEmpty(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function secretRef(value: unknown, name: string): EnvSecretRefBinding {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || (value as { type?: unknown }).type !== "secret_ref"
    || typeof (value as { secretId?: unknown }).secretId !== "string"
    || !(value as { secretId: string }).secretId.trim()
  ) {
    throw new Error(`${name} must be a Paperclip secret_ref binding`);
  }
  const version = (value as { version?: unknown }).version;
  if (
    version !== undefined
    && version !== "latest"
    && !(typeof version === "number" && Number.isInteger(version) && version > 0)
  ) {
    throw new Error(`${name}.version must be 'latest' or a positive integer`);
  }
  return value as EnvSecretRefBinding;
}

function missionControlBaseUrl(value: unknown, syncMode: "apply" | "disabled") {
  if (value === undefined || value === null || value === "") {
    if (syncMode === "apply") {
      throw new Error("missionControlBaseUrl is required when githubSyncMode is apply");
    }
    return undefined;
  }
  if (typeof value !== "string" || value !== FACTORY_MISSION_CONTROL_BASE_URL) {
    throw new Error(`missionControlBaseUrl must be exactly ${FACTORY_MISSION_CONTROL_BASE_URL}`);
  }
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("missionControlBaseUrl must not contain userinfo, query, or fragment");
  }
  return value;
}

function parseBridgeConfig(raw: Record<string, unknown>): BridgeConfig {
  const syncMode = raw.githubSyncMode === "disabled" ? "disabled" as const : "apply" as const;
  if (raw.allowedRepositoryOwner && raw.allowedRepositoryOwner !== "iMelki") {
    throw new Error("allowedRepositoryOwner must remain iMelki");
  }
  const config: BridgeConfig = {
    companyId: nonEmpty(raw.companyId, "companyId"),
    projectId: nonEmpty(raw.projectId, "projectId"),
    allowedRepositoryOwner: "iMelki",
    dispatchSecretRef: secretRef(raw.dispatchSecretRef, "dispatchSecretRef"),
    callbackSecretRef: secretRef(raw.callbackSecretRef, "callbackSecretRef"),
    missionControlOutcomeSecretRef: secretRef(
      raw.missionControlOutcomeSecretRef,
      "missionControlOutcomeSecretRef",
    ),
    missionControlBaseUrl: missionControlBaseUrl(raw.missionControlBaseUrl, syncMode),
    githubSyncMode: syncMode,
    directorAgentId: nonEmpty(raw.directorAgentId, "directorAgentId"),
    builderAgentId: nonEmpty(raw.builderAgentId, "builderAgentId"),
    validatorAgentId: nonEmpty(raw.validatorAgentId, "validatorAgentId"),
    reviewerAgentId: nonEmpty(raw.reviewerAgentId, "reviewerAgentId"),
    integratorAgentId: nonEmpty(raw.integratorAgentId, "integratorAgentId"),
  };
  const roleIds = [
    config.directorAgentId,
    config.builderAgentId,
    config.validatorAgentId,
    config.reviewerAgentId,
    config.integratorAgentId,
  ];
  if (new Set(roleIds).size !== roleIds.length) {
    throw new Error("Factory Director, Builder, Validator, Reviewer, and Integrator agent IDs must be distinct");
  }
  return config;
}

async function readConfig(ctx: PluginContext, authorizedCompanyId: string): Promise<BridgeConfig> {
  const scopeCompanyId = nonEmpty(
    authorizedCompanyId,
    "authorized company-scoped Paperclip configuration",
  );
  const config = parseBridgeConfig(await ctx.config.get(scopeCompanyId));
  if (config.companyId !== scopeCompanyId) {
    throw new Error("Paperclip config companyId does not match the authorized company scope");
  }
  configuredCompanyIds.add(scopeCompanyId);
  return config;
}

function priority(input: MckDispatch["task"]["priority"]) {
  if (input === "urgent") return "critical" as const;
  if (input === "normal") return "medium" as const;
  return input;
}

function identity(dispatch: MckDispatch, deliveryId: string, rawBody: string) {
  if (dispatch.version === 2) return dispatch.dispatch;
  return {
    attempt_id: deliveryId,
    delivery_id: deliveryId,
    correlation_id: `mck:${dispatch.task.id}`,
    task_revision: sha256(rawBody),
  };
}

async function getMapping(ctx: PluginContext, companyId: string, correlationId: string) {
  const rows = await ctx.db.query<BridgeMapping>(
    `SELECT * FROM ${table(ctx, "bridge_mappings")}
     WHERE company_id = $1 AND correlation_id = $2`,
    [companyId, correlationId],
  );
  const mapping = rows[0];
  if (mapping && typeof mapping.envelope === "string") {
    mapping.envelope = JSON.parse(mapping.envelope) as MckDispatch;
  }
  return mapping ?? null;
}

async function mappingForIssue(ctx: PluginContext, companyId: string, issueId: string) {
  const rows = await ctx.db.query<BridgeMapping>(
    `SELECT * FROM ${table(ctx, "bridge_mappings")}
     WHERE company_id = $1
       AND (
         parent_issue_id = $2 OR plan_issue_id = $2 OR build_issue_id = $2
         OR validate_issue_id = $2 OR review_issue_id = $2 OR release_issue_id = $2
       )
     LIMIT 1`,
    [companyId, issueId],
  );
  const mapping = rows[0];
  if (mapping && typeof mapping.envelope === "string") {
    mapping.envelope = JSON.parse(mapping.envelope) as MckDispatch;
  }
  return mapping ?? null;
}

export async function claimDelivery(
  ctx: PluginContext,
  companyId: string,
  input: { deliveryId: string; payloadHash: string; eventType: string },
) {
  const ownerToken = randomUUID();
  const inserted = await ctx.db.execute(
    `INSERT INTO ${table(ctx, "bridge_deliveries")} (
      company_id, delivery_id, payload_hash, event_type, status, processing_generation,
      processing_owner_token, lease_started_at
    ) VALUES ($1, $2, $3, $4, 'processing', 1, $5, now())
    ON CONFLICT (company_id, delivery_id) DO NOTHING`,
    [companyId, input.deliveryId, input.payloadHash, input.eventType, ownerToken],
  );
  if (inserted.rowCount === 1) {
    return {
      duplicate: false as const,
      owner: { ownerToken, generation: 1 } satisfies OwnerFence,
    };
  }
  const rows = await ctx.db.query<{
    payload_hash: string;
    status: string;
    processing_generation: number;
  }>(
    `SELECT payload_hash, status, processing_generation
     FROM ${table(ctx, "bridge_deliveries")}
     WHERE company_id = $1 AND delivery_id = $2`,
    [companyId, input.deliveryId],
  );
  const delivery = rows[0];
  if (!delivery) throw new Error("Could not persist bridge delivery");
  if (delivery.payload_hash !== input.payloadHash) throw new Error("delivery_payload_conflict");
  if (delivery.status === "processed") return { duplicate: true as const, owner: null };
  const previousGeneration = Number(delivery.processing_generation ?? 0);
  const nextGeneration = previousGeneration + 1;
  const reclaimed = await ctx.db.execute(
    `UPDATE ${table(ctx, "bridge_deliveries")}
     SET status = 'processing', last_error = NULL,
         processing_generation = $4, processing_owner_token = $5,
         lease_started_at = now(), updated_at = now()
     WHERE company_id = $1
       AND delivery_id = $2
       AND payload_hash = $3
       AND processing_generation = $6
       AND (
         status = 'failed'
         OR (
           status = 'processing'
           AND COALESCE(lease_started_at, updated_at) < now() - interval '5 minutes'
         )
       )`,
    [
      companyId,
      input.deliveryId,
      input.payloadHash,
      nextGeneration,
      ownerToken,
      previousGeneration,
    ],
  );
  if (reclaimed.rowCount === 1) {
    return {
      duplicate: false as const,
      owner: { ownerToken, generation: nextGeneration } satisfies OwnerFence,
    };
  }
  throw new Error("delivery_in_progress");
}

export async function finishDelivery(
  ctx: PluginContext,
  companyId: string,
  deliveryId: string,
  owner: OwnerFence,
  input: { status: "processed" | "failed"; correlationId?: string; error?: unknown },
) {
  const updated = await ctx.db.execute(
    `UPDATE ${table(ctx, "bridge_deliveries")}
     SET status = $2, mapping_correlation_id = $3, last_error = $4,
         lease_started_at = NULL, updated_at = now()
     WHERE company_id = $1
       AND delivery_id = $5
       AND status = 'processing'
       AND processing_owner_token = $6
       AND processing_generation = $7`,
    [
      companyId,
      input.status,
      input.correlationId ?? null,
      input.error ? JSON.stringify(redactDiagnostic(input.error)) : null,
      deliveryId,
      owner.ownerToken,
      owner.generation,
    ],
  );
  if (updated.rowCount !== 1) throw new Error("delivery_owner_fence_lost");
}

async function findOrCreateIssue(
  ctx: PluginContext,
  config: BridgeConfig,
  input: {
    originId: string;
    parentId?: string;
    inheritFrom?: string;
    title: string;
    description: string;
    status?: "backlog" | "todo";
    assigneeAgentId?: string;
    blockedByIssueIds?: string[];
    issuePriority: "critical" | "high" | "medium" | "low";
  },
) {
  const existing = await ctx.issues.list({
    companyId: config.companyId,
    originKind: ORIGIN_KIND,
    originId: input.originId,
    limit: 2,
    offset: 0,
  });
  if (existing.length > 1) throw new Error(`Duplicate Paperclip origin mapping: ${input.originId}`);
  if (existing[0]) return existing[0];
  return ctx.issues.create({
    companyId: config.companyId,
    projectId: config.projectId,
    parentId: input.parentId,
    inheritExecutionWorkspaceFromIssueId: input.inheritFrom,
    title: input.title,
    description: input.description,
    status: input.status ?? "todo",
    priority: input.issuePriority,
    assigneeAgentId: input.assigneeAgentId,
    billingCode: `mck:${input.originId}`,
    originKind: ORIGIN_KIND,
    originId: input.originId,
    blockedByIssueIds: input.blockedByIssueIds,
  });
}

export async function createExecutionGraph(
  ctx: PluginContext,
  config: BridgeConfig,
  dispatch: MckDispatch,
  correlationId: string,
  rawDispatchBody: string,
): Promise<GraphIds> {
  const source = dispatch.task.github_source;
  const contract = dispatch.version === 2 ? dispatch.factory_contract : undefined;
  const taskRevision = dispatch.version === 2 ? dispatch.dispatch.task_revision : undefined;
  const root = await findOrCreateIssue(ctx, config, {
    originId: correlationId,
    title: dispatch.task.title,
    description: [
      dispatch.task.description ?? "",
      "",
      `MCK task: ${dispatch.task.id}`,
      `GitHub issue: ${source.issue_url}`,
      `Repository: ${contract?.repository.slug ?? `${source.repo_owner}/${source.repo_name}`}`,
      contract ? `Base SHA: ${contract.repository.base_sha}` : "",
      taskRevision ? `Task revision: ${taskRevision}` : "",
    ].filter(Boolean).join("\n"),
    status: "backlog",
    issuePriority: priority(dispatch.task.priority),
  });
  const envelopeDocument = await ctx.issues.documents.upsert({
    issueId: root.id,
    companyId: config.companyId,
    key: "mck-task-envelope",
    title: "MCK Task Envelope",
    format: "markdown",
    body: rawDispatchBody,
    changeSummary: "Recorded signed MCK dispatch envelope",
  });
  const envelopeReadback = await ctx.issues.documents.get(
    root.id,
    "mck-task-envelope",
    config.companyId,
  );
  if (
    envelopeDocument.format !== "markdown"
    || envelopeReadback?.format !== "markdown"
    || envelopeReadback.body !== rawDispatchBody
  ) {
    throw new Error("Paperclip did not preserve the exact MCK task envelope document");
  }
  let readbackDispatch: MckDispatch;
  try {
    readbackDispatch = parseDispatch(
      JSON.parse(envelopeReadback.body),
      config.allowedRepositoryOwner,
    );
  } catch {
    throw new Error("Paperclip MCK task envelope readback is not the accepted dispatch JSON");
  }
  if (
    readbackDispatch.task.id !== dispatch.task.id
    || (
      dispatch.version === 2
      && (
        readbackDispatch.version !== 2
        || readbackDispatch.dispatch.attempt_id !== dispatch.dispatch.attempt_id
        || readbackDispatch.dispatch.task_revision !== dispatch.dispatch.task_revision
      )
    )
  ) {
    throw new Error("Paperclip MCK task envelope readback identity changed");
  }
  await ctx.issues.update(
    root.id,
    { status: "todo", assigneeAgentId: config.directorAgentId },
    config.companyId,
  );
  const created = new Map<StageKey, string>();
  for (const stage of buildStageDefinitions(dispatch.task.title)) {
    const blocker = stage.blockedBy ? created.get(stage.blockedBy) : undefined;
    const assigneeAgentId = config[stage.assigneeConfigKey as keyof BridgeConfig];
    if (typeof assigneeAgentId !== "string") throw new Error(`Missing ${stage.assigneeConfigKey}`);
    const issue = await findOrCreateIssue(ctx, config, {
      originId: `${correlationId}:${stage.key}`,
      parentId: root.id,
      inheritFrom: root.id,
      title: stage.title,
      description: [
        stage.description,
        "",
        dispatch.prompt_markdown,
        contract ? `\nFactory contract:\n${JSON.stringify(contract, null, 2)}` : "",
      ].join("\n"),
      assigneeAgentId,
      blockedByIssueIds: blocker ? [blocker] : undefined,
      issuePriority: priority(dispatch.task.priority),
    });
    if (blocker) {
      await ctx.issues.relations.setBlockedBy(issue.id, [blocker], config.companyId);
    }
    created.set(stage.key, issue.id);
  }
  const ids = {
    parent: root.id,
    plan: nonEmpty(created.get("plan"), "plan issue"),
    build: nonEmpty(created.get("build"), "build issue"),
    validate: nonEmpty(created.get("validate"), "validate issue"),
    review: nonEmpty(created.get("review"), "review issue"),
    release: nonEmpty(created.get("release"), "release issue"),
  };
  await ctx.issues.requestWakeup(ids.plan, config.companyId, {
    reason: "plugin:mck_dispatch_accepted",
    contextSource: PLUGIN_ID,
    idempotencyKey: `${correlationId}:plan`,
  });
  return ids;
}

function graphFromMapping(mapping: BridgeMapping): GraphIds | null {
  if (
    !mapping.parent_issue_id
    || !mapping.plan_issue_id
    || !mapping.build_issue_id
    || !mapping.validate_issue_id
    || !mapping.review_issue_id
    || !mapping.release_issue_id
  ) {
    return null;
  }
  return {
    parent: mapping.parent_issue_id,
    plan: mapping.plan_issue_id,
    build: mapping.build_issue_id,
    validate: mapping.validate_issue_id,
    review: mapping.review_issue_id,
    release: mapping.release_issue_id,
  };
}

export async function reserveMapping(
  ctx: PluginContext,
  companyId: string,
  dispatch: MckDispatch,
  dispatchIdentity: ReturnType<typeof identity>,
) {
  const callbackUrl = dispatch.version === 2 ? dispatch.callbacks.lifecycle : null;
  const ownerToken = randomUUID();
  const inserted = await ctx.db.execute(
    `INSERT INTO ${table(ctx, "bridge_mappings")} (
      company_id, correlation_id, mck_task_id, attempt_id, dispatch_version, task_revision,
      github_issue_url, callback_url, envelope, intake_status, intake_generation,
      intake_owner_token, intake_lease_started_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'processing', 1, $10, now())
    ON CONFLICT (company_id, correlation_id) DO NOTHING`,
    [
      companyId,
      dispatchIdentity.correlation_id,
      dispatch.task.id,
      dispatchIdentity.attempt_id,
      dispatch.version,
      dispatchIdentity.task_revision,
      dispatch.task.github_source.issue_url,
      callbackUrl,
      JSON.stringify(dispatch),
      ownerToken,
    ],
  );
  if (inserted.rowCount === 1) {
    return {
      createGraph: true as const,
      graph: null,
      owner: { ownerToken, generation: 1 } satisfies OwnerFence,
    };
  }

  const existing = await getMapping(ctx, companyId, dispatchIdentity.correlation_id);
  if (!existing) throw new Error("Could not reserve MCK correlation mapping");
  assertCorrelationRevision(existing, dispatchIdentity.task_revision);
  const existingGraph = graphFromMapping(existing);
  if (existing.intake_status === "accepted" && existingGraph) {
    await ctx.db.execute(
      `UPDATE ${table(ctx, "bridge_mappings")}
       SET attempt_id = $3, dispatch_version = $4, github_issue_url = $5,
           callback_url = $6, envelope = $7::jsonb, updated_at = now()
       WHERE company_id = $1 AND correlation_id = $2 AND task_revision = $8`,
      [
        companyId,
        dispatchIdentity.correlation_id,
        dispatchIdentity.attempt_id,
        dispatch.version,
        dispatch.task.github_source.issue_url,
        callbackUrl,
        JSON.stringify(dispatch),
        dispatchIdentity.task_revision,
      ],
    );
    return { createGraph: false as const, graph: existingGraph, owner: null };
  }

  const previousGeneration = Number(existing.intake_generation ?? 0);
  const nextGeneration = previousGeneration + 1;
  const reclaimed = await ctx.db.execute(
    `UPDATE ${table(ctx, "bridge_mappings")}
      SET mck_task_id = $3, attempt_id = $4, dispatch_version = $5,
          github_issue_url = $6, callback_url = $7, envelope = $8::jsonb,
          intake_status = 'processing', last_error = NULL,
          intake_generation = $10, intake_owner_token = $11,
          intake_lease_started_at = now(), updated_at = now()
      WHERE company_id = $1
        AND correlation_id = $2
        AND task_revision = $9
        AND intake_generation = $12
        AND (
          intake_status = 'failed'
          OR (
            intake_status = 'processing'
            AND COALESCE(intake_lease_started_at, updated_at) < now() - interval '5 minutes'
          )
        )`,
    [
      companyId,
      dispatchIdentity.correlation_id,
      dispatch.task.id,
      dispatchIdentity.attempt_id,
      dispatch.version,
      dispatch.task.github_source.issue_url,
      callbackUrl,
      JSON.stringify(dispatch),
      dispatchIdentity.task_revision,
      nextGeneration,
      ownerToken,
      previousGeneration,
    ],
  );
  if (reclaimed.rowCount === 1) {
    return {
      createGraph: true as const,
      graph: null,
      owner: { ownerToken, generation: nextGeneration } satisfies OwnerFence,
    };
  }
  throw new Error("correlation_in_progress");
}

export async function completeMapping(
  ctx: PluginContext,
  companyId: string,
  correlationId: string,
  ids: GraphIds,
  owner: OwnerFence,
) {
  const updated = await ctx.db.execute(
    `UPDATE ${table(ctx, "bridge_mappings")}
     SET parent_issue_id = $3, plan_issue_id = $4, build_issue_id = $5,
          validate_issue_id = $6, review_issue_id = $7, release_issue_id = $8,
          intake_status = 'accepted', last_error = NULL,
          intake_lease_started_at = NULL, updated_at = now()
      WHERE company_id = $1
        AND correlation_id = $2
        AND intake_status = 'processing'
        AND intake_owner_token = $9
        AND intake_generation = $10`,
    [
      companyId,
      correlationId,
      ids.parent,
      ids.plan,
      ids.build,
      ids.validate,
      ids.review,
      ids.release,
      owner.ownerToken,
      owner.generation,
    ],
  );
  if (updated.rowCount !== 1) throw new Error("Could not complete MCK correlation mapping");
}

export async function failMapping(
  ctx: PluginContext,
  companyId: string,
  correlationId: string,
  owner: OwnerFence,
  error: unknown,
) {
  return ctx.db.execute(
    `UPDATE ${table(ctx, "bridge_mappings")}
     SET intake_status = 'failed', last_error = $3,
         intake_lease_started_at = NULL, updated_at = now()
     WHERE company_id = $1
       AND correlation_id = $2
       AND intake_status = 'processing'
       AND intake_owner_token = $4
       AND intake_generation = $5`,
    [
      companyId,
      correlationId,
      JSON.stringify(redactDiagnostic(error instanceof Error ? error.message : error)),
      owner.ownerToken,
      owner.generation,
    ],
  );
}

export async function publishMissionControlOutcome(
  ctx: PluginContext,
  config: BridgeConfig,
  mapping: BridgeMapping,
  status: LifecycleStatus,
  summary: string,
  receipt?: FactoryReceipt,
) {
  if (!config.missionControlBaseUrl || config.githubSyncMode === "disabled") {
    return { skipped: true as const, httpStatus: null };
  }
  const deliveryKey = `${mapping.attempt_id}:${status}:${receipt?.receiptId ?? sha256(summary)}`;
  const outcome = missionControlOutcomeRequest(config, mapping, status, summary, receipt, deliveryKey);
  if (!outcome) return { skipped: true as const, httpStatus: null };
  const response = await publishMissionControlRequest(ctx, config, outcome);
  return { skipped: false as const, httpStatus: response.status };
}

function missionControlEvent(status: LifecycleStatus) {
  return status === "started" || status === "testing"
    ? "started"
    : status === "review"
      ? "review"
      : status === "completed"
        ? "done"
        : status === "needs_human"
          ? "needs_human"
          : "blocked";
}

function missionControlOutcomeRequest(
  config: BridgeConfig,
  mapping: BridgeMapping,
  status: LifecycleStatus,
  summary: string,
  receipt: FactoryReceipt | undefined,
  deliveryKey: string,
) {
  if (!config.missionControlBaseUrl || config.githubSyncMode === "disabled") return null;
  const envelope = mapping.envelope as MckDispatch;
  const deliveryId = receipt?.receiptId
    ?? `factory-lifecycle-${sha256(deliveryKey).slice(0, 32)}`;
  const rawBody = JSON.stringify({
    task_id: mapping.mck_task_id,
    event: missionControlEvent(status),
    receipt_id: deliveryId,
    summary,
    agent: "Paperclip",
    github_source: envelope.task.github_source,
    dispatch_metadata: envelope.task.dispatch_metadata,
    github_sync_mode: config.githubSyncMode,
    metadata: {
      correlation_id: mapping.correlation_id,
      attempt_id: mapping.attempt_id,
      receipt_id: deliveryId,
      paperclip_issue_id: mapping.parent_issue_id,
    },
  });
  return {
    deliveryId,
    url: `${config.missionControlBaseUrl}/api/webhooks/factory-runtime-outcomes`,
    rawBody,
    payloadHash: sha256(rawBody),
  };
}

async function publishMissionControlRequest(
  ctx: PluginContext,
  config: BridgeConfig,
  outcome: {
    deliveryId: string;
    url: string;
    rawBody: string;
    payloadHash: string;
  },
) {
  if (sha256(outcome.rawBody) !== outcome.payloadHash) {
    throw new Error("mission_control_outcome_payload_hash_conflict");
  }
  if (outcome.url !== `${FACTORY_MISSION_CONTROL_BASE_URL}/api/webhooks/factory-runtime-outcomes`) {
    throw new Error("mission_control_outcome_target_conflict");
  }
  const missionControlOutcomeSecret = await ctx.secrets.resolve(
    config.missionControlOutcomeSecretRef,
    {
      companyId: config.companyId,
      configPath: "missionControlOutcomeSecretRef",
    },
  );
  const response = await scopedHostFetch(
    ctx,
    config.companyId,
    outcome.url,
    {
      method: "POST",
      headers: signMissionControlOutcome({
        rawBody: outcome.rawBody,
        deliveryId: outcome.deliveryId,
        secret: missionControlOutcomeSecret,
      }),
      body: outcome.rawBody,
    },
  );
  const responseBody = await response.text().catch(() => "");
  assertSuccessfulPublication({
    label: "Mission Control outcome",
    ok: response.ok,
    status: response.status,
    rawBody: responseBody,
  });
  return response;
}

interface LifecycleDeliveryRow {
  company_id: string;
  delivery_key: string;
  correlation_id: string;
  delivery_id: string;
  callback_url: string | null;
  payload: unknown;
  raw_body: string;
  payload_hash: string;
  status: string;
  attempt_count: number;
  mck_lease_generation: number;
  outcome_delivery_id: string | null;
  outcome_url: string | null;
  outcome_raw_body: string | null;
  outcome_payload_hash: string | null;
  outcome_status: string;
  outcome_attempt_count: number;
  outcome_lease_generation: number;
}

function hydrateLifecycleDelivery(row: LifecycleDeliveryRow): LifecycleDelivery {
  if (!row.callback_url) throw new Error("lifecycle_delivery_target_missing");
  return {
    companyId: row.company_id,
    deliveryKey: row.delivery_key,
    correlationId: row.correlation_id,
    deliveryId: row.delivery_id,
    callbackUrl: row.callback_url,
    payload: typeof row.payload === "string"
      ? JSON.parse(row.payload) as Record<string, unknown>
      : row.payload as Record<string, unknown>,
    rawBody: row.raw_body,
    payloadHash: row.payload_hash,
    status: row.status,
    attemptCount: Number(row.attempt_count ?? 0),
    mckLeaseGeneration: Number(row.mck_lease_generation ?? 0),
    outcomeDeliveryId: row.outcome_delivery_id,
    outcomeUrl: row.outcome_url,
    outcomeRawBody: row.outcome_raw_body,
    outcomePayloadHash: row.outcome_payload_hash,
    outcomeStatus: row.outcome_status,
    outcomeAttemptCount: Number(row.outcome_attempt_count ?? 0),
    outcomeLeaseGeneration: Number(row.outcome_lease_generation ?? 0),
  };
}

async function selectLifecycleDelivery(
  ctx: PluginContext,
  companyId: string,
  deliveryKey: string,
) {
  const rows = await ctx.db.query<LifecycleDeliveryRow>(
    `SELECT company_id, delivery_key, correlation_id, delivery_id, callback_url, payload, raw_body,
            payload_hash, status, attempt_count, mck_lease_generation,
            outcome_delivery_id, outcome_url, outcome_raw_body, outcome_payload_hash,
            outcome_status, outcome_attempt_count, outcome_lease_generation
     FROM ${table(ctx, "lifecycle_deliveries")}
     WHERE company_id = $1 AND delivery_key = $2`,
    [companyId, deliveryKey],
  );
  return rows[0] ? hydrateLifecycleDelivery(rows[0]) : null;
}

async function sendMissionControlOutcome(
  ctx: PluginContext,
  config: BridgeConfig,
  delivery: LifecycleDelivery,
) {
  if (delivery.companyId !== config.companyId) {
    throw new Error("lifecycle_delivery_company_scope_conflict");
  }
  if (
    !delivery.outcomeUrl
    || !delivery.outcomeDeliveryId
    || !delivery.outcomeRawBody
    || !delivery.outcomePayloadHash
    || config.githubSyncMode === "disabled"
  ) {
    await ctx.db.execute(
      `UPDATE ${table(ctx, "lifecycle_deliveries")}
       SET outcome_status = 'skipped', outcome_last_error = NULL,
           outcome_lease_started_at = NULL, updated_at = now()
       WHERE delivery_key = $1
         AND company_id = $2
         AND outcome_status IN ('pending', 'failed', 'skipped')`,
      [delivery.deliveryKey, config.companyId],
    );
    return { skipped: true as const, duplicate: false };
  }
  const ownerToken = randomUUID();
  const nextGeneration = delivery.outcomeLeaseGeneration + 1;
  const claimed = await ctx.db.execute(
    `UPDATE ${table(ctx, "lifecycle_deliveries")}
     SET outcome_status = 'sending', outcome_attempt_count = outcome_attempt_count + 1,
         outcome_last_error = NULL, outcome_lease_generation = $3,
         outcome_lease_owner_token = $4, outcome_lease_started_at = now(),
         updated_at = now()
     WHERE delivery_key = $1
       AND outcome_attempt_count < $2
       AND outcome_lease_generation = $5
       AND company_id = $6
       AND (
         outcome_status IN ('pending', 'failed')
         OR (
           outcome_status = 'sending'
           AND COALESCE(outcome_lease_started_at, updated_at) < now() - interval '5 minutes'
         )
       )`,
    [
      delivery.deliveryKey,
      MAX_LIFECYCLE_DELIVERY_ATTEMPTS,
      nextGeneration,
      ownerToken,
      delivery.outcomeLeaseGeneration,
      config.companyId,
    ],
  );
  if (claimed.rowCount !== 1) {
    const rows = await ctx.db.query<{ outcome_status: string; outcome_attempt_count: number }>(
      `SELECT outcome_status, outcome_attempt_count
       FROM ${table(ctx, "lifecycle_deliveries")}
       WHERE delivery_key = $1 AND company_id = $2`,
      [delivery.deliveryKey, config.companyId],
    );
    if (rows[0]?.outcome_status === "sent" || rows[0]?.outcome_status === "skipped") {
      return { skipped: rows[0]?.outcome_status === "skipped", duplicate: true };
    }
    if (Number(rows[0]?.outcome_attempt_count ?? 0) >= MAX_LIFECYCLE_DELIVERY_ATTEMPTS) {
      throw new Error("mission_control_outcome_retry_exhausted");
    }
    throw new Error("mission_control_outcome_in_progress");
  }
  try {
    const response = await publishMissionControlRequest(ctx, config, {
      deliveryId: delivery.outcomeDeliveryId,
      url: delivery.outcomeUrl,
      rawBody: delivery.outcomeRawBody,
      payloadHash: delivery.outcomePayloadHash,
    });
    const completed = await ctx.db.execute(
      `UPDATE ${table(ctx, "lifecycle_deliveries")}
       SET outcome_status = 'sent', outcome_http_status = $2,
            outcome_last_error = NULL, outcome_lease_started_at = NULL,
            updated_at = now()
        WHERE delivery_key = $1
          AND outcome_status = 'sending'
          AND outcome_lease_owner_token = $3
          AND outcome_lease_generation = $4
          AND company_id = $5`,
      [delivery.deliveryKey, response.status, ownerToken, nextGeneration, config.companyId],
    );
    if (completed.rowCount !== 1) throw new Error("mission_control_outcome_owner_fence_lost");
    return { skipped: false as const, duplicate: false };
  } catch (error) {
    await ctx.db.execute(
      `UPDATE ${table(ctx, "lifecycle_deliveries")}
       SET outcome_status = 'failed', outcome_last_error = $2,
           outcome_lease_started_at = NULL, updated_at = now()
       WHERE delivery_key = $1
         AND outcome_status = 'sending'
         AND outcome_lease_owner_token = $3
         AND outcome_lease_generation = $4
         AND company_id = $5`,
      [
        delivery.deliveryKey,
        JSON.stringify(redactDiagnostic(error instanceof Error ? error.message : error)),
        ownerToken,
        nextGeneration,
        config.companyId,
      ],
    );
    throw error;
  }
}

export function buildLifecycleDeliveryKey(
  mapping: Pick<BridgeMapping, "company_id" | "attempt_id">,
  status: LifecycleStatus,
  receiptId: string | undefined,
  occurrenceIdentity: string,
) {
  return [
    mapping.company_id,
    mapping.attempt_id,
    status,
    receiptId ?? "state",
    sha256(occurrenceIdentity).slice(0, 32),
  ].join(":");
}

async function lifecyclePayload(
  ctx: PluginContext,
  config: BridgeConfig,
  mapping: BridgeMapping,
  status: LifecycleStatus,
  summary: string,
  receipt: FactoryReceipt | undefined,
  occurrenceIdentity: string,
): Promise<LifecycleDelivery> {
  const key = buildLifecycleDeliveryKey(
    mapping,
    status,
    receipt?.receiptId,
    occurrenceIdentity,
  );
  if (mapping.company_id !== config.companyId) {
    throw new Error("mapping_company_scope_conflict");
  }
  const existing = await selectLifecycleDelivery(ctx, config.companyId, key);
  if (existing) return existing;

  const deliveryId = `factory-${sha256(key).slice(0, 32)}`;
  const payload = {
    schema_version: "2",
    type: "mck.callback.lifecycle",
    task_id: mapping.mck_task_id,
    attempt_id: mapping.attempt_id,
    correlation_id: mapping.correlation_id,
    task_revision: mapping.task_revision,
    status,
    occurred_at: new Date().toISOString(),
    summary,
    result: {
      paperclip_parent_issue_id: mapping.parent_issue_id,
      paperclip_stage_issue_ids: {
        plan: mapping.plan_issue_id,
        build: mapping.build_issue_id,
        validate: mapping.validate_issue_id,
        review: mapping.review_issue_id,
        release: mapping.release_issue_id,
      },
    },
    ...(receipt ? { receipt } : {}),
  };
  const rawBody = JSON.stringify(payload);
  const outcome = missionControlOutcomeRequest(
    config,
    mapping,
    status,
    summary,
    receipt,
    key,
  );
  const inserted = await ctx.db.execute(
    `INSERT INTO ${table(ctx, "lifecycle_deliveries")} (
      company_id, delivery_key, correlation_id, delivery_id, callback_url, payload, raw_body,
      payload_hash, status, outcome_status, outcome_delivery_id, outcome_url,
      outcome_raw_body, outcome_payload_hash
    ) VALUES (
      $1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'pending', $9, $10, $11, $12, $13
    )
    ON CONFLICT (company_id, delivery_key) DO NOTHING`,
    [
      config.companyId,
      key,
      mapping.correlation_id,
      deliveryId,
      mapping.callback_url,
      rawBody,
      rawBody,
      sha256(rawBody),
      outcome ? "pending" : "skipped",
      outcome?.deliveryId ?? null,
      outcome?.url ?? null,
      outcome?.rawBody ?? null,
      outcome?.payloadHash ?? null,
    ],
  );
  if (inserted.rowCount !== 1) {
    const raced = await selectLifecycleDelivery(ctx, config.companyId, key);
    if (!raced) throw new Error("Could not persist lifecycle delivery");
    return raced;
  }
  return {
    companyId: config.companyId,
    deliveryKey: key,
    correlationId: mapping.correlation_id,
    deliveryId,
    callbackUrl: nonEmpty(mapping.callback_url, "lifecycle callback URL"),
    payload,
    rawBody,
    payloadHash: sha256(rawBody),
    status: "pending",
    attemptCount: 0,
    mckLeaseGeneration: 0,
    outcomeDeliveryId: outcome?.deliveryId ?? null,
    outcomeUrl: outcome?.url ?? null,
    outcomeRawBody: outcome?.rawBody ?? null,
    outcomePayloadHash: outcome?.payloadHash ?? null,
    outcomeStatus: outcome ? "pending" : "skipped",
    outcomeAttemptCount: 0,
    outcomeLeaseGeneration: 0,
  };
}

async function publishMckLifecycleRequest(
  ctx: PluginContext,
  config: BridgeConfig,
  delivery: LifecycleDelivery,
) {
  if (delivery.companyId !== config.companyId) {
    throw new Error("lifecycle_delivery_company_scope_conflict");
  }
  if (sha256(delivery.rawBody) !== delivery.payloadHash) {
    throw new Error("lifecycle_delivery_payload_hash_conflict");
  }
  if (delivery.callbackUrl !== FACTORY_MCK_LIFECYCLE_URL) {
    throw new Error("lifecycle_delivery_target_conflict");
  }
  const callbackSecret = await ctx.secrets.resolve(config.callbackSecretRef, {
    companyId: config.companyId,
    configPath: "callbackSecretRef",
  });
  const response = await scopedHostFetch(ctx, config.companyId, delivery.callbackUrl, {
    method: "POST",
    headers: signMckPayload({
      rawBody: delivery.rawBody,
      deliveryId: delivery.deliveryId,
      secret: callbackSecret,
    }),
    body: delivery.rawBody,
  });
  const responseBody = await response.text().catch(() => "");
  assertSuccessfulPublication({
    label: "MCK lifecycle callback",
    ok: response.ok,
    status: response.status,
    rawBody: responseBody,
  });
  return response;
}

async function sendLifecycleDelivery(
  ctx: PluginContext,
  config: BridgeConfig,
  delivery: LifecycleDelivery,
) {
  if (delivery.status === "sent") {
    return { duplicate: true as const, deliveryId: delivery.deliveryId };
  }
  const ownerToken = randomUUID();
  const nextGeneration = delivery.mckLeaseGeneration + 1;
  const claimed = await ctx.db.execute(
    `UPDATE ${table(ctx, "lifecycle_deliveries")}
     SET status = 'sending', attempt_count = attempt_count + 1, last_error = NULL,
         mck_lease_generation = $3, mck_lease_owner_token = $4,
         mck_lease_started_at = now(), updated_at = now()
     WHERE delivery_key = $1
       AND attempt_count < $2
       AND mck_lease_generation = $5
       AND company_id = $6
       AND (
         status IN ('pending', 'failed')
         OR (
           status = 'sending'
           AND COALESCE(mck_lease_started_at, updated_at) < now() - interval '5 minutes'
         )
       )`,
    [
      delivery.deliveryKey,
      MAX_LIFECYCLE_DELIVERY_ATTEMPTS,
      nextGeneration,
      ownerToken,
      delivery.mckLeaseGeneration,
      config.companyId,
    ],
  );
  if (claimed.rowCount !== 1) {
    const current = await ctx.db.query<{ status: string; attempt_count: number }>(
      `SELECT status, attempt_count
       FROM ${table(ctx, "lifecycle_deliveries")}
       WHERE delivery_key = $1 AND company_id = $2`,
      [delivery.deliveryKey, config.companyId],
    );
    if (current[0]?.status === "sent") {
      return { duplicate: true as const, deliveryId: delivery.deliveryId };
    }
    if (Number(current[0]?.attempt_count ?? 0) >= MAX_LIFECYCLE_DELIVERY_ATTEMPTS) {
      throw new Error("lifecycle_delivery_retry_exhausted");
    }
    throw new Error("lifecycle_delivery_in_progress");
  }

  let response: Response;
  try {
    response = await publishMckLifecycleRequest(ctx, config, delivery);
    const payloadStatus = delivery.payload.status;
    const payloadTaskRevision = delivery.payload.task_revision;
    if (
      typeof payloadStatus !== "string"
      || typeof payloadTaskRevision !== "string"
      || ![
        "started",
        "testing",
        "review",
        "completed",
        "blocked",
        "needs_human",
        "failed",
        "cancelled",
      ].includes(payloadStatus)
    ) {
      throw new Error("lifecycle_delivery_replay_pointer_invalid");
    }
    const receiptId = payloadStatus === "completed"
      ? (delivery.payload.receipt as { receiptId?: unknown } | undefined)?.receiptId
      : null;
    const pointerUpdated = await ctx.db.execute(
      `UPDATE ${table(ctx, "bridge_mappings")}
       SET lifecycle_status = $2, receipt_id = $3, last_error = NULL, updated_at = now()
       WHERE correlation_id = $1
         AND task_revision = $4
         AND company_id = $8
         AND EXISTS (
           SELECT 1
           FROM ${table(ctx, "lifecycle_deliveries")} AS delivery
           WHERE delivery.delivery_key = $5
             AND delivery.company_id = $8
             AND delivery.status = 'sending'
             AND delivery.mck_lease_owner_token = $6
             AND delivery.mck_lease_generation = $7
         )`,
      [
        delivery.correlationId,
        payloadStatus,
        typeof receiptId === "string" ? receiptId : null,
        payloadTaskRevision,
        delivery.deliveryKey,
        ownerToken,
        nextGeneration,
        config.companyId,
      ],
    );
    if (pointerUpdated.rowCount !== 1) throw new Error("lifecycle_mapping_revision_conflict");
  } catch (error) {
    await ctx.db.execute(
      `UPDATE ${table(ctx, "lifecycle_deliveries")}
       SET status = 'failed', last_error = $2,
           mck_lease_started_at = NULL, updated_at = now()
       WHERE delivery_key = $1
         AND status = 'sending'
         AND mck_lease_owner_token = $3
         AND mck_lease_generation = $4
         AND company_id = $5`,
      [
        delivery.deliveryKey,
        JSON.stringify(redactDiagnostic(error instanceof Error ? error.message : error)),
        ownerToken,
        nextGeneration,
        config.companyId,
      ],
    );
    throw error;
  }
  const completed = await ctx.db.execute(
    `UPDATE ${table(ctx, "lifecycle_deliveries")}
     SET status = 'sent', http_status = $2, last_error = NULL,
         mck_lease_started_at = NULL, updated_at = now()
     WHERE delivery_key = $1
       AND status = 'sending'
       AND mck_lease_owner_token = $3
       AND mck_lease_generation = $4
       AND company_id = $5`,
    [delivery.deliveryKey, response.status, ownerToken, nextGeneration, config.companyId],
  );
  if (completed.rowCount !== 1) throw new Error("lifecycle_delivery_owner_fence_lost");
  return { duplicate: false as const, deliveryId: delivery.deliveryId };
}

async function replayPersistedLifecycleDelivery(
  ctx: PluginContext,
  config: BridgeConfig,
  delivery: LifecycleDelivery,
) {
  const response = await publishMckLifecycleRequest(ctx, config, delivery);
  return { deliveryId: delivery.deliveryId, httpStatus: response.status };
}

async function selectCurrentLifecycleDelivery(
  ctx: PluginContext,
  mapping: BridgeMapping,
) {
  if (!mapping.lifecycle_status) return null;
  const rows = await ctx.db.query<LifecycleDeliveryRow>(
    `SELECT company_id, delivery_key, correlation_id, delivery_id, callback_url, payload, raw_body,
            payload_hash, status, attempt_count, mck_lease_generation,
            outcome_delivery_id, outcome_url, outcome_raw_body, outcome_payload_hash,
            outcome_status, outcome_attempt_count, outcome_lease_generation
     FROM ${table(ctx, "lifecycle_deliveries")}
     WHERE company_id = $1 AND correlation_id = $2
     ORDER BY created_at DESC
     LIMIT 20`,
    [mapping.company_id, mapping.correlation_id],
  );
  for (const row of rows) {
    const delivery = hydrateLifecycleDelivery(row);
    if (
      delivery.payload.status === mapping.lifecycle_status
      && (
        mapping.lifecycle_status !== "completed"
        || (delivery.payload.receipt as { receiptId?: unknown } | undefined)?.receiptId === mapping.receipt_id
      )
    ) {
      return delivery;
    }
  }
  return null;
}

export async function replayCurrentLifecycleForRedispatch(
  ctx: PluginContext,
  config: BridgeConfig,
  mapping: BridgeMapping,
) {
  const delivery = await selectCurrentLifecycleDelivery(ctx, mapping);
  if (!delivery) return { replayed: false as const };
  const result = await replayPersistedLifecycleDelivery(ctx, config, delivery);
  return { replayed: true as const, ...result };
}

export async function publishLifecycle(
  ctx: PluginContext,
  config: BridgeConfig,
  mapping: BridgeMapping,
  status: LifecycleStatus,
  summary: string,
  receiptInput?: unknown,
  options: { deferMissionControl?: boolean; occurrenceIdentity?: string } = {},
) {
  if (mapping.dispatch_version !== 2 || !mapping.callback_url) {
    return { skipped: true, reason: "dispatch_v1_has_no_lifecycle_contract" };
  }
  const receipt = status === "completed"
    ? await validateReceiptForMapping(ctx, config, mapping, receiptInput)
    : undefined;
  const delivery = await lifecyclePayload(
    ctx,
    config,
    mapping,
    status,
    summary,
    receipt,
    options.occurrenceIdentity ?? `manual:${randomUUID()}`,
  );
  let lifecycleError: unknown;
  let sent: { duplicate: boolean; deliveryId: string } = {
    duplicate: false,
    deliveryId: delivery.deliveryId,
  };
  try {
    sent = await sendLifecycleDelivery(ctx, config, delivery);
  } catch (error) {
    lifecycleError = error;
  }
  if (lifecycleError) {
    await ctx.db.execute(
      `UPDATE ${table(ctx, "bridge_mappings")}
       SET last_error = $2, updated_at = now()
       WHERE correlation_id = $1 AND company_id = $3`,
      [
        mapping.correlation_id,
        JSON.stringify(
          redactDiagnostic(
            lifecycleError instanceof Error ? lifecycleError.message : lifecycleError,
          ),
        ),
        config.companyId,
      ],
    );
  }
  let outcomeDeferred = options.deferMissionControl === true;
  if (!outcomeDeferred) {
    try {
      await sendMissionControlOutcome(ctx, config, delivery);
    } catch (error) {
      outcomeDeferred = true;
      ctx.logger.warn("Mission Control outcome publication failed independently of MCK", {
        correlationId: mapping.correlation_id,
        error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
      });
    }
  }
  try {
    await ctx.metrics.write("lifecycle.published", 1, { status });
  } catch (error) {
    ctx.logger.warn("Lifecycle delivery processing completed but metrics publication failed", {
      correlationId: mapping.correlation_id,
      status,
      error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
    });
  }
  if (lifecycleError) throw lifecycleError;
  return {
    skipped: false,
    duplicate: sent.duplicate,
    outcomeDeferred,
    deliveryId: delivery.deliveryId,
  };
}

export function assertPaperclipCompletionEvidence(input: {
  receipt: FactoryReceipt;
  validationEvidence: FactoryValidationEvidence;
  releaseEvidence: FactoryReleaseEvidence;
  evidenceDocuments: {
    validationBodySha256: string;
    validationUpdatedAtMs: number;
    releaseBodySha256: string;
    releaseUpdatedAtMs: number;
    receiptUpdatedAtMs: number;
  };
  companyId: string;
  projectId: string;
  mapping: {
    rootIssueId: string;
    buildIssueId: string;
    validateIssueId: string;
    reviewIssueId: string;
    releaseIssueId: string;
  };
  agents: {
    builderAgentId: string;
    validatorAgentId: string;
    reviewerAgentId: string;
    integratorAgentId: string;
  };
  issueStatuses: Array<{ id: string; status: string }>;
  runs: Array<{
    id: string;
    issueId: string | null;
    agentId: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
  }>;
  activeRuns?: Array<{
    id: string;
    issueId: string | null;
    agentId: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
  }>;
  openDecisionCount: number;
}) {
  const { receipt, validationEvidence, releaseEvidence } = input;
  const equalJson = (left: unknown, right: unknown, label: string) => {
    if (canonicalJson(left) !== canonicalJson(right)) {
      throw new Error(`${label} does not match across factory evidence`);
    }
  };
  if (
    receipt.run.paperclipIssueId !== input.mapping.buildIssueId
    || receipt.run.builderAgentId !== input.agents.builderAgentId
    || receipt.run.roleProfile !== "factory-builder"
    || releaseEvidence.run.paperclipIssueId !== input.mapping.buildIssueId
    || releaseEvidence.run.builderAgentId !== input.agents.builderAgentId
    || releaseEvidence.run.rootIssueId !== input.mapping.rootIssueId
    || releaseEvidence.run.validatorIssueId !== input.mapping.validateIssueId
    || releaseEvidence.review.paperclipIssueId !== input.mapping.reviewIssueId
    || releaseEvidence.review.reviewerId !== input.agents.reviewerAgentId
    || validationEvidence.paperclip.companyId !== input.companyId
    || validationEvidence.paperclip.projectId !== input.projectId
    || validationEvidence.paperclip.rootIssueId !== input.mapping.rootIssueId
    || validationEvidence.paperclip.validatorIssueId !== input.mapping.validateIssueId
    || validationEvidence.paperclip.validatorAgentId !== input.agents.validatorAgentId
    || releaseEvidence.paperclip.companyId !== input.companyId
    || receipt.run.paperclipRunId !== releaseEvidence.run.paperclipRunId
    || receipt.run.workspaceId !== releaseEvidence.run.workspaceId
    || receipt.run.profileManifestSha256 !== releaseEvidence.run.profileManifestSha256
    || receipt.run.effectiveConfigSha256 !== releaseEvidence.run.effectiveConfigSha256
    || receipt.run.toolInventorySha256 !== releaseEvidence.run.toolInventorySha256
    || validationEvidence.paperclip.workspaceId !== receipt.run.workspaceId
  ) {
    throw new Error("Factory evidence escaped its configured company, project, issue, or role identity");
  }
  if (
    receipt.review.reviewerId !== releaseEvidence.review.reviewerId
    || receipt.review.reviewerRunId !== releaseEvidence.review.reviewerRunId
    || receipt.review.roleProfile !== releaseEvidence.review.roleProfile
    || receipt.review.profileManifestSha256 !== releaseEvidence.review.profileManifestSha256
    || receipt.review.effectiveConfigSha256 !== releaseEvidence.review.effectiveConfigSha256
    || receipt.review.toolInventorySha256 !== releaseEvidence.review.toolInventorySha256
    || receipt.review.reviewedAtUtc !== releaseEvidence.review.reviewedAtUtc
    || receipt.review.evidenceSha256 !== input.evidenceDocuments.releaseBodySha256
  ) {
    throw new Error("Factory receipt does not hash-bind the exact independent-review document");
  }
  if (
    validationEvidence.paperclip.validatorRunId !== releaseEvidence.run.validatorRunId
    || validationEvidence.paperclip.workspaceId !== releaseEvidence.run.workspaceId
    || releaseEvidence.bindings.validationEvidenceSha256
      !== input.evidenceDocuments.validationBodySha256
    || releaseEvidence.bindings.envelopeSha256
      !== validationEvidence.bindings.envelopeSha256
    || releaseEvidence.bindings.validationReceiptSha256
      !== validationEvidence.bindings.validationReceiptSha256
    || releaseEvidence.bindings.contextReceiptSha256
      !== validationEvidence.bindings.contextReceiptSha256
    || releaseEvidence.bindings.candidateSnapshotSha256
      !== validationEvidence.candidate.snapshotSha256
    || releaseEvidence.bindings.headBeforeReleaseSha
      !== validationEvidence.candidate.headSha
    || receipt.repository.baseSha !== validationEvidence.candidate.baseSha
    || receipt.repository.headBeforeReleaseSha !== validationEvidence.candidate.headSha
    || receipt.repository.candidateSnapshotSha256
      !== validationEvidence.candidate.snapshotSha256
  ) {
    throw new Error("Validator, Reviewer, and receipt hashes do not bind one exact candidate");
  }
  equalJson(
    validationEvidence.candidate.changedPaths,
    releaseEvidence.bindings.changedPaths,
    "Validator and Reviewer changed paths",
  );
  equalJson(
    validationEvidence.candidate.changedPaths,
    receipt.repository.changedPaths,
    "Validator and receipt changed paths",
  );
  const validationCommands = receipt.commands.filter((command) => command.stage === "validation");
  const commandHashes = validationCommands.map((command) => ({
    id: command.id,
    commandSha256: canonicalSha256(command),
  }));
  equalJson(commandHashes, validationEvidence.commands, "Validator command hashes");
  if (
    validationEvidence.validation.commandCount !== validationCommands.length
    || validationEvidence.validation.passedCommandCount !== validationCommands.length
  ) {
    throw new Error("Validator-authored command counts do not match the receipt");
  }
  equalJson(receipt.approvals, releaseEvidence.approvals, "Reviewer approval set");
  for (const key of [
    "retryCount",
    "deferralCount",
    "inputTokens",
    "outputTokens",
    "billedCents",
    "hostPressure",
    "backendLatencyMs",
    "caller",
  ] as const) {
    if (receipt.metrics[key] !== releaseEvidence.metrics[key]) {
      throw new Error(`Reviewer evidence metric ${key} does not match the receipt`);
    }
  }
  const statusById = new Map(input.issueStatuses.map((issue) => [issue.id, issue.status]));
  for (const issueId of [
    input.mapping.buildIssueId,
    input.mapping.validateIssueId,
    input.mapping.reviewIssueId,
    input.mapping.releaseIssueId,
  ]) {
    if (statusById.get(issueId) !== "done") {
      throw new Error(`Factory receipt stage is not done in Paperclip: ${issueId}`);
    }
  }
  const runTime = (run: {
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
  }) => {
    const candidate = run.startedAt ?? run.createdAt;
    const timestamp = Date.parse(candidate);
    if (!Number.isFinite(timestamp)) throw new Error("Paperclip run timestamp is invalid");
    return timestamp;
  };
  const currentSuccessfulRun = (
    issueId: string,
    agentId: string,
    stage: string,
    expectedRunId?: string,
  ) => {
    const activeForIssue = (input.activeRuns ?? []).filter((run) => run.issueId === issueId);
    if (activeForIssue.length > 0) {
      throw new Error(
        stage === "release"
          ? "Factory release-stage run is active or queued"
          : `Factory ${stage} stage has an active or queued Paperclip run`,
      );
    }
    const runs = input.runs
      .filter((run) => run.issueId === issueId)
      .sort((left, right) => (
        runTime(right) - runTime(left)
        || right.id.localeCompare(left.id)
      ));
    const current = runs[0];
    if (
      stage === "release"
      && current
      && current.id === expectedRunId
      && ["pending", "queued", "running"].includes(current.status)
    ) {
      throw new Error("Factory release-stage run is active or queued");
    }
    if (
      !current
      || current.agentId !== agentId
      || current.status !== "succeeded"
      || (expectedRunId && current.id !== expectedRunId)
    ) {
      throw new Error(
        stage === "release"
          ? "Factory receipt run is not the current successful configured release-stage run"
          : `Factory ${stage} stage current Paperclip run is not the required successful run`,
      );
    }
    if (!current.startedAt || !current.finishedAt) {
      throw new Error(`Factory ${stage} stage successful run has incomplete timestamps`);
    }
    return current;
  };
  const validatorRun = currentSuccessfulRun(
    input.mapping.validateIssueId,
    input.agents.validatorAgentId,
    "validator",
    validationEvidence.paperclip.validatorRunId,
  );
  const reviewerRun = currentSuccessfulRun(
    input.mapping.reviewIssueId,
    input.agents.reviewerAgentId,
    "independent reviewer",
    releaseEvidence.review.reviewerRunId,
  );
  const builderRun = currentSuccessfulRun(
    input.mapping.buildIssueId,
    input.agents.builderAgentId,
    "builder",
    releaseEvidence.run.paperclipRunId,
  );
  const releaseRun = currentSuccessfulRun(
    input.mapping.releaseIssueId,
    input.agents.integratorAgentId,
    "release",
  );
  if (
    new Set([
      builderRun.agentId,
      validatorRun.agentId,
      reviewerRun.agentId,
      releaseRun.agentId,
    ]).size !== 4
    || new Set([
      builderRun.id,
      validatorRun.id,
      reviewerRun.id,
      releaseRun.id,
    ]).size !== 4
  ) {
    throw new Error("Builder, Validator, Reviewer, and Integrator must be distinct agents and runs");
  }

  const builderStarted = Date.parse(builderRun.startedAt!);
  const builderFinished = Date.parse(builderRun.finishedAt!);
  const validatorStarted = Date.parse(validatorRun.startedAt!);
  const validatorFinished = Date.parse(validatorRun.finishedAt!);
  const reviewerStarted = Date.parse(reviewerRun.startedAt!);
  const reviewerFinished = Date.parse(reviewerRun.finishedAt!);
  const releaseStarted = Date.parse(releaseRun.startedAt!);
  const releaseFinished = Date.parse(releaseRun.finishedAt!);
  const reviewRecordedAt = Date.parse(releaseEvidence.review.reviewedAtUtc);
  const validationGeneratedAt = Date.parse(validationEvidence.generatedAtUtc);
  const receiptReleaseFinishedAt = Date.parse(receipt.release.finishedAtUtc);
  const receiptFreshnessAt = Date.parse(receipt.metrics.freshnessAtUtc);
  const validationStarted = Math.min(
    Date.parse(validationEvidence.validation.startedAtUtc),
    ...validationCommands.map((command) => Date.parse(command.startedAtUtc)),
  );
  const validationFinished = Math.max(
    Date.parse(validationEvidence.validation.finishedAtUtc),
    ...validationCommands.map((command) => Date.parse(command.finishedAtUtc)),
  );
  if (
    ![
      builderStarted,
      builderFinished,
      validatorStarted,
      validatorFinished,
      reviewerStarted,
      reviewerFinished,
      releaseStarted,
      releaseFinished,
      reviewRecordedAt,
      validationGeneratedAt,
      receiptReleaseFinishedAt,
      receiptFreshnessAt,
      validationStarted,
      validationFinished,
      input.evidenceDocuments.validationUpdatedAtMs,
      input.evidenceDocuments.releaseUpdatedAtMs,
      input.evidenceDocuments.receiptUpdatedAtMs,
    ].every(Number.isFinite)
    || builderStarted > builderFinished
    || Date.parse(releaseEvidence.run.startedAtUtc) !== builderStarted
    || Date.parse(releaseEvidence.run.finishedAtUtc) !== builderFinished
    || Date.parse(receipt.run.startedAtUtc) !== builderStarted
    || Date.parse(receipt.run.finishedAtUtc) !== builderFinished
    || builderFinished > validatorStarted
    || validatorStarted > validationStarted
    || validatorFinished < validationFinished
    || validationGeneratedAt < validationFinished
    || validationGeneratedAt > validatorFinished
    || input.evidenceDocuments.validationUpdatedAtMs < validationGeneratedAt
    || input.evidenceDocuments.validationUpdatedAtMs > validatorFinished
  ) {
    throw new Error(
      "Factory Builder and current Validator chronology does not enclose exact authored validation",
    );
  }
  if (
    reviewerStarted < validatorFinished
    || reviewRecordedAt < reviewerStarted
    || reviewRecordedAt > reviewerFinished
    || reviewRecordedAt < validationFinished
    || input.evidenceDocuments.releaseUpdatedAtMs < reviewRecordedAt
    || input.evidenceDocuments.releaseUpdatedAtMs > reviewerFinished
  ) {
    throw new Error(
      "Factory independent reviewer run is not fresh for the validated candidate",
    );
  }
  if (
    releaseStarted < reviewerFinished
    || Date.parse(input.receipt.release.startedAtUtc) < releaseStarted
    || receiptReleaseFinishedAt > releaseFinished
    || receiptFreshnessAt < receiptReleaseFinishedAt
    || receiptFreshnessAt > input.evidenceDocuments.receiptUpdatedAtMs
    || input.evidenceDocuments.receiptUpdatedAtMs < receiptReleaseFinishedAt
    || input.evidenceDocuments.receiptUpdatedAtMs > releaseFinished
  ) {
    throw new Error("Factory receipt is not time-bound to the current release-stage run");
  }
  if (input.openDecisionCount > 0) {
    throw new Error("Factory receipt cannot complete while Paperclip decisions or execution blocks remain open");
  }
}

interface PaperclipDocumentRevisionPayload {
  id?: unknown;
  revisionNumber?: unknown;
  createdByAgentId?: unknown;
  createdByRunId?: unknown;
}

async function latestEvidenceRevision(
  ctx: PluginContext,
  companyId: string,
  issueId: string,
  key: string,
): Promise<LatestEvidenceRevision> {
  const url = `${FACTORY_PAPERCLIP_BASE_URL}/api/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions`;
  const response = await scopedHostFetch(ctx, companyId, url);
  if (!response.ok) {
    throw new Error(`Paperclip evidence revision readback failed (${response.status})`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    throw new Error("Paperclip evidence revision readback is not an array");
  }
  const revisions = payload.filter((value): value is PaperclipDocumentRevisionPayload => (
    typeof value === "object" && value !== null && !Array.isArray(value)
  ));
  const latest = revisions
    .filter((value) => Number.isInteger(value.revisionNumber))
    .sort((left, right) => Number(left.revisionNumber) - Number(right.revisionNumber))
    .at(-1);
  if (!latest || typeof latest.id !== "string") {
    throw new Error("Paperclip evidence revision readback has no latest revision");
  }
  return {
    id: latest.id,
    revisionNumber: Number(latest.revisionNumber),
    createdByAgentId: typeof latest.createdByAgentId === "string" ? latest.createdByAgentId : null,
    createdByRunId: typeof latest.createdByRunId === "string" ? latest.createdByRunId : null,
  };
}

async function validateReceiptForMapping(
  ctx: PluginContext,
  config: BridgeConfig,
  mapping: BridgeMapping,
  receiptInput: unknown,
) {
  if (mapping.company_id !== config.companyId) {
    throw new Error("Factory receipt mapping does not belong to the authorized company");
  }
  const envelope = mapping.envelope as MckDispatch;
  const repositorySlug = envelope.version === 2
    ? envelope.factory_contract.repository.slug
    : `${envelope.task.github_source.repo_owner}/${envelope.task.github_source.repo_name}`;
  const expectedReceipt = {
    envelopeId: envelope.version === 2
      ? envelope.factory_contract.envelope_id
      : `factory:${mapping.attempt_id}`,
    correlationId: mapping.correlation_id,
    taskRevision: mapping.task_revision,
    repositorySlug,
    repositoryBaseSha: envelope.version === 2
      ? envelope.factory_contract.repository.base_sha
      : receiptInput && typeof receiptInput === "object" && "repository" in receiptInput
        ? String((receiptInput as { repository?: { baseSha?: unknown } }).repository?.baseSha ?? "")
        : "",
    allowedFileScope: envelope.version === 2
      ? envelope.factory_contract.repository.allowed_file_scope
      : undefined,
  };
  if (
    !mapping.parent_issue_id
    || !mapping.build_issue_id
    || !mapping.validate_issue_id
    || !mapping.review_issue_id
    || !mapping.release_issue_id
  ) {
    throw new Error("Factory receipt cannot be accepted before the mapped execution graph is complete");
  }
  const [
    orchestration,
    subtree,
    receiptDocument,
    validationDocument,
    releaseDocument,
  ] = await Promise.all([
    ctx.issues.summaries.getOrchestration({
      issueId: mapping.parent_issue_id,
      companyId: config.companyId,
      includeSubtree: true,
      billingCode: `mck:${mapping.correlation_id}`,
    }),
    ctx.issues.getSubtree(mapping.parent_issue_id, config.companyId, {
      includeRoot: true,
      includeActiveRuns: true,
    }),
    ctx.issues.documents.get(
      mapping.release_issue_id,
      "factory-run-receipt",
      config.companyId,
    ),
    ctx.issues.documents.get(
      mapping.validate_issue_id,
      "factory-validation-evidence",
      config.companyId,
    ),
    ctx.issues.documents.get(
      mapping.review_issue_id,
      "factory-release-evidence",
      config.companyId,
    ),
  ]);
  const [receiptRevision, validationRevision, releaseRevision] = await Promise.all([
    latestEvidenceRevision(ctx, config.companyId, mapping.release_issue_id, "factory-run-receipt"),
    latestEvidenceRevision(ctx, config.companyId, mapping.validate_issue_id, "factory-validation-evidence"),
    latestEvidenceRevision(ctx, config.companyId, mapping.review_issue_id, "factory-release-evidence"),
  ]);
  const receiptReadback = parseEvidenceDocument(receiptDocument, {
    companyId: config.companyId,
    issueId: mapping.release_issue_id,
    key: "factory-run-receipt",
    agentId: config.integratorAgentId,
    latestRevision: receiptRevision,
    parse: (value) => validateReceipt(value, expectedReceipt),
  });
  assertEvidenceRevisionRun(
    receiptReadback,
    receiptReadback.evidence.run.paperclipRunId,
    "Factory run receipt",
  );
  if (canonicalJson(receiptInput) !== canonicalJson(receiptReadback.evidence)) {
    throw new Error("Completion input is not the exact latest Integrator-authored receipt document");
  }
  const validationReadback = parseEvidenceDocument(validationDocument, {
    companyId: config.companyId,
    issueId: mapping.validate_issue_id,
    key: "factory-validation-evidence",
    agentId: config.validatorAgentId,
    latestRevision: validationRevision,
    parse: parseFactoryValidationEvidence,
  });
  assertEvidenceRevisionRun(
    validationReadback,
    validationReadback.evidence.paperclip.validatorRunId,
    "Factory validation evidence",
  );
  const releaseReadback = parseEvidenceDocument(releaseDocument, {
    companyId: config.companyId,
    issueId: mapping.review_issue_id,
    key: "factory-release-evidence",
    agentId: config.reviewerAgentId,
    latestRevision: releaseRevision,
    parse: parseFactoryReleaseEvidence,
  });
  assertEvidenceRevisionRun(
    releaseReadback,
    releaseReadback.evidence.review.reviewerRunId,
    "Factory release evidence",
  );
  const receipt = receiptReadback.evidence;
  assertPaperclipCompletionEvidence({
    receipt,
    validationEvidence: validationReadback.evidence,
    releaseEvidence: releaseReadback.evidence,
    evidenceDocuments: {
      validationBodySha256: validationReadback.bodySha256,
      validationUpdatedAtMs: validationReadback.updatedAtMs,
      releaseBodySha256: releaseReadback.bodySha256,
      releaseUpdatedAtMs: releaseReadback.updatedAtMs,
      receiptUpdatedAtMs: receiptReadback.updatedAtMs,
    },
    companyId: config.companyId,
    projectId: config.projectId,
    mapping: {
      rootIssueId: mapping.parent_issue_id,
      buildIssueId: mapping.build_issue_id,
      validateIssueId: mapping.validate_issue_id,
      reviewIssueId: mapping.review_issue_id,
      releaseIssueId: mapping.release_issue_id,
    },
    agents: {
      builderAgentId: config.builderAgentId,
      validatorAgentId: config.validatorAgentId,
      reviewerAgentId: config.reviewerAgentId,
      integratorAgentId: config.integratorAgentId,
    },
    issueStatuses: subtree.issues,
    runs: orchestration.runs,
    activeRuns: Object.values(subtree.activeRuns ?? {}).flat(),
    openDecisionCount:
      orchestration.approvals.filter((approval) => approval.status === "pending").length
      + orchestration.openBudgetIncidents.length
      + orchestration.invocationBlocks.length,
  });
  return receipt;
}

export function sourceLifecycleOccurrenceIdentity(event: Pick<
  PluginEvent,
  "eventId" | "eventType" | "entityId" | "payload"
>) {
  const payload = (
    typeof event.payload === "object"
    && event.payload !== null
    && !Array.isArray(event.payload)
  ) ? event.payload as Record<string, unknown> : {};
  const runId = typeof payload.runId === "string" ? payload.runId : "no-run";
  return [
    event.eventType,
    `issue:${event.entityId ?? "unknown"}`,
    `run:${runId}`,
    `event:${event.eventId}`,
  ].join(":");
}

async function publishFromIssueEvent(ctx: PluginContext, event: PluginEvent) {
  if (!event.entityId) return;
  const config = await readConfig(ctx, event.companyId);
  const mapping = await mappingForIssue(ctx, config.companyId, event.entityId);
  if (!mapping) return;
  const issue = await ctx.issues.get(event.entityId, config.companyId);
  if (!issue) return;
  const occurrenceIdentity = sourceLifecycleOccurrenceIdentity(event);
  if (issue.status === "cancelled") {
    await publishLifecycle(
      ctx,
      config,
      mapping,
      "cancelled",
      `${issue.title} was cancelled`,
      undefined,
      { occurrenceIdentity },
    );
    return;
  }
  if (issue.status === "blocked") {
    await publishLifecycle(
      ctx,
      config,
      mapping,
      "blocked",
      `${issue.title} is blocked and needs operator-visible evidence`,
      undefined,
      { occurrenceIdentity },
    );
    return;
  }
  if (event.entityId === mapping.validate_issue_id && issue.status === "in_progress") {
    await publishLifecycle(
      ctx,
      config,
      mapping,
      "testing",
      "Deterministic validator started",
      undefined,
      { occurrenceIdentity },
    );
    return;
  }
  if (event.entityId === mapping.review_issue_id && (issue.status === "in_progress" || issue.status === "in_review")) {
    await publishLifecycle(
      ctx,
      config,
      mapping,
      "review",
      "Independent review started",
      undefined,
      { occurrenceIdentity },
    );
    return;
  }
  if (event.entityId === mapping.release_issue_id && issue.status === "done") {
    const receiptDocument = await ctx.issues.documents.get(issue.id, "factory-run-receipt", config.companyId);
    if (!receiptDocument) {
      await publishLifecycle(
        ctx,
        config,
        mapping,
        "needs_human",
        "Release finished without factory-run-receipt.v1",
        undefined,
        { occurrenceIdentity },
      );
      return;
    }
    let receipt: unknown;
    try {
      receipt = JSON.parse(receiptDocument.body);
    } catch {
      await publishLifecycle(
        ctx,
        config,
        mapping,
        "needs_human",
        "Release receipt document is not valid JSON",
        undefined,
        { occurrenceIdentity },
      );
      return;
    }
    let validatedReceipt: FactoryReceipt;
    try {
      validatedReceipt = await validateReceiptForMapping(ctx, config, mapping, receipt);
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error);
      if (validationError.includes("release-stage run is active")) {
        ctx.logger.info("Release receipt completion is deferred until the release run finishes", {
          correlationId: mapping.correlation_id,
          releaseIssueId: mapping.release_issue_id,
        });
        return;
      }
      await publishLifecycle(
        ctx,
        config,
        mapping,
        "needs_human",
        `Release receipt failed validation: ${String(redactDiagnostic(error instanceof Error ? error.message : error))}`,
        undefined,
        { occurrenceIdentity },
      );
      return;
    }
    if (mapping.parent_issue_id) {
      await ctx.issues.update(mapping.parent_issue_id, { status: "done" }, config.companyId);
    }
    await publishLifecycle(
      ctx,
      config,
      mapping,
      "completed",
      "Validation, candidate snapshot, independent review, commit, push, and remote readback are proven",
      validatedReceipt,
      { occurrenceIdentity },
    );
    return;
  }
  if (issue.status === "done") {
    const issueIds: Record<StageKey, string | null> = {
      plan: mapping.plan_issue_id,
      build: mapping.build_issue_id,
      validate: mapping.validate_issue_id,
      review: mapping.review_issue_id,
      release: mapping.release_issue_id,
    };
    const stageIndex = STAGE_KEYS.findIndex((stage) => issueIds[stage] === event.entityId);
    const nextStage = stageIndex >= 0 ? STAGE_KEYS[stageIndex + 1] : undefined;
    const nextIssueId = nextStage ? issueIds[nextStage] : null;
    if (nextStage && nextIssueId) {
      await ctx.issues.requestWakeup(nextIssueId, config.companyId, {
        reason: `plugin:mck_stage_${nextStage}_ready`,
        contextSource: PLUGIN_ID,
        idempotencyKey: `${mapping.correlation_id}:${nextStage}`,
      });
    }
  }
}

export async function reconcileLifecycleDeliveries(
  ctx: PluginContext,
  authorizedCompanyId: string,
) {
  const config = await readConfig(ctx, authorizedCompanyId);
  const deliveries = await ctx.db.query<LifecycleDeliveryRow>(
      `SELECT company_id, delivery_key, correlation_id, delivery_id, callback_url, payload, raw_body,
              payload_hash, status, attempt_count, mck_lease_generation,
              outcome_delivery_id, outcome_url, outcome_raw_body, outcome_payload_hash,
              outcome_status, outcome_attempt_count, outcome_lease_generation
       FROM ${table(ctx, "lifecycle_deliveries")}
       WHERE company_id = $2
         AND (
           (
             attempt_count < $1
             AND (
                status IN ('pending', 'failed')
                OR (
                  status = 'sending'
                  AND COALESCE(mck_lease_started_at, updated_at) < now() - interval '5 minutes'
                )
             )
           )
           OR (
             outcome_attempt_count < $1
             AND (
                outcome_status IN ('pending', 'failed')
                OR (
                  outcome_status = 'sending'
                  AND COALESCE(outcome_lease_started_at, updated_at) < now() - interval '5 minutes'
                )
             )
           )
         )
       ORDER BY updated_at ASC
       LIMIT 20`,
      [MAX_LIFECYCLE_DELIVERY_ATTEMPTS, config.companyId],
    );
  let delivered = 0;
  let failed = 0;
  for (const row of deliveries) {
    let delivery: LifecycleDelivery;
    try {
      delivery = hydrateLifecycleDelivery(row);
    } catch (error) {
      failed += 1;
      ctx.logger.warn("Persisted lifecycle delivery is incomplete", {
        correlationId: row.correlation_id,
        deliveryKey: row.delivery_key,
        error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
      });
      continue;
    }
    const callbackEligible = (
      delivery.attemptCount < MAX_LIFECYCLE_DELIVERY_ATTEMPTS
      && ["pending", "failed", "sending"].includes(delivery.status)
    );
    const outcomeEligible = (
      delivery.outcomeAttemptCount < MAX_LIFECYCLE_DELIVERY_ATTEMPTS
      && ["pending", "failed", "sending"].includes(delivery.outcomeStatus)
    );
    if (callbackEligible) {
      try {
        await sendLifecycleDelivery(ctx, config, delivery);
        delivered += 1;
      } catch (error) {
        failed += 1;
        ctx.logger.warn("MCK lifecycle reconciliation attempt failed", {
          correlationId: delivery.correlationId,
          deliveryKey: delivery.deliveryKey,
          callbackAttemptCount: delivery.attemptCount,
          error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
        });
      }
    }
    if (outcomeEligible) {
      try {
        await sendMissionControlOutcome(ctx, config, delivery);
        delivered += 1;
      } catch (error) {
        failed += 1;
        ctx.logger.warn("Mission Control outcome reconciliation attempt failed", {
          correlationId: delivery.correlationId,
          deliveryKey: delivery.deliveryKey,
          outcomeAttemptCount: delivery.outcomeAttemptCount,
          error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
        });
      }
    }
  }
  await ctx.metrics.write("lifecycle.reconciliation", delivered, {
    failed: String(failed),
    inspected: String(deliveries.length),
  });
  return { inspected: deliveries.length, delivered, failed };
}

async function bridgeSummary(
  ctx: PluginContext,
  authorizedCompanyId: string,
  issueId?: string,
) {
  const config = await readConfig(ctx, authorizedCompanyId);
  const scopeCompanyId = config.companyId;
  const mappingRowsPromise = issueId
    ? ctx.db.query<BridgeMapping>(
      `SELECT * FROM ${table(ctx, "bridge_mappings")}
       WHERE company_id = $1
         AND (
           parent_issue_id = $2 OR plan_issue_id = $2 OR build_issue_id = $2
           OR validate_issue_id = $2 OR review_issue_id = $2 OR release_issue_id = $2
         )
       LIMIT 1`,
      [scopeCompanyId, issueId],
    )
    : ctx.db.query<BridgeMapping>(
      `SELECT * FROM ${table(ctx, "bridge_mappings")}
       WHERE company_id = $1
       ORDER BY updated_at DESC
       LIMIT 10`,
      [scopeCompanyId],
    );
  const [
    countRows,
    deliveryRows,
    lifecycleFailureRows,
    rows,
  ] = await Promise.all([
    ctx.db.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM ${table(ctx, "bridge_mappings")}
       WHERE company_id = $1`,
      [scopeCompanyId],
    ),
    ctx.db.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM ${table(ctx, "bridge_deliveries")}
       WHERE company_id = $1 AND status = 'failed'`,
      [scopeCompanyId],
    ),
    ctx.db.query<{ count: number; exhausted: number }>(
      `SELECT
         count(*) FILTER (
           WHERE status = 'failed' OR outcome_status = 'failed'
         )::integer AS count,
         count(*) FILTER (
           WHERE (status <> 'sent' AND attempt_count >= $1)
              OR (
                outcome_status NOT IN ('sent', 'skipped')
                AND outcome_attempt_count >= $1
              )
         )::integer AS exhausted
       FROM ${table(ctx, "lifecycle_deliveries")}
       WHERE company_id = $2`,
      [MAX_LIFECYCLE_DELIVERY_ATTEMPTS, scopeCompanyId],
    ),
    mappingRowsPromise,
  ]);
  const summarizedRows = await Promise.all(rows.map(async (row) => {
    let orchestration: Awaited<ReturnType<typeof ctx.issues.summaries.getOrchestration>> | null = null;
    let stageStatuses: Record<string, string | null> = {};
    if (row.parent_issue_id) {
      try {
        const [summary, subtree] = await Promise.all([
          ctx.issues.summaries.getOrchestration({
            issueId: row.parent_issue_id,
            companyId: scopeCompanyId,
            includeSubtree: true,
            billingCode: `mck:${row.correlation_id}`,
          }),
          ctx.issues.getSubtree(row.parent_issue_id, scopeCompanyId, {
            includeRoot: true,
            includeActiveRuns: true,
          }),
        ]);
        orchestration = summary;
        const statusById = new Map(subtree.issues.map((issue) => [issue.id, issue.status]));
        stageStatuses = {
          parent: statusById.get(row.parent_issue_id) ?? null,
          plan: row.plan_issue_id ? statusById.get(row.plan_issue_id) ?? null : null,
          build: row.build_issue_id ? statusById.get(row.build_issue_id) ?? null : null,
          validate: row.validate_issue_id ? statusById.get(row.validate_issue_id) ?? null : null,
          review: row.review_issue_id ? statusById.get(row.review_issue_id) ?? null : null,
          release: row.release_issue_id ? statusById.get(row.release_issue_id) ?? null : null,
        };
      } catch (error) {
        ctx.logger.warn("MCK bridge orchestration summary is temporarily unavailable", {
          correlationId: row.correlation_id,
          error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
        });
      }
    }
    const runs = orchestration?.runs ?? [];
    const pendingApprovals = (orchestration?.approvals ?? []).filter((approval) => approval.status === "pending");
    return {
      correlationId: row.correlation_id,
      mckTaskId: row.mck_task_id,
      attemptId: row.attempt_id,
      parentIssueId: row.parent_issue_id,
      stages: {
        plan: row.plan_issue_id,
        build: row.build_issue_id,
        validate: row.validate_issue_id,
        review: row.review_issue_id,
        release: row.release_issue_id,
      },
      stageStatuses,
      intakeStatus: row.intake_status,
      lifecycleStatus: row.lifecycle_status,
      receiptId: row.receipt_id,
      runMetrics: {
        runCount: runs.length,
        activeRunCount: runs.filter((run) => ["queued", "running"].includes(run.status)).length,
        latestRun: runs.at(-1) ?? null,
        costCents: orchestration?.costs.costCents ?? 0,
        inputTokens: orchestration?.costs.inputTokens ?? 0,
        cachedInputTokens: orchestration?.costs.cachedInputTokens ?? 0,
        outputTokens: orchestration?.costs.outputTokens ?? 0,
      },
      pendingDecisions: {
        approvals: pendingApprovals,
        budgetIncidents: orchestration?.openBudgetIncidents ?? [],
        invocationBlocks: orchestration?.invocationBlocks ?? [],
        count: pendingApprovals.length
          + (orchestration?.openBudgetIncidents.length ?? 0)
          + (orchestration?.invocationBlocks.length ?? 0),
      },
      lastError: row.last_error,
      updatedAt: row.updated_at,
    };
  }));
  const failedDeliveries = Number(deliveryRows[0]?.count ?? 0);
  const failedLifecycleDeliveries = Number(lifecycleFailureRows[0]?.count ?? 0);
  const exhaustedLifecycleDeliveries = Number(lifecycleFailureRows[0]?.exhausted ?? 0);
  return redactDiagnostic({
    status: failedDeliveries + failedLifecycleDeliveries + exhaustedLifecycleDeliveries > 0 ? "degraded" : "ok",
    checkedAt: new Date().toISOString(),
    companyId: scopeCompanyId,
    mappings: Number(countRows[0]?.count ?? 0),
    failedDeliveries,
    failedLifecycleDeliveries,
    exhaustedLifecycleDeliveries,
    rows: summarizedRows,
  });
}

const plugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.jobs.register(JOB_RECONCILE_LIFECYCLE, async () => {
      for (const companyId of [...configuredCompanyIds].sort()) {
        await reconcileLifecycleDeliveries(ctx, companyId);
      }
    });
    ctx.data.register("bridge-summary", async (params) => {
      const authorizedCompanyId = nonEmpty(
        params.companyId,
        "authorized bridge-summary companyId",
      );
      return bridgeSummary(
        ctx,
        authorizedCompanyId,
        typeof params.issueId === "string" ? params.issueId : undefined,
      );
    });
    ctx.tools.register(
      TOOL_REPORT_LIFECYCLE,
      {
        displayName: "Report MCK Factory Lifecycle",
        description: "Publishes a signed lifecycle state to MCK and Mission Control.",
        parametersSchema: {
          type: "object",
          required: ["correlation_id", "status", "summary"],
          properties: {
            correlation_id: { type: "string" },
            status: { type: "string" },
            summary: { type: "string" },
            receipt: { type: "object" },
          },
        },
      },
      async (params, runContext): Promise<ToolResult> => {
        const input = params as Record<string, unknown>;
        const correlationId = nonEmpty(input.correlation_id, "correlation_id");
        const status = nonEmpty(input.status, "status") as LifecycleStatus;
        const supported = new Set<LifecycleStatus>([
          "testing", "review", "completed", "blocked", "needs_human", "failed", "cancelled",
        ]);
        if (!supported.has(status)) return { error: `Unsupported lifecycle status: ${status}` };
        const summary = nonEmpty(input.summary, "summary");
        const config = await readConfig(ctx, runContext.companyId);
        const mapping = await getMapping(ctx, config.companyId, correlationId);
        if (!mapping) return { error: `No MCK mapping found for ${correlationId}` };
        const result = await publishLifecycle(
          ctx,
          config,
          mapping,
          status,
          summary,
          input.receipt,
        );
        return { content: `Lifecycle ${status} published for ${correlationId}`, data: result };
      },
    );
    ctx.events.on("issue.updated", async (event) => {
      try {
        await publishFromIssueEvent(ctx, event);
      } catch (error) {
        ctx.logger.error("Issue lifecycle reconciliation failed", {
          issueId: event.entityId,
          error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
        });
      }
    });
    ctx.events.on("agent.run.finished", async (event) => {
      const payload = (
        typeof event.payload === "object"
        && event.payload !== null
        && !Array.isArray(event.payload)
      )
        ? event.payload as Record<string, unknown>
        : {};
      const issueId = typeof payload.issueId === "string" ? payload.issueId : null;
      if (!issueId) return;
      try {
        await publishFromIssueEvent(ctx, {
          ...event,
          entityId: issueId,
          entityType: "issue",
        });
      } catch (error) {
        ctx.logger.error("Finished-run lifecycle reconciliation failed", {
          issueId,
          runId: typeof payload.runId === "string" ? payload.runId : event.entityId,
          error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
        });
      }
    });
    ctx.logger.info("MCK factory bridge initialized", { pluginId: PLUGIN_ID });
  },

  async onValidateConfig(raw) {
    const required = [
      "companyId",
      "projectId",
      "directorAgentId",
      "builderAgentId",
      "validatorAgentId",
      "reviewerAgentId",
      "integratorAgentId",
    ];
    const errors = required.flatMap((key) => typeof raw[key] === "string" && raw[key].trim() ? [] : [`${key} is required`]);
    for (const key of [
      "dispatchSecretRef",
      "callbackSecretRef",
      "missionControlOutcomeSecretRef",
    ] as const) {
      try {
        secretRef(raw[key], key);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${key} must be a Paperclip secret_ref binding`);
      }
    }
    if (raw.allowedRepositoryOwner && raw.allowedRepositoryOwner !== "iMelki") {
      errors.push("allowedRepositoryOwner must remain iMelki");
    }
    const syncMode = raw.githubSyncMode === "disabled" ? "disabled" : "apply";
    try {
      missionControlBaseUrl(raw.missionControlBaseUrl, syncMode);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "missionControlBaseUrl is invalid");
    }
    const roleIds = [
      raw.directorAgentId,
      raw.builderAgentId,
      raw.validatorAgentId,
      raw.reviewerAgentId,
      raw.integratorAgentId,
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (roleIds.length === 5 && new Set(roleIds).size !== roleIds.length) {
      errors.push("Factory role agent IDs must be distinct");
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  },

  async onConfigChanged(raw, context) {
    const companyId = nonEmpty(context?.companyId, "company-scoped Paperclip configuration");
    const config = parseBridgeConfig(raw);
    if (config.companyId !== companyId) {
      throw new Error("Paperclip config companyId does not match the delivered company scope");
    }
    configuredCompanyIds.add(companyId);
  },

  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== WEBHOOK_ENDPOINT) throw new Error(`Unsupported webhook endpoint: ${input.endpointKey}`);
    const ctx = currentContext;
    if (!ctx) throw new Error("Bridge context is not ready");
    const config = await readConfig(ctx, input.companyId);
    const body = input.parsedBody ?? JSON.parse(input.rawBody);
    const requiresCanonicalDeliveryId = (
      typeof body === "object"
      && body !== null
      && !Array.isArray(body)
      && (body as { version?: unknown }).version === 2
    );
    const dispatchSecret = await ctx.secrets.resolve(config.dispatchSecretRef, {
      companyId: config.companyId,
      configPath: "dispatchSecretRef",
    });
    const verified = verifyMckSignature({
      rawBody: input.rawBody,
      headers: input.headers,
      secret: dispatchSecret,
      requireCanonicalDeliveryId: requiresCanonicalDeliveryId,
    });
    if (!verified.ok) throw new Error(`MCK signature rejected: ${verified.reason}`);
    const eventType = typeof body === "object" && body && "type" in body
      ? String((body as { type?: unknown }).type)
      : typeof body === "object" && body && "event" in body
        ? String((body as { event?: unknown }).event)
        : "unknown";
    const claimed = await claimDelivery(ctx, config.companyId, {
      deliveryId: verified.deliveryId,
      payloadHash: verified.payloadHash,
      eventType,
    });
    if (claimed.duplicate) {
      ctx.logger.info("Duplicate MCK delivery accepted idempotently", { deliveryId: verified.deliveryId });
      return;
    }
    const deliveryOwner = claimed.owner;
    if (eventType === "mck.ping") {
      if (
        typeof body !== "object"
        || !body
        || (body as { delivery_id?: unknown }).delivery_id !== verified.deliveryId
        || (body as { health_check?: unknown }).health_check !== true
      ) {
        await finishDelivery(
          ctx,
          config.companyId,
          verified.deliveryId,
          deliveryOwner,
          { status: "failed", error: "invalid_ping" },
        );
        throw new Error("Invalid MCK signed ping");
      }
      await finishDelivery(
        ctx,
        config.companyId,
        verified.deliveryId,
        deliveryOwner,
        { status: "processed" },
      );
      await ctx.metrics.write("ping.accepted", 1);
      return;
    }
    let correlationId: string | undefined;
    let mappingOwner: OwnerFence | null = null;
    try {
      const dispatch = parseDispatch(body, config.allowedRepositoryOwner);
      const dispatchIdentity = identity(dispatch, verified.deliveryId, input.rawBody);
      correlationId = dispatchIdentity.correlation_id;
      if (dispatch.version === 2 && dispatchIdentity.delivery_id !== verified.deliveryId) {
        throw new Error("Signed header delivery ID does not match dispatch.delivery_id");
      }
      const reservation = await reserveMapping(
        ctx,
        config.companyId,
        dispatch,
        dispatchIdentity,
      );
      mappingOwner = reservation.owner;
      const graph = reservation.createGraph
        ? await createExecutionGraph(ctx, config, dispatch, correlationId, input.rawBody)
        : reservation.graph;
      if (!graph) throw new Error("Reserved MCK mapping did not resolve an execution graph");
      if (reservation.createGraph) {
        if (!mappingOwner) throw new Error("Reserved MCK mapping is missing its owner fence");
        await completeMapping(ctx, config.companyId, correlationId, graph, mappingOwner);
      }
      try {
        await ctx.activity.log({
          companyId: config.companyId,
          entityType: "issue",
          entityId: graph.parent,
          message: reservation.createGraph
            ? `Accepted MCK task ${dispatch.task.id} into the sequential factory graph`
            : `Reused the existing sequential factory graph for MCK task ${dispatch.task.id}`,
          metadata: {
            correlationId,
            attemptId: dispatchIdentity.attempt_id,
            githubIssue: dispatch.task.github_source.issue_url,
            stages: graph,
          },
        });
      } catch (error) {
        ctx.logger.warn("MCK bridge activity publication was deferred", {
          correlationId,
          error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
        });
      }
      const mapping = await getMapping(ctx, config.companyId, correlationId);
      if (mapping) {
        const replay = reservation.createGraph
          ? { replayed: false as const }
          : await replayCurrentLifecycleForRedispatch(ctx, config, mapping);
        if (!replay.replayed) {
          await publishLifecycle(
            ctx,
            config,
            mapping,
            "started",
            "Paperclip accepted the dispatch and queued the plan stage",
            undefined,
            {
              deferMissionControl: true,
              occurrenceIdentity: `dispatch:${verified.deliveryId}:started`,
            },
          );
        }
      }
      await finishDelivery(
        ctx,
        config.companyId,
        verified.deliveryId,
        deliveryOwner,
        { status: "processed", correlationId },
      );
      try {
        await ctx.metrics.write("dispatch.accepted", 1, { version: String(dispatch.version) });
      } catch (error) {
        ctx.logger.warn("MCK bridge acceptance metric was deferred", {
          correlationId,
          error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
        });
      }
    } catch (error) {
      await finishDelivery(
        ctx,
        config.companyId,
        verified.deliveryId,
        deliveryOwner,
        { status: "failed", correlationId, error },
      );
      if (correlationId && mappingOwner) {
        await failMapping(ctx, config.companyId, correlationId, mappingOwner, error);
      }
      ctx.logger.error("MCK dispatch rejected", {
        deliveryId: verified.deliveryId,
        error: String(redactDiagnostic(error instanceof Error ? error.message : error)),
      });
      throw error;
    }
  },

  async onHealth() {
    const ctx = currentContext;
    if (!ctx) return { status: "error", message: "Bridge context is not initialized" };
    try {
      const companyIds = [...configuredCompanyIds].sort();
      if (companyIds.length === 0) {
        throw new Error("No company-scoped Paperclip configuration has been authorized");
      }
      // This hook has no authorized company context. Validate only the
      // already-authorized configurations; querying or aggregating tenant
      // state here would leak another company's health through status/timing.
      await Promise.all(companyIds.map((companyId) => readConfig(ctx, companyId)));
      return {
        status: "ok",
        message: "MCK factory bridge worker is running",
        details: {
          checkedAt: new Date().toISOString(),
          scope: "configuration-only; use company-scoped diagnostics for runtime state",
        },
      };
    } catch (error) {
      return {
        status: "error",
        message: "MCK factory bridge configuration is incomplete",
        details: { error: redactDiagnostic(error instanceof Error ? error.message : error) },
      };
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
