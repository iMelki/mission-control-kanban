import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import {
  definePlugin,
  startWorkerRpcHost,
  type WorkerRpcHost,
} from "@paperclipai/plugin-sdk";
import type { JsonRpcRequest, JsonRpcResponse } from "@paperclipai/plugin-sdk/protocol";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin, {
  assertPaperclipCompletionEvidence,
  buildLifecycleDeliveryKey,
  claimDelivery,
  completeMapping,
  createExecutionGraph,
  failMapping,
  finishDelivery,
  publishLifecycle,
  publishMissionControlOutcome,
  reconcileLifecycleDeliveries,
  reserveMapping,
  replayCurrentLifecycleForRedispatch,
  sourceLifecycleOccurrenceIdentity,
  type BridgeConfig,
  type BridgeMapping,
} from "../src/worker.js";
import {
  assertSuccessfulPublication,
  assertCorrelationRevision,
  parseDispatch,
  redactDiagnostic,
  signMissionControlOutcome,
  validateReceipt,
  verifyMckSignature,
  type MckDispatchV2,
} from "../src/contracts.js";
import {
  canonicalSha256,
  parseEvidenceDocument,
  parseFactoryReleaseEvidence,
  parseFactoryValidationEvidence,
  prefixedSha256,
} from "../src/evidence.js";
import {
  factoryChangedPathsMatchScope,
  factoryPathValidationError,
} from "../src/factory-paths.js";
import { buildStageDefinitions } from "../src/graph.js";
import { scopedHostFetch } from "../src/host-http.js";

function createRpcTransport() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const messages: Array<JsonRpcRequest | JsonRpcResponse> = [];
  const waiters = new Set<() => void>();
  let buffer = "";

  stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) messages.push(JSON.parse(line));
      for (const wake of waiters) wake();
      waiters.clear();
    }
  });

  const send = (message: unknown) => {
    stdin.write(`${JSON.stringify(message)}\n`);
  };
  const next = async (
    predicate: (message: JsonRpcRequest | JsonRpcResponse) => boolean,
  ): Promise<JsonRpcRequest | JsonRpcResponse> => {
    for (;;) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0]!;
      await new Promise<void>((resolve) => waiters.add(resolve));
    }
  };

  return { stdin, stdout, send, next };
}

function dispatchV2(): MckDispatchV2 {
  return {
    event: "mck.task.dispatch",
    version: 2,
    dispatch: {
      attempt_id: "attempt-1",
      delivery_id: "delivery-1",
      correlation_id: "mck:default:task-1",
      task_revision: "a".repeat(64),
    },
    task: {
      id: "task-1",
      title: "Build bridge",
      description: "Implement it",
      priority: "high",
      github_source: {
        repo_owner: "iMelki",
        repo_name: "mission-control-kanban",
        issue_number: 47,
        issue_url: "https://github.com/iMelki/mission-control-kanban/issues/47",
      },
      dispatch_metadata: { readiness: "ready_for_agent" },
    },
    agent: {
      id: "agent-1",
      name: "Paperclip",
      role: "Factory",
      runtime_type: "webhook",
    },
    callbacks: { lifecycle: "http://127.0.0.1:3021/api/webhooks/agent-completion" },
    callback_urls: { lifecycle: "http://127.0.0.1:3021/api/webhooks/agent-completion" },
    mission_control_url: "http://127.0.0.1:3021",
    output_directory: "S:/source/CCAI/Assistants/tools/mission-control-kanban",
    prompt_markdown: "# Work",
    issued_at: new Date().toISOString(),
    factory_contract: {
      schema_version: "factory-task-envelope.v1",
      envelope_id: "factory:attempt-1",
      repository: {
        slug: "iMelki/mission-control-kanban",
        owner: "iMelki",
        name: "mission-control-kanban",
        active_branch: "dev",
        base_sha: "9".repeat(40),
        allowed_file_scope: ["src/**"],
      },
      acceptance_criteria: ["Bridge works"],
      test_requirements: ["npm test"],
      risk_level: "high",
      review_mode: "pair_review",
      impact: "Factory dispatch",
      rollback_plan: "Disable v2",
      safety_rules: [],
      limits: { max_repair_attempts: 2, concurrent_mutating_builders: 1 },
    },
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function persistedLifecycleRow(overrides: Record<string, unknown> = {}) {
  const lifecycleBody = JSON.stringify({
    schema_version: "2",
    type: "mck.callback.lifecycle",
    task_id: "task-1",
    attempt_id: "attempt-a",
    correlation_id: "mck:default:task-1",
    task_revision: "a".repeat(64),
    status: "blocked",
    occurred_at: "2026-07-29T12:00:00.000Z",
    summary: "Persisted A callback",
  });
  const outcomeBody = JSON.stringify({
    task_id: "task-1",
    event: "blocked",
    receipt_id: "outcome-a",
    summary: "Persisted A outcome",
    agent: "Paperclip",
    github_sync_mode: "apply",
  });
  return {
    company_id: "company-1",
    delivery_key: "attempt-a:blocked:state:occurrence-a",
    correlation_id: "mck:default:task-1",
    delivery_id: "delivery-a",
    callback_url: "http://127.0.0.1:3021/api/webhooks/agent-completion",
    payload: lifecycleBody,
    raw_body: lifecycleBody,
    payload_hash: sha256(lifecycleBody),
    status: "failed",
    attempt_count: 1,
    outcome_delivery_id: "outcome-a",
    outcome_url: "http://127.0.0.1:3001/api/webhooks/factory-runtime-outcomes",
    outcome_raw_body: outcomeBody,
    outcome_payload_hash: sha256(outcomeBody),
    outcome_status: "pending",
    outcome_attempt_count: 0,
    ...overrides,
  };
}

describe("MCK Paperclip bridge", () => {
  const dispatchSecretRef = {
    type: "secret_ref" as const,
    secretId: "11111111-1111-4111-8111-111111111111",
    version: "latest" as const,
  };
  const callbackSecretRef = {
    type: "secret_ref" as const,
    secretId: "22222222-2222-4222-8222-222222222222",
    version: "latest" as const,
  };
  const missionControlOutcomeSecretRef = {
    type: "secret_ref" as const,
    secretId: "33333333-3333-4333-8333-333333333333",
    version: "latest" as const,
  };

  function bridgeConfig(): BridgeConfig {
    return {
      companyId: "company-1",
      projectId: "project-1",
      dispatchSecretRef,
      callbackSecretRef,
      missionControlOutcomeSecretRef,
      missionControlBaseUrl: "http://127.0.0.1:3001",
      githubSyncMode: "apply" as const,
      allowedRepositoryOwner: "iMelki",
      directorAgentId: "director",
      builderAgentId: "builder",
      validatorAgentId: "validator",
      reviewerAgentId: "reviewer",
      integratorAgentId: "integrator",
    };
  }

  async function activateBridgeConfig(config: BridgeConfig = bridgeConfig()) {
    await plugin.definition.onConfigChanged?.({ ...config }, { companyId: config.companyId });
  }

  function bridgeMapping(): BridgeMapping {
    return {
      company_id: "company-1",
      correlation_id: "mck:default:task-1",
      mck_task_id: "task-1",
      attempt_id: "attempt-1",
      dispatch_version: 2,
      task_revision: "a".repeat(64),
      github_issue_url: "https://github.com/iMelki/mission-control-kanban/issues/47",
      callback_url: "http://127.0.0.1:3021/api/webhooks/agent-completion",
      envelope: dispatchV2(),
      parent_issue_id: "parent-issue",
      plan_issue_id: "plan-issue",
      build_issue_id: "build-issue",
      validate_issue_id: "validate-issue",
      review_issue_id: "review-issue",
      release_issue_id: "release-issue",
      intake_status: "accepted" as const,
      lifecycle_status: null,
      receipt_id: null,
      last_error: null,
      intake_generation: 1,
      intake_owner_token: "mapping-owner",
      intake_lease_started_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  it("declares the implemented webhook, orchestration, database, tool, and UI surfaces", () => {
    const parsed = pluginManifestV1Schema.parse(manifest);
    expect(parsed.id).toBe("imelki.mck-paperclip-bridge");
    expect(parsed.webhooks).toEqual([
      expect.objectContaining({ endpointKey: "mck-dispatch" }),
    ]);
    expect(parsed.database).toEqual(expect.objectContaining({ namespaceSlug: "mck_factory_bridge" }));
    expect(parsed.tools).toEqual([
      expect.objectContaining({ name: "report-lifecycle" }),
    ]);
    expect(parsed.jobs).toEqual([
      expect.objectContaining({ jobKey: "reconcile-lifecycle", schedule: "*/5 * * * *" }),
    ]);
    expect(parsed.instanceConfigSchema?.properties).toMatchObject({
      dispatchSecretRef: { format: "secret-ref" },
      callbackSecretRef: { format: "secret-ref" },
      missionControlOutcomeSecretRef: { format: "secret-ref" },
    });
    const configProperties = parsed.instanceConfigSchema?.properties as Record<string, unknown> | undefined;
    expect(configProperties?.dispatchSecretRef).not.toHaveProperty("type");
    expect(configProperties?.callbackSecretRef).not.toHaveProperty("type");
    expect(configProperties?.missionControlOutcomeSecretRef).not.toHaveProperty("type");
    expect(parsed.ui?.slots?.map((slot) => slot.type)).toEqual([
      "dashboardWidget",
      "taskDetailView",
      "settingsPage",
    ]);
  });

  it("pins an immutable owned SDK tarball with lock integrity and provenance", () => {
    const packageJson = JSON.parse(readFileSync(
      new URL("../package.json", import.meta.url),
      "utf8",
    )) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      paperclipHostCompatibility: Record<string, unknown>;
    };
    const packageLock = JSON.parse(readFileSync(
      new URL("../package-lock.json", import.meta.url),
      "utf8",
    )) as {
      packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
    };
    const provenance = JSON.parse(readFileSync(
      new URL(
        "../vendor/paperclipai-plugin-sdk-1.0.0-021ab2f08e07463b038c3d1472f227d2d5f68ca4.provenance.json",
        import.meta.url,
      ),
      "utf8",
    )) as Record<string, unknown>;
    const sharedProvenance = JSON.parse(readFileSync(
      new URL(
        "../vendor/paperclipai-shared-0.3.1-021ab2f08e07463b038c3d1472f227d2d5f68ca4.provenance.json",
        import.meta.url,
      ),
      "utf8",
    )) as Record<string, unknown>;
    const tarball = readFileSync(new URL(
      "../vendor/paperclipai-plugin-sdk-1.0.0-021ab2f08e07463b038c3d1472f227d2d5f68ca4.tgz",
      import.meta.url,
    ));
    const tarballSha256 = createHash("sha256").update(tarball).digest("hex");
    const sharedTarball = readFileSync(new URL(
      "../vendor/paperclipai-shared-0.3.1-021ab2f08e07463b038c3d1472f227d2d5f68ca4.tgz",
      import.meta.url,
    ));
    const sharedTarballSha256 = createHash("sha256").update(sharedTarball).digest("hex");
    const installed = packageLock.packages["node_modules/@paperclipai/plugin-sdk"];
    const installedShared = packageLock.packages["node_modules/@paperclipai/shared"];

    expect(packageJson.dependencies["@paperclipai/plugin-sdk"]).toBe(
      "file:vendor/paperclipai-plugin-sdk-1.0.0-021ab2f08e07463b038c3d1472f227d2d5f68ca4.tgz",
    );
    expect(packageJson.paperclipHostCompatibility).toMatchObject({
      testedCommit: "c5a4ba43368439f5e05c1c7f5cdf74758a2f8a53",
      pluginSdkApi: "1.0.0",
      vendoredSdkSha256: tarballSha256,
      vendoredSharedSha256: sharedTarballSha256,
      knownAuditAdvisories: [{
        id: "GHSA-3pw3-v88x-xj24",
        hostFixCommit: "32a9165ddf6308f3b46eae0653b6f583e502e538",
        hostFixIncluded: true,
      }],
    });
    expect(packageJson.devDependencies["@paperclipai/shared"]).toBe(
      "file:vendor/paperclipai-shared-0.3.1-021ab2f08e07463b038c3d1472f227d2d5f68ca4.tgz",
    );
    expect(installed).toMatchObject({
      version: "1.0.0",
      resolved: "file:vendor/paperclipai-plugin-sdk-1.0.0-021ab2f08e07463b038c3d1472f227d2d5f68ca4.tgz",
      integrity: "sha512-Kj98Fr4YKRODD8B1lKQOfNpE2ETgd5Tg2nRZGQDjSJmd/ztjtnKeC/mJHHVzdfdkxSgSfBEv5e/lD1oJa1m1yg==",
    });
    expect(provenance).toMatchObject({
      sourceCommit: "021ab2f08e07463b038c3d1472f227d2d5f68ca4",
      sha256: tarballSha256,
    });
    expect(installedShared).toMatchObject({
      version: "0.3.1",
      resolved: "file:vendor/paperclipai-shared-0.3.1-021ab2f08e07463b038c3d1472f227d2d5f68ca4.tgz",
      integrity: "sha512-ZoxRW6U+5c+ePYrk+gNUF51Vt6PPNkUJ5nIy7T5oPsZngKUxTi1zht6mJ82gZvxjJhBoAUwXEG1hvmBo4l4HAA==",
    });
    expect(sharedProvenance).toMatchObject({
      sourceCommit: "021ab2f08e07463b038c3d1472f227d2d5f68ca4",
      sha256: sharedTarballSha256,
      knownAuditAdvisory: {
        id: "GHSA-3pw3-v88x-xj24",
        hostFixCommit: "32a9165ddf6308f3b46eae0653b6f583e502e538",
        hostFixIncludedInSourceCommit: true,
      },
    });
  });

  it("serializes scheduled config and HTTP company scope through the installed Worker RPC SDK", async () => {
    const transport = createRpcTransport();
    let worker: WorkerRpcHost | null = null;
    const rpcPlugin = definePlugin({
      async setup(ctx) {
        ctx.jobs.register("scope-probe", async () => {
          const config = await ctx.config.get("company-1");
          await scopedHostFetch(
            ctx,
            String(config.companyId),
            "http://127.0.0.1:3021/api/webhooks/agent-completion",
            { method: "POST", body: "{}" },
          );
        });
      },
    });
    try {
      worker = startWorkerRpcHost({
        plugin: rpcPlugin,
        stdin: transport.stdin,
        stdout: transport.stdout,
        rpcTimeoutMs: 2_000,
      });
      transport.send({
        jsonrpc: "2.0",
        id: "initialize-scope",
        method: "initialize",
        params: {
          manifest: {
            id: "imelki.mck-paperclip-bridge-scope-test",
            apiVersion: 1,
            version: "1.0.0",
            displayName: "MCK scope test",
            description: "Proves vendored Worker RPC scope serialization",
            author: "iMelki",
            categories: ["automation"],
            capabilities: ["http.outbound", "jobs.schedule"],
            entrypoints: { worker: "./dist/worker.js" },
          },
          config: {},
          instanceInfo: { instanceId: "instance-1", hostVersion: "1.0.0" },
          apiVersion: 1,
        },
      });
      await transport.next((message) => message.id === "initialize-scope");

      transport.send({
        jsonrpc: "2.0",
        id: "run-job-scope",
        method: "runJob",
        params: {
          job: {
            jobKey: "scope-probe",
            runId: "run-1",
            trigger: "schedule",
            scheduledAt: "2026-07-29T12:00:00.000Z",
          },
        },
      });
      const configRequest = await transport.next(
        (message) => "method" in message && message.method === "config.get",
      ) as JsonRpcRequest;
      expect(configRequest.params).toEqual({ companyId: "company-1" });
      transport.send({
        jsonrpc: "2.0",
        id: configRequest.id,
        result: { companyId: "company-1" },
      });

      const fetchRequest = await transport.next(
        (message) => "method" in message && message.method === "http.fetch",
      ) as JsonRpcRequest;
      expect(fetchRequest.params).toEqual({
        url: "http://127.0.0.1:3021/api/webhooks/agent-completion",
        init: { method: "POST", body: "{}" },
        companyId: "company-1",
      });
      transport.send({
        jsonrpc: "2.0",
        id: fetchRequest.id,
        result: {
          status: 202,
          statusText: "Accepted",
          headers: { "content-type": "application/json" },
          body: "{\"success\":true}",
        },
      });
      await expect(
        transport.next((message) => message.id === "run-job-scope"),
      ).resolves.toMatchObject({ result: null });
    } finally {
      worker?.stop();
      transport.stdin.destroy();
      transport.stdout.destroy();
    }
  });

  it("persists exact callback bytes and a bounded retry counter", () => {
    const migration = readFileSync(
      new URL("../migrations/001_mck_factory_bridge.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("raw_body text NOT NULL");
    expect(migration).toContain("payload_hash text NOT NULL");
    expect(migration).toContain("attempt_count integer NOT NULL DEFAULT 0");
    expect(migration).toContain("outcome_status text NOT NULL DEFAULT 'pending'");
    expect(migration).toContain("outcome_attempt_count integer NOT NULL DEFAULT 0");
  });

  it("migrates immutable MCK and Mission Control delivery targets and bytes", () => {
    const migration = readFileSync(
      new URL("../migrations/003_independent_lifecycle_channels.sql", import.meta.url),
      "utf8",
    );
    for (const column of [
      "callback_url",
      "outcome_delivery_id",
      "outcome_url",
      "outcome_raw_body",
      "outcome_payload_hash",
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).toContain("SET callback_url = mapping.callback_url");
  });

  it("migrates owner-fenced generations and independent channel lease clocks", () => {
    const migration = readFileSync(
      new URL("../migrations/004_owner_fenced_leases.sql", import.meta.url),
      "utf8",
    );
    for (const column of [
      "processing_generation",
      "processing_owner_token",
      "lease_started_at",
      "intake_generation",
      "intake_owner_token",
      "intake_lease_started_at",
      "mck_lease_generation",
      "mck_lease_owner_token",
      "mck_lease_started_at",
      "outcome_lease_generation",
      "outcome_lease_owner_token",
      "outcome_lease_started_at",
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).toContain("WHERE status = 'sending' AND mck_lease_started_at IS NULL");
    expect(migration).toContain(
      "WHERE outcome_status = 'sending' AND outcome_lease_started_at IS NULL",
    );
  });

  it("migrates every bridge table to fail-closed company-composite identity", () => {
    const migration = readFileSync(
      new URL("../migrations/005_company_isolation.sql", import.meta.url),
      "utf8",
    );
    for (const tableName of [
      "bridge_mappings",
      "bridge_deliveries",
      "lifecycle_deliveries",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.${tableName}`,
      );
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS company_id uuid");
    }
    expect(migration).toContain("PRIMARY KEY (company_id, correlation_id)");
    expect(migration).toContain("PRIMARY KEY (company_id, delivery_id)");
    expect(migration).toContain("PRIMARY KEY (company_id, delivery_key)");
    expect(migration).toContain("FOREIGN KEY (company_id, correlation_id)");
    expect(migration).toContain("HAVING count(DISTINCT issue.company_id) = 1");
    expect(migration).toContain("ALTER COLUMN company_id SET NOT NULL");
    expect(migration).not.toMatch(/\bDO\s+\$\$/i);
    expect(migration).not.toMatch(/\bDROP\s+INDEX\b/i);
  });

  it("keeps every bridge SQL statement company-scoped", () => {
    const workerSource = readFileSync(
      new URL("../src/worker.ts", import.meta.url),
      "utf8",
    );
    const statements = [...workerSource.matchAll(
      /`(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)[\s\S]*?`/g,
    )]
      .map((match) => match[0])
      .filter((sql) => (
        sql.includes('"bridge_mappings"')
        || sql.includes('"bridge_deliveries"')
        || sql.includes('"lifecycle_deliveries"')
      ));
    expect(statements.length).toBeGreaterThan(20);
    for (const sql of statements) {
      expect(sql).toContain("company_id");
    }
  });

  it("accepts only the exact latest agent-authored company-scoped evidence document", () => {
    const body = JSON.stringify({ status: "passed" });
    const latestRevision = {
      id: "revision-id-1",
      revisionNumber: 1,
      createdByAgentId: "validator-agent",
      createdByRunId: "validator-run",
    };
    const document = {
      id: "document-id-1",
      companyId: "company-1",
      issueId: "validate-issue",
      key: "factory-validation-evidence",
      title: "Validation evidence",
      format: "markdown" as const,
      latestRevisionId: "revision-id-1",
      latestRevisionNumber: 1,
      createdByAgentId: "validator-agent",
      createdByUserId: null,
      updatedByAgentId: "validator-agent",
      updatedByUserId: null,
      lockedAt: new Date("2026-07-29T12:02:31.500Z"),
      lockedByAgentId: "validator-agent",
      lockedByUserId: null,
      createdAt: new Date("2026-07-29T12:02:30.000Z"),
      updatedAt: new Date("2026-07-29T12:02:31.000Z"),
      body,
    };
    expect(parseEvidenceDocument(document, {
      companyId: "company-1",
      issueId: "validate-issue",
      key: "factory-validation-evidence",
      agentId: "validator-agent",
      latestRevision,
      parse: (value) => value,
    })).toMatchObject({
      evidence: { status: "passed" },
      bodySha256: prefixedSha256(body),
      updatedAtMs: Date.parse("2026-07-29T12:02:31.000Z"),
    });
    expect(() => parseEvidenceDocument(
      { ...document, companyId: "company-2" },
      {
        companyId: "company-1",
        issueId: "validate-issue",
        key: "factory-validation-evidence",
        agentId: "validator-agent",
        latestRevision,
        parse: (value) => value,
      },
    )).toThrow(/exact latest/);
    expect(() => parseEvidenceDocument(
      { ...document, updatedByAgentId: "integrator-agent" },
      {
        companyId: "company-1",
        issueId: "validate-issue",
        key: "factory-validation-evidence",
        agentId: "validator-agent",
        latestRevision,
        parse: (value) => value,
      },
    )).toThrow(/exact latest/);
    expect(() => parseEvidenceDocument(
      { ...document, updatedByUserId: "operator-user" },
      {
        companyId: "company-1",
        issueId: "validate-issue",
        key: "factory-validation-evidence",
        agentId: "validator-agent",
        latestRevision,
        parse: (value) => value,
      },
    )).toThrow(/exact latest/);
    expect(() => parseEvidenceDocument(
      { ...document, updatedAt: new Date("invalid") },
      {
        companyId: "company-1",
        issueId: "validate-issue",
        key: "factory-validation-evidence",
        agentId: "validator-agent",
        latestRevision,
        parse: (value) => value,
      },
    )).toThrow(/exact latest/);
    expect(() => parseEvidenceDocument(
      { ...document, lockedAt: null },
      {
        companyId: "company-1",
        issueId: "validate-issue",
        key: "factory-validation-evidence",
        agentId: "validator-agent",
        latestRevision,
        parse: (value) => value,
      },
    )).toThrow(/exact latest/);
    expect(() => parseEvidenceDocument(
      { ...document, lockedAt: new Date("invalid") },
      {
        companyId: "company-1",
        issueId: "validate-issue",
        key: "factory-validation-evidence",
        agentId: "validator-agent",
        latestRevision,
        parse: (value) => value,
      },
    )).toThrow(/exact latest/);
    expect(() => parseEvidenceDocument(
      { ...document, lockedAt: new Date("2026-07-29T12:02:30.500Z") },
      {
        companyId: "company-1",
        issueId: "validate-issue",
        key: "factory-validation-evidence",
        agentId: "validator-agent",
        latestRevision,
        parse: (value) => value,
      },
    )).toThrow(/exact latest/);
    expect(() => parseEvidenceDocument(
      document,
      {
        companyId: "company-1",
        issueId: "validate-issue",
        key: "factory-validation-evidence",
        agentId: "validator-agent",
        latestRevision: { ...latestRevision, createdByRunId: null },
        parse: (value) => value,
      },
    )).toThrow(/exact latest/);
  });

  it("verifies exact raw-body HMAC, timestamp freshness, and delivery identity", () => {
    const rawBody = JSON.stringify(dispatchV2());
    const secret = "test-secret";
    const timestamp = "1785272400";
    const signature = `sha256=${createHmac("sha256", secret)
      .update(`delivery-1.${timestamp}.${rawBody}`, "utf8")
      .digest("hex")}`;
    const verified = verifyMckSignature({
      rawBody,
      secret,
      nowMs: Number(timestamp) * 1000,
      headers: {
        "X-MCK-Delivery-ID": "delivery-1",
        "X-MCK-Timestamp": timestamp,
        "X-MCK-Signature": signature,
      },
    });
    expect(verified).toMatchObject({ ok: true, deliveryId: "delivery-1" });
    expect(verifyMckSignature({
      rawBody: `${rawBody} `,
      secret,
      nowMs: Number(timestamp) * 1000,
      headers: {
        "X-MCK-Delivery-ID": "delivery-1",
        "X-MCK-Timestamp": timestamp,
        "X-MCK-Signature": signature,
      },
    })).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("requires the canonical delivery header for v2 while preserving legacy ping and v1 aliases", () => {
    const rawBody = JSON.stringify(dispatchV2());
    const secret = "test-secret";
    const timestamp = "1785272400";
    const legacyHeaders = {
      "X-MCK-Delivery": "delivery-1",
      "X-MCK-Timestamp": timestamp,
      "X-MCK-Signature": `sha256=${createHmac("sha256", secret)
        .update(`delivery-1.${timestamp}.${rawBody}`, "utf8")
        .digest("hex")}`,
    };
    expect(verifyMckSignature({
      rawBody,
      secret,
      nowMs: Number(timestamp) * 1000,
      headers: legacyHeaders,
      requireCanonicalDeliveryId: true,
    })).toMatchObject({ ok: false, reason: "missing_delivery_id" });
    expect(verifyMckSignature({
      rawBody,
      secret,
      nowMs: Number(timestamp) * 1000,
      headers: legacyHeaders,
    })).toMatchObject({ ok: true, deliveryId: "delivery-1" });
    expect(verifyMckSignature({
      rawBody,
      secret,
      nowMs: Number(timestamp) * 1000,
      headers: {
        ...legacyHeaders,
        "X-MCK-Delivery-ID": "delivery-conflict",
      },
      requireCanonicalDeliveryId: true,
    })).toMatchObject({ ok: false, reason: "conflicting_delivery_id" });
  });

  it("signs exact Mission Control bytes with the scoped factory headers", () => {
    const rawBody = JSON.stringify({ task_id: "task-1", receipt_id: "receipt-1" });
    const secret = "mission-control-test-secret-32-bytes-minimum";
    const timestamp = 1785272400;
    const headers = signMissionControlOutcome({
      rawBody,
      deliveryId: "receipt-1",
      secret,
      timestamp,
    });
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "X-MC-Delivery-ID": "receipt-1",
      "X-MC-Timestamp": String(timestamp),
      "X-MC-Signature": `sha256=${createHmac("sha256", secret)
        .update(`receipt-1.${timestamp}.${rawBody}`, "utf8")
        .digest("hex")}`,
    });
    expect(() => signMissionControlOutcome({
      rawBody,
      deliveryId: "receipt-1",
      secret: "too-short",
      timestamp,
    })).toThrow(/at least 32 bytes/);
  });

  it("treats explicit 2xx publication failures as failures", () => {
    expect(() => assertSuccessfulPublication({
      label: "publication",
      ok: true,
      status: 202,
      rawBody: JSON.stringify({ success: false }),
    })).toThrow(/success:false/);
    expect(() => assertSuccessfulPublication({
      label: "publication",
      ok: true,
      status: 202,
      rawBody: JSON.stringify({ accepted: false }),
    })).toThrow(/accepted:false/);
    expect(() => assertSuccessfulPublication({
      label: "publication",
      ok: true,
      status: 202,
      rawBody: JSON.stringify({ success: true }),
    })).not.toThrow();
  });

  it("accepts the owned v2 envelope and rejects repository identity changes", () => {
    expect(parseDispatch(dispatchV2())).toMatchObject({ version: 2 });
    const crossRepository = dispatchV2();
    crossRepository.task.github_source.repo_name = "projects-ops";
    crossRepository.task.github_source.issue_number = 99;
    crossRepository.task.github_source.issue_url = "https://github.com/iMelki/projects-ops/issues/99";
    expect(() => parseDispatch(crossRepository)).toThrow(/repository identity/);
    const external = dispatchV2();
    external.task.github_source.repo_owner = "external";
    expect(() => parseDispatch(external)).toThrow(/owner must be iMelki/);
    const mismatchedIssueUrl = dispatchV2();
    mismatchedIssueUrl.task.github_source.issue_url = "https://github.com/iMelki/projects-ops/issues/47";
    expect(() => parseDispatch(mismatchedIssueUrl)).toThrow(/issue URL/);
    const missingBase = dispatchV2();
    delete (missingBase.factory_contract.repository as Partial<typeof missingBase.factory_contract.repository>).base_sha;
    expect(() => parseDispatch(missingBase)).toThrow(/repository identity/);
    const uppercaseBase = dispatchV2();
    uppercaseBase.factory_contract.repository.base_sha = "A".repeat(40);
    expect(() => parseDispatch(uppercaseBase)).toThrow(/repository identity/);
  });

  it("rejects callback alias drift and every non-canonical factory endpoint", () => {
    const callbackAliasDrift = dispatchV2();
    callbackAliasDrift.callback_urls.lifecycle = "http://127.0.0.1:3021/api/webhooks/other";
    expect(() => parseDispatch(callbackAliasDrift)).toThrow(/loopback callback identity/);

    for (const lifecycle of [
      "http://localhost:3021/api/webhooks/agent-completion",
      "http://user@127.0.0.1:3021/api/webhooks/agent-completion",
      "http://127.0.0.1:3021/api/webhooks/agent-completion?retry=1",
      "http://127.0.0.1:3021/api/webhooks/agent-completion#fragment",
    ]) {
      const candidate = dispatchV2();
      candidate.callbacks.lifecycle = lifecycle;
      candidate.callback_urls.lifecycle = lifecycle;
      expect(() => parseDispatch(candidate)).toThrow(/loopback callback identity/);
    }

    for (const missionControlUrl of [
      "http://localhost:3021",
      "http://user@127.0.0.1:3021",
      "http://127.0.0.1:3021?retry=1",
      "http://127.0.0.1:3021#fragment",
    ]) {
      const candidate = dispatchV2();
      candidate.mission_control_url = missionControlUrl;
      expect(() => parseDispatch(candidate)).toThrow(/loopback callback identity/);
    }
  });

  it("uses one canonical repository-path validator for envelopes and receipts", () => {
    for (const path of [
      "",
      "/src/file.ts",
      "C:/src/file.ts",
      "\\\\server\\share\\file.ts",
      "src\\file.ts",
      "src//file.ts",
      "./src/file.ts",
      "src/../file.ts",
      "src/%2f/file.ts",
      "src/%252f/file.ts",
      "src/e\u0301.ts",
    ]) {
      expect(factoryPathValidationError(path, "scope"), path).not.toBeNull();
      const candidate = dispatchV2();
      candidate.factory_contract.repository.allowed_file_scope = [path];
      expect(() => parseDispatch(candidate), path).toThrow(/contract is incomplete/);
    }
    expect(factoryPathValidationError("src/**", "scope")).toBeNull();
    expect(factoryPathValidationError("src/worker.ts", "changed")).toBeNull();
    expect(factoryPathValidationError("src/*.ts", "changed")).not.toBeNull();
    expect(factoryChangedPathsMatchScope(
      ["src/worker.ts", "src/lib/contracts.ts"],
      ["src/**"],
    )).toBe(true);
    expect(factoryChangedPathsMatchScope(["tests/bridge.test.ts"], ["src/**"])).toBe(false);
  });

  it("rejects incomplete contracts and changed revisions before graph creation", () => {
    const incomplete = dispatchV2();
    incomplete.factory_contract.acceptance_criteria = [];
    expect(() => parseDispatch(incomplete)).toThrow(/contract is incomplete/);
    expect(() => assertCorrelationRevision(
      { task_revision: "a".repeat(64) },
      "b".repeat(64),
    )).toThrow(/task_revision_conflict/);
    expect(() => assertCorrelationRevision(
      { task_revision: "a".repeat(64) },
      "a".repeat(64),
    )).not.toThrow();
  });

  it("owner-fences correlation and inbound delivery completion across reclaim generations", async () => {
    const dispatch = dispatchV2();
    const namespace = "plugin_mck_factory_bridge_7ec566f3b4";
    const insertedExecute = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1 }));
    const insertedContext = {
      db: {
        namespace,
        execute: insertedExecute,
        query: vi.fn(async () => []),
      },
    } as unknown as Parameters<typeof reserveMapping>[0];
    const reservation = await reserveMapping(
      insertedContext,
      "company-1",
      dispatch,
      dispatch.dispatch,
    );
    expect(reservation).toMatchObject({
      createGraph: true,
      owner: { generation: 1, ownerToken: expect.any(String) },
    });
    const owner = reservation.owner!;
    const graph = {
      parent: "11111111-1111-4111-8111-111111111111",
      plan: "22222222-2222-4222-8222-222222222222",
      build: "33333333-3333-4333-8333-333333333333",
      validate: "44444444-4444-4444-8444-444444444444",
      review: "55555555-5555-4555-8555-555555555555",
      release: "66666666-6666-4666-8666-666666666666",
    };
    const completeExecute = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1 }));
    const completionContext = {
      db: { namespace, execute: completeExecute },
    } as unknown as Parameters<typeof completeMapping>[0];
    await expect(completeMapping(
      completionContext,
      "company-1",
      dispatch.dispatch.correlation_id,
      graph,
      owner,
    )).resolves.toBeUndefined();
    expect(completeExecute.mock.calls[0]?.[0]).toContain("intake_owner_token = $9");
    expect(completeExecute.mock.calls[0]?.[1]).toEqual([
      "company-1",
      dispatch.dispatch.correlation_id,
      graph.parent,
      graph.plan,
      graph.build,
      graph.validate,
      graph.review,
      graph.release,
      owner.ownerToken,
      owner.generation,
    ]);

    const staleContext = {
      db: { namespace, execute: vi.fn(async () => ({ rowCount: 0 })) },
    } as unknown as Parameters<typeof completeMapping>[0];
    await expect(completeMapping(
      staleContext,
      "company-1",
      dispatch.dispatch.correlation_id,
      graph,
      owner,
    )).rejects.toThrow(/complete MCK correlation mapping/);

    const reclaimedExecute = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 0 }))
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const reclaimedContext = {
      db: {
        namespace,
        execute: reclaimedExecute,
        query: vi.fn(async () => [{
          ...bridgeMapping(),
          intake_status: "failed",
          intake_generation: 4,
        }]),
      },
    } as unknown as Parameters<typeof reserveMapping>[0];
    const reclaimed = await reserveMapping(
      reclaimedContext,
      "company-1",
      dispatch,
      dispatch.dispatch,
    );
    expect(reclaimed).toMatchObject({
      createGraph: true,
      owner: { generation: 5, ownerToken: expect.any(String) },
    });
    expect(reclaimedExecute.mock.calls[1]?.[0]).toContain("intake_generation = $12");
    const failedExecute = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1 }));
    await failMapping(
      { db: { namespace, execute: failedExecute } } as unknown as Parameters<typeof failMapping>[0],
      "company-1",
      dispatch.dispatch.correlation_id,
      reclaimed.owner!,
      new Error("graph failed"),
    );
    expect(failedExecute.mock.calls[0]?.[0]).toContain("intake_owner_token = $4");
    expect(failedExecute.mock.calls[0]?.[1]?.slice(-2)).toEqual([
      reclaimed.owner!.ownerToken,
      reclaimed.owner!.generation,
    ]);

    const deliveryContext = {
      db: {
        namespace,
        execute: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1 })),
        query: vi.fn(async () => []),
      },
    } as unknown as Parameters<typeof claimDelivery>[0];
    const claimed = await claimDelivery(deliveryContext, "company-1", {
      deliveryId: "delivery-owner-fence",
      payloadHash: "a".repeat(64),
      eventType: "mck.task.dispatch",
    });
    expect(claimed).toMatchObject({
      duplicate: false,
      owner: { generation: 1, ownerToken: expect.any(String) },
    });
    const finishExecute = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1 }));
    await finishDelivery(
      { db: { namespace, execute: finishExecute } } as unknown as Parameters<typeof finishDelivery>[0],
      "company-1",
      "delivery-owner-fence",
      claimed.owner!,
      { status: "processed", correlationId: dispatch.dispatch.correlation_id },
    );
    expect(finishExecute.mock.calls[0]?.[0]).toContain("processing_owner_token = $6");
    await expect(finishDelivery(
      {
        db: { namespace, execute: vi.fn(async () => ({ rowCount: 0 })) },
      } as unknown as Parameters<typeof finishDelivery>[0],
      "company-1",
      "delivery-owner-fence",
      claimed.owner!,
      { status: "failed", error: "stale worker" },
    )).rejects.toThrow(/owner_fence_lost/);
  });

  it("builds one sequential plan/build/validate/review/release writer graph", () => {
    const stages = buildStageDefinitions("Bridge");
    expect(stages.map((stage) => stage.key)).toEqual(["plan", "build", "validate", "review", "release"]);
    expect(stages.map((stage) => stage.blockedBy ?? null)).toEqual([null, "plan", "build", "validate", "review"]);
    expect(stages.filter((stage) => stage.key === "build")).toHaveLength(1);
  });

  it("stores and reads back the exact envelope before activating the parent", async () => {
    const harness = createTestHarness({ manifest, config: { ...bridgeConfig() } });
    const createIssue = vi.spyOn(harness.ctx.issues, "create");
    const upsertDocument = vi.spyOn(harness.ctx.issues.documents, "upsert");
    const getDocument = vi.spyOn(harness.ctx.issues.documents, "get");
    const updateIssue = vi.spyOn(harness.ctx.issues, "update");
    const dispatch = dispatchV2();
    const rawBody = ` ${JSON.stringify(dispatch)}\n`;

    const graph = await createExecutionGraph(
      harness.ctx,
      bridgeConfig(),
      dispatch,
      dispatch.dispatch.correlation_id,
      rawBody,
    );

    expect(createIssue.mock.calls[0]?.[0]).toMatchObject({
      status: "backlog",
      assigneeAgentId: undefined,
      originId: dispatch.dispatch.correlation_id,
    });
    expect(upsertDocument.mock.calls[0]?.[0]).toMatchObject({
      issueId: graph.parent,
      key: "mck-task-envelope",
      format: "markdown",
      body: rawBody,
    });
    expect(getDocument.mock.invocationCallOrder[0]).toBeGreaterThan(
      upsertDocument.mock.invocationCallOrder[0],
    );
    expect(updateIssue.mock.invocationCallOrder[0]).toBeGreaterThan(
      getDocument.mock.invocationCallOrder[0],
    );
    expect(updateIssue.mock.calls[0]).toEqual([
      graph.parent,
      { status: "todo", assigneeAgentId: "director" },
      "company-1",
    ]);
    const readback = await harness.ctx.issues.documents.get(
      graph.parent,
      "mck-task-envelope",
      "company-1",
    );
    expect(readback).toMatchObject({ format: "markdown", body: rawBody });
    expect(readback?.body.startsWith("```")).toBe(false);
    await expect(harness.ctx.issues.get(graph.parent, "company-1")).resolves.toMatchObject({
      status: "todo",
      assigneeAgentId: "director",
    });
  });

  it("publishes a signed machine-authenticated Mission Control outcome", async () => {
    const secret = "mission-control-test-secret-32-bytes-minimum";
    const fetch = vi.fn(async (
      _url: string,
      init?: RequestInit,
      _options?: { companyId?: string },
    ) => (
      new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    ));
    const context = {
      secrets: { resolve: vi.fn(async () => secret) },
      http: { fetch },
    } as unknown as Parameters<typeof publishMissionControlOutcome>[0];

    await expect(publishMissionControlOutcome(
      context,
      bridgeConfig(),
      bridgeMapping(),
      "started",
      "Paperclip accepted the dispatch",
    )).resolves.toEqual({ skipped: false, httpStatus: 201 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
      { companyId: string },
    ];
    expect(url).toBe("http://127.0.0.1:3001/api/webhooks/factory-runtime-outcomes");
    expect(options).toEqual({ companyId: "company-1" });
    const rawBody = String(init?.body);
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    expect(payload).toMatchObject({
      task_id: "task-1",
      event: "started",
      github_sync_mode: "apply",
    });
    expect(headers.get("x-mc-delivery-id")).toBe(payload.receipt_id);
    expect(headers.get("x-mc-timestamp")).toMatch(/^\d+$/);
    expect(headers.get("x-mc-signature")).toBe(
      `sha256=${createHmac("sha256", secret)
        .update(
          `${payload.receipt_id}.${headers.get("x-mc-timestamp")}.${rawBody}`,
          "utf8",
        )
        .digest("hex")}`,
    );
    expect(rawBody).not.toContain(secret);
  });

  it("rejects a 2xx Mission Control success:false response", async () => {
    const context = {
      secrets: {
        resolve: vi.fn(async () => "mission-control-test-secret-32-bytes-minimum"),
      },
      http: {
        fetch: vi.fn(async () => new Response(
          JSON.stringify({ success: false }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        )),
      },
    } as unknown as Parameters<typeof publishMissionControlOutcome>[0];
    await expect(publishMissionControlOutcome(
      context,
      bridgeConfig(),
      bridgeMapping(),
      "review",
      "Review started",
    )).rejects.toThrow(/success:false/);
  });

  it("returns after the signed MCK started callback while Mission Control stays pending", async () => {
    const httpFetch = vi.fn(async (
      _url: string,
      _init?: RequestInit,
      _options?: { companyId?: string },
    ) => new Response(
      JSON.stringify({ success: true }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    ));
    const dbExecutes: string[] = [];
    const context = {
      db: {
        namespace: "plugin_mck_factory_bridge_7ec566f3b4",
        query: vi.fn(async () => []),
        execute: vi.fn(async (sql: string) => {
          dbExecutes.push(sql);
          return { rowCount: 1 };
        }),
      },
      secrets: { resolve: vi.fn(async () => "mck-callback-secret") },
      http: { fetch: httpFetch },
      metrics: { write: vi.fn(async () => undefined) },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    } as unknown as Parameters<typeof publishLifecycle>[0];

    await expect(publishLifecycle(
      context,
      bridgeConfig(),
      bridgeMapping(),
      "started",
      "Paperclip accepted the dispatch",
      undefined,
      { deferMissionControl: true },
    )).resolves.toMatchObject({
      skipped: false,
      outcomeDeferred: true,
    });
    expect(httpFetch).toHaveBeenCalledTimes(1);
    expect(httpFetch.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3021/api/webhooks/agent-completion",
    );
    expect(httpFetch.mock.calls[0]?.[2]).toEqual({ companyId: "company-1" });
    expect(dbExecutes.some((sql) => sql.includes("lifecycle_deliveries"))).toBe(true);
    expect(dbExecutes.some((sql) => sql.includes("outcome_status = 'sending'"))).toBe(false);
  });

  it("does not accept an MCK callback that returns 2xx success:false", async () => {
    const executedSql: string[] = [];
    const context = {
      db: {
        namespace: "plugin_mck_factory_bridge_7ec566f3b4",
        query: vi.fn(async () => []),
        execute: vi.fn(async (sql: string) => {
          executedSql.push(sql);
          return { rowCount: 1 };
        }),
      },
      secrets: { resolve: vi.fn(async () => "mck-callback-secret") },
      http: {
        fetch: vi.fn(async () => new Response(
          JSON.stringify({ success: false }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        )),
      },
      metrics: { write: vi.fn(async () => undefined) },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    } as unknown as Parameters<typeof publishLifecycle>[0];
    await expect(publishLifecycle(
      context,
      bridgeConfig(),
      bridgeMapping(),
      "started",
      "Paperclip accepted the dispatch",
      undefined,
      { deferMissionControl: true },
    )).rejects.toThrow(/success:false/);
    expect(executedSql.some((sql) => sql.includes("SET lifecycle_status"))).toBe(false);
    expect(executedSql.some((sql) => (
      sql.includes("SET last_error = $2")
      && sql.includes("bridge_mappings")
    ))).toBe(true);
    expect(executedSql.some((sql) => (
      sql.includes("mck_lease_owner_token = $3")
      && sql.includes("mck_lease_generation = $4")
    ))).toBe(true);
  });

  it("rejects a persisted callback target before secret resolution or retry fetch", async () => {
    const row = persistedLifecycleRow({
      callback_url: "http://127.0.0.1:3021/api/webhooks/other",
      status: "sent",
    });
    const secrets = { resolve: vi.fn(async () => "mck-callback-secret") };
    const fetch = vi.fn(async () => new Response("{\"success\":true}", { status: 200 }));
    const context = {
      db: {
        namespace: "plugin_mck_factory_bridge_7ec566f3b4",
        query: vi.fn(async () => [row]),
      },
      secrets,
      http: { fetch },
    } as unknown as Parameters<typeof replayCurrentLifecycleForRedispatch>[0];
    await expect(replayCurrentLifecycleForRedispatch(
      context,
      bridgeConfig(),
      { ...bridgeMapping(), lifecycle_status: "blocked" },
    )).rejects.toThrow(/target_conflict/);
    expect(secrets.resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("derives stable lifecycle keys from the exact source occurrence", () => {
    const mapping = bridgeMapping();
    const planBlocked = sourceLifecycleOccurrenceIdentity({
      eventId: "event-plan-blocked",
      eventType: "issue.updated",
      entityId: "plan-issue",
      payload: { runId: "plan-run" },
    });
    const planRecovered = sourceLifecycleOccurrenceIdentity({
      eventId: "event-plan-recovered",
      eventType: "issue.updated",
      entityId: "plan-issue",
      payload: { runId: "plan-run" },
    });
    const buildBlocked = sourceLifecycleOccurrenceIdentity({
      eventId: "event-build-blocked",
      eventType: "issue.updated",
      entityId: "build-issue",
      payload: { runId: "build-run" },
    });
    const needsHumanOne = sourceLifecycleOccurrenceIdentity({
      eventId: "event-release-needs-human-1",
      eventType: "agent.run.finished",
      entityId: "release-issue",
      payload: { runId: "release-run-1" },
    });
    const needsHumanTwo = sourceLifecycleOccurrenceIdentity({
      eventId: "event-release-needs-human-2",
      eventType: "agent.run.finished",
      entityId: "release-issue",
      payload: { runId: "release-run-2" },
    });

    expect(sourceLifecycleOccurrenceIdentity({
      eventId: "event-plan-blocked",
      eventType: "issue.updated",
      entityId: "plan-issue",
      payload: { runId: "plan-run" },
    })).toBe(planBlocked);
    expect(new Set([
      buildLifecycleDeliveryKey(mapping, "blocked", undefined, planBlocked),
      buildLifecycleDeliveryKey(mapping, "started", undefined, planRecovered),
      buildLifecycleDeliveryKey(mapping, "blocked", undefined, buildBlocked),
      buildLifecycleDeliveryKey(mapping, "needs_human", undefined, needsHumanOne),
      buildLifecycleDeliveryKey(mapping, "needs_human", undefined, needsHumanTwo),
    ]).size).toBe(5);
    expect(
      buildLifecycleDeliveryKey(mapping, "blocked", undefined, planBlocked),
    ).not.toBe(
      buildLifecycleDeliveryKey(
        { ...mapping, company_id: "company-2" },
        "blocked",
        undefined,
        planBlocked,
      ),
    );
  });

  it("reconciliation retries immutable MCK and Mission Control rows through company-scoped host policy", async () => {
    const harness = createTestHarness({ manifest, config: { ...bridgeConfig() } });
    const row = persistedLifecycleRow();
    const query = vi.spyOn(harness.ctx.db, "query");
    const configGet = vi.spyOn(harness.ctx.config, "get");
    query.mockImplementation((async (sql: string) => (
      sql.includes("lifecycle_deliveries") ? [row] : []
    )) as typeof harness.ctx.db.query);
    const execute = vi.spyOn(harness.ctx.db, "execute").mockResolvedValue({ rowCount: 1 });
    vi.spyOn(harness.ctx.secrets, "resolve").mockImplementation(
      async (_reference, options) => options?.configPath === "missionControlOutcomeSecretRef"
        ? "mission-control-test-secret-32-bytes-minimum"
        : "mck-callback-secret",
    );
    const fetch = vi.spyOn(harness.ctx.http, "fetch").mockImplementation(
      async () => new Response(
        JSON.stringify({ success: true }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );
    await activateBridgeConfig();
    await plugin.definition.setup(harness.ctx);
    await harness.runJob("reconcile-lifecycle");

    expect(fetch).toHaveBeenCalledTimes(2);
    const calls = fetch.mock.calls as unknown as Array<
      [string, RequestInit, { companyId: string }]
    >;
    expect(calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:3021/api/webhooks/agent-completion",
      "http://127.0.0.1:3001/api/webhooks/factory-runtime-outcomes",
    ]);
    expect(calls[0]?.[1].body).toBe(row.raw_body);
    expect(calls[1]?.[1].body).toBe(row.outcome_raw_body);
    expect(calls.map(([, , options]) => options)).toEqual([
      { companyId: "company-1" },
      { companyId: "company-1" },
    ]);
    expect(configGet).toHaveBeenCalledWith("company-1");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("bridge_mappings"))).toBe(false);
    const reconciliationSelect = String(query.mock.calls[0]?.[0]);
    expect(reconciliationSelect).toMatch(
      /WHERE company_id = \$2\s+AND \(\s+\(\s+attempt_count/,
    );
    expect(reconciliationSelect).toContain(
      "COALESCE(mck_lease_started_at, updated_at)",
    );
    expect(reconciliationSelect).toContain(
      "COALESCE(outcome_lease_started_at, updated_at)",
    );
    const executed = execute.mock.calls.map(([sql]) => String(sql));
    expect(executed.some((sql) => (
      sql.includes("mck_lease_generation = $3")
      && sql.includes("mck_lease_owner_token = $4")
      && sql.includes("mck_lease_started_at = now()")
    ))).toBe(true);
    expect(executed.some((sql) => (
      sql.includes("outcome_lease_generation = $3")
      && sql.includes("outcome_lease_owner_token = $4")
      && sql.includes("outcome_lease_started_at = now()")
    ))).toBe(true);
    expect(executed.some((sql) => (
      sql.includes("mck_lease_owner_token = $3")
      && sql.includes("mck_lease_generation = $4")
    ))).toBe(true);
    expect(executed.some((sql) => (
      sql.includes("outcome_lease_owner_token = $3")
      && sql.includes("outcome_lease_generation = $4")
    ))).toBe(true);
  });

  it("Mission Control reconciliation proceeds after MCK exhausts all attempts", async () => {
    const row = persistedLifecycleRow({ status: "failed", attempt_count: 3 });
    const fetch = vi.fn(async (
      _url: string,
      _init?: RequestInit,
      _options?: { companyId?: string },
    ) => new Response(
      JSON.stringify({ success: true }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    ));
    const context = {
      config: { get: vi.fn(async () => bridgeConfig()) },
      db: {
        namespace: "plugin_mck_factory_bridge_7ec566f3b4",
        query: vi.fn(async () => [row]),
        execute: vi.fn(async () => ({ rowCount: 1 })),
      },
      secrets: {
        resolve: vi.fn(async () => "mission-control-test-secret-32-bytes-minimum"),
      },
      http: { fetch },
      metrics: { write: vi.fn(async () => undefined) },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    } as unknown as Parameters<typeof reconcileLifecycleDeliveries>[0];

    await expect(reconcileLifecycleDeliveries(context, "company-1")).resolves.toEqual({
      inspected: 1,
      delivered: 1,
      failed: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3001/api/webhooks/factory-runtime-outcomes",
    );
    expect(fetch.mock.calls[0]?.[2]).toEqual({ companyId: "company-1" });
  });

  it("same-revision redispatch replays the selected original delivery bytes and target", async () => {
    const row = persistedLifecycleRow({ status: "sent", attempt_count: 1 });
    const fetch = vi.fn(async (
      _url: string,
      _init?: RequestInit,
      _options?: { companyId?: string },
    ) => new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const context = {
      db: {
        namespace: "plugin_mck_factory_bridge_7ec566f3b4",
        query: vi.fn(async () => [row]),
      },
      secrets: { resolve: vi.fn(async () => "mck-callback-secret") },
      http: { fetch },
    } as unknown as Parameters<typeof replayCurrentLifecycleForRedispatch>[0];
    const mapping = {
      ...bridgeMapping(),
      attempt_id: "attempt-b",
      lifecycle_status: "blocked",
    };

    await expect(replayCurrentLifecycleForRedispatch(
      context,
      bridgeConfig(),
      mapping,
    )).resolves.toMatchObject({
      replayed: true,
      deliveryId: "delivery-a",
      httpStatus: 200,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(row.callback_url);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(row.raw_body);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-mck-delivery-id")).toBe(
      "delivery-a",
    );
    expect(fetch.mock.calls[0]?.[2]).toEqual({ companyId: "company-1" });
  });

  it("same-revision redispatch replays the immutable terminal receipt envelope", async () => {
    const completedBody = JSON.stringify({
      schema_version: "2",
      type: "mck.callback.lifecycle",
      task_id: "task-1",
      attempt_id: "attempt-a",
      correlation_id: "mck:default:task-1",
      task_revision: "a".repeat(64),
      status: "completed",
      occurred_at: "2026-07-29T12:30:00.000Z",
      summary: "Original terminal receipt",
      receipt: { receiptId: "receipt-a" },
    });
    const row = persistedLifecycleRow({
      delivery_key: "attempt-a:completed:receipt-a:occurrence-terminal",
      delivery_id: "delivery-terminal-a",
      payload: completedBody,
      raw_body: completedBody,
      payload_hash: sha256(completedBody),
      status: "sent",
    });
    const fetch = vi.fn(async (
      _url: string,
      _init?: RequestInit,
      _options?: { companyId?: string },
    ) => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const context = {
      db: {
        namespace: "plugin_mck_factory_bridge_7ec566f3b4",
        query: vi.fn(async () => [row]),
      },
      secrets: { resolve: vi.fn(async () => "mck-callback-secret") },
      http: { fetch },
    } as unknown as Parameters<typeof replayCurrentLifecycleForRedispatch>[0];
    const mapping = {
      ...bridgeMapping(),
      attempt_id: "attempt-b",
      lifecycle_status: "completed",
      receipt_id: "receipt-a",
    };

    await expect(replayCurrentLifecycleForRedispatch(
      context,
      bridgeConfig(),
      mapping,
    )).resolves.toMatchObject({
      replayed: true,
      deliveryId: "delivery-terminal-a",
      httpStatus: 200,
    });
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(completedBody);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      attempt_id: "attempt-a",
      status: "completed",
      receipt: { receiptId: "receipt-a" },
    });
  });

  it("requires validation, independent review, commit, and push before completion", () => {
    const times = {
      builderStart: "2026-07-29T12:00:00.000Z",
      builderFinish: "2026-07-29T12:01:00.000Z",
      validatorStart: "2026-07-29T12:02:00.000Z",
      validationStart: "2026-07-29T12:02:10.000Z",
      validationFinish: "2026-07-29T12:02:20.000Z",
      validationGenerated: "2026-07-29T12:02:30.000Z",
      validationDocument: "2026-07-29T12:02:31.000Z",
      validatorFinish: "2026-07-29T12:03:00.000Z",
      reviewerStart: "2026-07-29T12:04:00.000Z",
      reviewed: "2026-07-29T12:04:30.000Z",
      reviewDocument: "2026-07-29T12:04:31.000Z",
      reviewerFinish: "2026-07-29T12:05:00.000Z",
      releaseStart: "2026-07-29T12:06:00.000Z",
      releaseCommandStart: "2026-07-29T12:06:10.000Z",
      releaseCommandFinish: "2026-07-29T12:06:40.000Z",
      receiptDocument: "2026-07-29T12:06:45.000Z",
      releaseFinish: "2026-07-29T12:07:00.000Z",
    };
    const validationCommand = {
      id: "command:validation",
      stage: "validation" as const,
      argv: ["npm", "test"],
      workingDirectory: ".",
      startedAtUtc: times.validationStart,
      finishedAtUtc: times.validationFinish,
      durationMs: 10_000,
      status: "passed" as const,
      exitCode: 0 as const,
      stdoutSha256: `sha256:${"4".repeat(64)}`,
      stderrSha256: `sha256:${"5".repeat(64)}`,
    };
    const validationCommands = [{
      id: validationCommand.id,
      commandSha256: canonicalSha256(validationCommand),
    }];
    const validationEvidence = parseFactoryValidationEvidence({
      schemaVersion: "agent-settings.factory-validation-evidence.v1",
      status: "passed",
      generatedAtUtc: times.validationGenerated,
      paperclip: {
        companyId: "company-1",
        projectId: "project-1",
        rootIssueId: "parent-issue",
        validatorIssueId: "validate-issue",
        validatorRunId: "validator-run",
        validatorAgentId: "validator-agent",
        workspaceId: "workspace-id-1",
      },
      candidate: {
        baseSha: "9".repeat(40),
        headSha: "8".repeat(40),
        snapshotSha256: `sha256:${"c".repeat(64)}`,
        changedPaths: ["src/worker.ts"],
      },
      bindings: {
        envelopeSha256: `sha256:${"1".repeat(64)}`,
        validationReceiptSha256: `sha256:${"2".repeat(64)}`,
        contextReceiptSha256: `sha256:${"3".repeat(64)}`,
        commandSetSha256: canonicalSha256(validationCommands),
      },
      commands: validationCommands,
      validation: {
        commandCount: 1,
        passedCommandCount: 1,
        startedAtUtc: times.validationStart,
        finishedAtUtc: times.validationFinish,
        durationMs: 10_000,
      },
      privacy: {
        secretsIncluded: false,
        directContactOrPaymentIdentifiersIncluded: false,
        rawPrivateLogsIncluded: false,
        rawCommandArgumentsIncluded: false,
        redactionApplied: true,
      },
    });
    const validationBody = JSON.stringify(validationEvidence);
    const hostAttestation = {
      issueSha256: `sha256:${"1".repeat(64)}`,
      runSha256: `sha256:${"2".repeat(64)}`,
      agentSha256: `sha256:${"3".repeat(64)}`,
      workspaceSha256: `sha256:${"4".repeat(64)}`,
      configRevisionSetSha256: `sha256:${"5".repeat(64)}`,
      toolDecisionSetSha256: `sha256:${"6".repeat(64)}`,
    };
    const releaseEvidence = parseFactoryReleaseEvidence({
      schemaVersion: "agent-settings.factory-release-evidence.v1",
      bindings: {
        envelopeSha256: validationEvidence.bindings.envelopeSha256,
        validationReceiptSha256: validationEvidence.bindings.validationReceiptSha256,
        contextReceiptSha256: validationEvidence.bindings.contextReceiptSha256,
        validationEvidenceSha256: prefixedSha256(validationBody),
        candidateSnapshotSha256: validationEvidence.candidate.snapshotSha256,
        headBeforeReleaseSha: validationEvidence.candidate.headSha,
        changedPaths: validationEvidence.candidate.changedPaths,
      },
      paperclip: {
        apiCommit: "021ab2f08e07463b038c3d1472f227d2d5f68ca4", // gitleaks:allow — pinned SDK provenance, not a credential
        companyId: "company-1",
        builder: hostAttestation,
        validator: hostAttestation,
        reviewer: hostAttestation,
        approvalSetSha256: `sha256:${"7".repeat(64)}`,
        toolActionSetSha256: `sha256:${"8".repeat(64)}`,
        confirmationSetSha256: `sha256:${"9".repeat(64)}`,
      },
      run: {
        builderAgentId: "builder-agent",
        paperclipIssueId: "build-issue",
        paperclipRunId: "builder-run",
        rootIssueId: "parent-issue",
        validatorIssueId: "validate-issue",
        validatorRunId: "validator-run",
        workspaceId: "workspace-id-1",
        roleProfile: "factory-builder",
        profileManifestSha256: `sha256:${"a".repeat(64)}`,
        effectiveConfigSha256: `sha256:${"b".repeat(64)}`,
        toolInventorySha256: `sha256:${"c".repeat(64)}`,
        startedAtUtc: times.builderStart,
        finishedAtUtc: times.builderFinish,
        durationMs: 60_000,
      },
      review: {
        reviewerId: "reviewer-agent",
        reviewerRunId: "reviewer-run",
        paperclipIssueId: "review-issue",
        roleProfile: "factory-independent-reviewer",
        profileManifestSha256: `sha256:${"d".repeat(64)}`,
        effectiveConfigSha256: `sha256:${"e".repeat(64)}`,
        toolInventorySha256: `sha256:${"f".repeat(64)}`,
        decision: "accept",
        freshSession: true,
        builderSessionReused: false,
        reviewedAtUtc: times.reviewed,
      },
      approvals: [],
      publications: [],
      metrics: {
        retryCount: 0,
        deferralCount: 0,
        inputTokens: 1,
        outputTokens: 1,
        billedCents: 0,
        hostPressure: "normal",
        backendLatencyMs: 10,
        caller: "paperclip",
      },
      privacy: {
        secretsIncluded: false,
        directContactOrPaymentIdentifiersIncluded: false,
        rawPrivateLogsIncluded: false,
        redactionApplied: true,
      },
    });
    const releaseBody = JSON.stringify(releaseEvidence);
    const receipt = {
      schemaVersion: "agent-settings.factory-run-receipt.v1",
      receiptId: "receipt-1",
      envelopeId: "factory:attempt-1",
      correlationId: "mck:default:task-1",
      taskRevisionSha256: `sha256:${"a".repeat(64)}`,
      status: "succeeded",
      run: {
        builderAgentId: "builder-agent",
        paperclipIssueId: "build-issue",
        paperclipRunId: "builder-run",
        workspaceId: "workspace-id-1",
        roleProfile: "factory-builder",
        profileManifestSha256: releaseEvidence.run.profileManifestSha256,
        effectiveConfigSha256: releaseEvidence.run.effectiveConfigSha256,
        toolInventorySha256: releaseEvidence.run.toolInventorySha256,
        startedAtUtc: times.builderStart,
        finishedAtUtc: times.builderFinish,
        durationMs: 60_000,
        mutationIntent: "release",
      },
      repository: {
        slug: "iMelki/mission-control-kanban",
        branch: "dev",
        baseSha: "9".repeat(40),
        headBeforeReleaseSha: "8".repeat(40),
        candidateSnapshotSha256: `sha256:${"c".repeat(64)}`,
        finalSha: "b".repeat(40),
        changedPaths: ["src/worker.ts"],
      },
      commands: [
        validationCommand,
        {
          id: "command:release",
          stage: "release",
          argv: ["pwsh", "-File", "release.ps1"],
          workingDirectory: ".",
          startedAtUtc: times.releaseCommandStart,
          finishedAtUtc: times.releaseCommandFinish,
          durationMs: 30_000,
          status: "passed",
          exitCode: 0,
          stdoutSha256: `sha256:${"7".repeat(64)}`,
          stderrSha256: `sha256:${"8".repeat(64)}`,
        },
      ],
      tests: { total: 1, passed: 1, failed: 0, skipped: 0 },
      artifacts: [],
      metrics: {
        inputWorkItems: 1,
        processedItems: 1,
        changedItems: 1,
        retryCount: 0,
        deferralCount: 0,
        errorCount: 0,
        inputTokens: 1,
        outputTokens: 1,
        billedCents: 0,
        hostPressure: "normal",
        backendLatencyMs: 10,
        freshnessAtUtc: times.receiptDocument,
        caller: "paperclip",
      },
      review: {
        reviewerId: "reviewer-agent",
        reviewerRunId: "reviewer-run",
        roleProfile: "factory-independent-reviewer",
        profileManifestSha256: releaseEvidence.review.profileManifestSha256,
        effectiveConfigSha256: releaseEvidence.review.effectiveConfigSha256,
        toolInventorySha256: releaseEvidence.review.toolInventorySha256,
        decision: "accept",
        freshSession: true,
        builderSessionReused: false,
        reviewedAtUtc: times.reviewed,
        evidenceSha256: prefixedSha256(releaseBody),
      },
      approvals: [],
      release: {
        attempted: true,
        pushed: true,
        remoteRef: "refs/heads/dev",
        commitSha: "b".repeat(40),
        remoteReadbackSha: "b".repeat(40),
        startedAtUtc: times.releaseCommandStart,
        finishedAtUtc: times.releaseCommandFinish,
      },
      publications: [],
      reconciliation: {
        mck: "pending",
        paperclip: "matched",
        missionControl: "pending",
        githubProject: "pending",
        git: "matched",
      },
      privacy: {
        secretsIncluded: false,
        directContactOrPaymentIdentifiersIncluded: false,
        rawPrivateLogsIncluded: false,
        redactionApplied: true,
      },
      errors: [],
    };
    const validatedReceipt = validateReceipt(receipt, {
      envelopeId: "factory:attempt-1",
      correlationId: "mck:default:task-1",
      taskRevision: "a".repeat(64),
      repositorySlug: "iMelki/mission-control-kanban",
      repositoryBaseSha: "9".repeat(40),
      allowedFileScope: ["src/**"],
    });
    expect(validatedReceipt).toEqual(receipt);
    const hostEvidence = {
      receipt: validatedReceipt,
      validationEvidence,
      releaseEvidence,
      evidenceDocuments: {
        validationBodySha256: prefixedSha256(validationBody),
        validationUpdatedAtMs: Date.parse(times.validationDocument),
        releaseBodySha256: prefixedSha256(releaseBody),
        releaseUpdatedAtMs: Date.parse(times.reviewDocument),
        receiptUpdatedAtMs: Date.parse(times.receiptDocument),
      },
      companyId: "company-1",
      projectId: "project-1",
      mapping: {
        rootIssueId: "parent-issue",
        buildIssueId: "build-issue",
        validateIssueId: "validate-issue",
        reviewIssueId: "review-issue",
        releaseIssueId: "release-issue",
      },
      agents: {
        builderAgentId: "builder-agent",
        validatorAgentId: "validator-agent",
        reviewerAgentId: "reviewer-agent",
        integratorAgentId: "integrator-agent",
      },
      issueStatuses: [
        { id: "build-issue", status: "done" },
        { id: "validate-issue", status: "done" },
        { id: "review-issue", status: "done" },
        { id: "release-issue", status: "done" },
      ],
      runs: [
        {
          id: "builder-run",
          issueId: "build-issue",
          agentId: "builder-agent",
          status: "succeeded",
          startedAt: times.builderStart,
          finishedAt: times.builderFinish,
          createdAt: times.builderStart,
        },
        {
          id: "validator-run",
          issueId: "validate-issue",
          agentId: "validator-agent",
          status: "succeeded",
          startedAt: times.validatorStart,
          finishedAt: times.validatorFinish,
          createdAt: times.validatorStart,
        },
        {
          id: "reviewer-run",
          issueId: "review-issue",
          agentId: "reviewer-agent",
          status: "succeeded",
          startedAt: times.reviewerStart,
          finishedAt: times.reviewerFinish,
          createdAt: times.reviewerStart,
        },
        {
          id: "integrator-run",
          issueId: "release-issue",
          agentId: "integrator-agent",
          status: "succeeded",
          startedAt: times.releaseStart,
          finishedAt: times.releaseFinish,
          createdAt: times.releaseStart,
        },
      ],
      openDecisionCount: 0,
    };
    expect(() => assertPaperclipCompletionEvidence(hostEvidence)).not.toThrow();
    expect(() => parseFactoryValidationEvidence({
      ...validationEvidence,
      hidden_payload: "not canonical",
    })).toThrow(/canonical schema-valid/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      evidenceDocuments: {
        ...hostEvidence.evidenceDocuments,
        releaseBodySha256: `sha256:${"0".repeat(64)}`,
      },
    })).toThrow(/hash-bind the exact independent-review document/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      validationEvidence: {
        ...validationEvidence,
        candidate: {
          ...validationEvidence.candidate,
          snapshotSha256: `sha256:${"0".repeat(64)}`,
        },
      },
    })).toThrow(/one exact candidate/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      validationEvidence: {
        ...validationEvidence,
        paperclip: {
          ...validationEvidence.paperclip,
          validatorRunId: "validator-run-other",
        },
      },
      releaseEvidence: {
        ...releaseEvidence,
        run: {
          ...releaseEvidence.run,
          validatorRunId: "validator-run-other",
        },
      },
    })).toThrow(/validator stage current Paperclip run/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      receipt: {
        ...validatedReceipt,
        review: {
          ...validatedReceipt.review,
          reviewerRunId: "reviewer-run-other",
        },
      },
      releaseEvidence: {
        ...releaseEvidence,
        review: {
          ...releaseEvidence.review,
          reviewerRunId: "reviewer-run-other",
        },
      },
    })).toThrow(/independent reviewer stage current Paperclip run/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      evidenceDocuments: {
        ...hostEvidence.evidenceDocuments,
        validationUpdatedAtMs: Date.parse(times.reviewerStart),
      },
    })).toThrow(/authored validation/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      evidenceDocuments: {
        ...hostEvidence.evidenceDocuments,
        validationUpdatedAtMs: Date.parse(times.validationFinish),
      },
    })).toThrow(/authored validation/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      evidenceDocuments: {
        ...hostEvidence.evidenceDocuments,
        releaseUpdatedAtMs: Date.parse(times.reviewerStart),
      },
    })).toThrow(/not fresh for the validated candidate/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      evidenceDocuments: {
        ...hostEvidence.evidenceDocuments,
        receiptUpdatedAtMs: Date.parse(times.releaseCommandStart),
      },
    })).toThrow(/time-bound to the current release-stage run/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      runs: hostEvidence.runs.filter((run) => run.agentId !== "reviewer-agent"),
    })).toThrow(/independent reviewer.*run/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      runs: [
        ...hostEvidence.runs,
        {
          id: "validator-run-newer-failure",
          issueId: "validate-issue",
          agentId: "validator-agent",
          status: "failed",
          startedAt: "2026-07-29T12:03:10.000Z",
          finishedAt: "2026-07-29T12:03:20.000Z",
          createdAt: "2026-07-29T12:03:10.000Z",
        },
      ],
    })).toThrow(/validator stage current Paperclip run/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      activeRuns: [{
        id: "reviewer-run-active",
        issueId: "review-issue",
        agentId: "reviewer-agent",
        status: "running",
        startedAt: times.reviewerStart,
        finishedAt: null,
        createdAt: times.reviewerStart,
      }],
    })).toThrow(/active or queued/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      runs: hostEvidence.runs.map((run) => (
        run.id === "reviewer-run"
          ? {
              ...run,
              startedAt: "2026-07-29T12:02:30.000Z",
              finishedAt: "2026-07-29T12:04:45.000Z",
              createdAt: "2026-07-29T12:02:30.000Z",
            }
          : run
      )),
    })).toThrow(/not fresh for the validated candidate/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      runs: [
        ...hostEvidence.runs,
        {
          id: "integrator-run-newer",
          issueId: "release-issue",
          agentId: "integrator-agent",
          status: "succeeded",
          startedAt: "2026-07-29T12:07:10.000Z",
          finishedAt: "2026-07-29T12:07:20.000Z",
          createdAt: "2026-07-29T12:07:10.000Z",
        },
      ],
    })).toThrow(/release-stage run/);
    expect(() => assertPaperclipCompletionEvidence({
      ...hostEvidence,
      openDecisionCount: 1,
    })).toThrow(/decisions or execution blocks/);
    expect(() => validateReceipt({ ...receipt, release: { ...receipt.release, pushed: false } })).toThrow(/remote readback/);
    expect(() => validateReceipt({
      ...receipt,
      repository: { ...receipt.repository, candidateSnapshotSha256: null },
    })).toThrow(/candidate snapshot/);
    expect(() => validateReceipt({
      ...receipt,
      repository: { ...receipt.repository, finalSha: "7".repeat(40) },
    })).toThrow(/remote readback/);
    expect(() => validateReceipt(receipt, {
      envelopeId: "factory:attempt-1",
      correlationId: "mck:default:task-1",
      taskRevision: "a".repeat(64),
      repositorySlug: "iMelki/mission-control-kanban",
      repositoryBaseSha: "7".repeat(40),
      allowedFileScope: ["src/**"],
    })).toThrow(/repository/);
    expect(() => validateReceipt({
      ...receipt,
      repository: { ...receipt.repository, changedPaths: ["tests/bridge.test.ts"] },
    }, {
      envelopeId: "factory:attempt-1",
      correlationId: "mck:default:task-1",
      taskRevision: "a".repeat(64),
      repositorySlug: "iMelki/mission-control-kanban",
      repositoryBaseSha: "9".repeat(40),
      allowedFileScope: ["src/**"],
    })).toThrow(/accepted factory contract/);
    expect(() => validateReceipt({
      ...receipt,
      repository: { ...receipt.repository, changedPaths: ["src/%252f/secret.ts"] },
    })).toThrow(/owned dev candidate snapshot/);
    expect(() => validateReceipt({
      ...receipt,
      run: { ...receipt.run, effectiveConfigSha256: null },
    })).toThrow(/capability identity/);
    expect(() => validateReceipt({
      ...receipt,
      commands: receipt.commands.filter((command) => command.stage !== "validation"),
    })).toThrow(/deterministic validation/);
    expect(() => validateReceipt({
      ...receipt,
      tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
    })).toThrow(/deterministic validation/);
    expect(() => validateReceipt({
      ...receipt,
      hidden_payload: "not canonical",
    })).toThrow(/identity/);
    expect(() => validateReceipt({
      ...receipt,
      approvals: [{
        requestId: "approval-1",
        kind: "paperclip-approval",
        requiredForRelease: false,
        status: "approved",
        resolvedAtUtc: times.reviewed,
        hidden_payload: "not canonical",
      }],
    })).toThrow(/approval evidence/);
    expect(() => validateReceipt({
      ...receipt,
      publications: [{
        target: "mck",
        deliveryId: "delivery-1",
        status: "delivered",
        publishedAtUtc: times.reviewed,
        hidden_payload: "not canonical",
      }],
    })).toThrow(/publication and reconciliation/);
  });

  it("recursively redacts embedded URL queries and secret-shaped diagnostic strings", () => {
    const inlineApiKey = ["api", "_key"].join("") + "=inline-secret";
    const stripeLikeKey = ["sk", "_live", "_1234567890"].join("");
    const hmacLikeValue = ["sha256", "=0123456789abcdef0123456789abcdef"].join("");
    expect(redactDiagnostic({
      authorization: "Bearer secret",
      callback: "request failed at http://127.0.0.1/callback?token=secret&attempt=1",
      nested: { api_key: "secret" },
      details: `Bearer bearer-secret ${hmacLikeValue} ${inlineApiKey} ${stripeLikeKey}`,
    })).toEqual({
      authorization: "[redacted]",
      callback: "request failed at http://127.0.0.1/callback",
      nested: { api_key: "[redacted]" },
      details: "Bearer [redacted] sha256=[redacted] api_key=[redacted] [redacted]",
    });
  });

  it("fails validation and health when apply mode lacks the exact Mission Control loopback URL", async () => {
    await expect(plugin.definition.onValidateConfig?.({
      ...bridgeConfig(),
      missionControlBaseUrl: undefined,
    })).resolves.toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringMatching(/required when githubSyncMode is apply/)]),
    });
    for (const missionControlBaseUrl of [
      "http://localhost:3001",
      "http://user@127.0.0.1:3001",
      "http://127.0.0.1:3001?retry=1",
      "http://127.0.0.1:3001#fragment",
    ]) {
      await expect(plugin.definition.onValidateConfig?.({
        ...bridgeConfig(),
        missionControlBaseUrl,
      })).resolves.toMatchObject({
        ok: false,
        errors: expect.arrayContaining([expect.stringMatching(/must be exactly/)]),
      });
    }
    await expect(plugin.definition.onValidateConfig?.({
      ...bridgeConfig(),
      githubSyncMode: "disabled",
      missionControlBaseUrl: undefined,
    })).resolves.toMatchObject({ ok: true, errors: [] });

    const harness = createTestHarness({
      manifest,
      config: { ...bridgeConfig(), missionControlBaseUrl: undefined },
    });
    await activateBridgeConfig();
    await plugin.definition.setup(harness.ctx);
    await expect(plugin.definition.onHealth?.()).resolves.toMatchObject({
      status: "error",
      message: "MCK factory bridge configuration is incomplete",
      details: {
        error: expect.stringMatching(/missionControlBaseUrl is required/),
      },
    });
  });

  it("rejects startup configuration replay from a different company scope", async () => {
    await expect(plugin.definition.onConfigChanged?.(
      { ...bridgeConfig() },
      { companyId: "company-2" },
    )).rejects.toThrow(/does not match the delivered company scope/);
  });

  it("authorizes UI company scope before every diagnostics query", async () => {
    const harness = createTestHarness({ manifest, config: { ...bridgeConfig() } });
    await activateBridgeConfig();
    await plugin.definition.setup(harness.ctx);
    const query = vi.spyOn(harness.ctx.db, "query");

    await expect(harness.getData("bridge-summary", {})).rejects.toThrow(
      /authorized bridge-summary companyId/,
    );
    expect(query).not.toHaveBeenCalled();

    await expect(
      harness.getData("bridge-summary", { companyId: "company-1" }),
    ).resolves.toMatchObject({ companyId: "company-1", mappings: 0 });
    expect(query).toHaveBeenCalled();
    for (const [sql, params] of query.mock.calls) {
      expect(String(sql)).toContain("company_id");
      expect(params).toContain("company-1");
    }
  });

  it("boots in the Paperclip SDK harness without querying tenant state from context-free health", async () => {
    const harness = createTestHarness({
      manifest,
      config: { ...bridgeConfig() },
    });
    await activateBridgeConfig();
    await plugin.definition.setup(harness.ctx);
    const query = vi.spyOn(harness.ctx.db, "query");
    await expect(harness.getData("bridge-summary", { companyId: "company-1" })).resolves.toMatchObject({
      status: "ok",
      mappings: 0,
      failedDeliveries: 0,
      failedLifecycleDeliveries: 0,
      exhaustedLifecycleDeliveries: 0,
    });
    await harness.runJob("reconcile-lifecycle");
    expect(harness.metrics).toContainEqual({
      name: "lifecycle.reconciliation",
      value: 0,
      tags: { failed: "0", inspected: "0" },
    });
    const queryCountBeforeHealth = query.mock.calls.length;
    const health = await plugin.definition.onHealth?.();
    expect(health).toMatchObject({
      status: "ok",
      details: {
        scope: "configuration-only; use company-scoped diagnostics for runtime state",
      },
    });
    expect(query.mock.calls).toHaveLength(queryCountBeforeHealth);
    expect(health?.details).not.toHaveProperty("companies");
    expect(health?.details).not.toHaveProperty("companyCount");
    await expect(plugin.definition.onValidateConfig?.({
      companyId: "company-1",
      projectId: "project-1",
      dispatchSecretRef,
      callbackSecretRef,
      missionControlOutcomeSecretRef,
      directorAgentId: "director",
      builderAgentId: "builder",
      validatorAgentId: "validator",
      reviewerAgentId: "reviewer",
      integratorAgentId: "integrator",
      allowedRepositoryOwner: "external",
    })).resolves.toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/iMelki/)]) });
    await expect(plugin.definition.onValidateConfig?.({
      companyId: "company-1",
      projectId: "project-1",
      dispatchSecretRef,
      callbackSecretRef,
      missionControlOutcomeSecretRef,
      directorAgentId: "director",
      builderAgentId: "builder",
      validatorAgentId: "validator",
      reviewerAgentId: "builder",
      integratorAgentId: "integrator",
    })).resolves.toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringMatching(/distinct/)]),
    });
    await expect(plugin.definition.onValidateConfig?.({
      companyId: "company-1",
      projectId: "project-1",
      dispatchSecretRef: "legacy-secret-id",
      callbackSecretRef,
      missionControlOutcomeSecretRef,
      directorAgentId: "director",
      builderAgentId: "builder",
      validatorAgentId: "validator",
      reviewerAgentId: "reviewer",
      integratorAgentId: "integrator",
    })).resolves.toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringMatching(/secret_ref/)]),
    });
    await expect(plugin.definition.onValidateConfig?.({
      ...bridgeConfig(),
      missionControlOutcomeSecretRef: undefined,
    })).resolves.toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringMatching(/missionControlOutcomeSecretRef/)]),
    });
  });
});
