import { describe, expect, it } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  validateReceiptForMapping,
  type BridgeConfig,
  type BridgeMapping,
} from "../src/worker.js";
import type { MckDispatch } from "../src/contracts.js";

/**
 * MCK #136 CodeRabbit follow-up (PR #137 discussion r3744190580): a
 * `dispatch_version: 1` mapping stores no repository base SHA, so the previous
 * expectation compared the receipt's own `repository.baseSha` with itself and
 * always passed. A v2 receipt could therefore complete a v1 dispatch, marking
 * the parent issue done while the v1 lifecycle callback was skipped.
 *
 * These tests assert the rejection happens before any host I/O: the context is
 * a proxy that throws on every property access, so touching Paperclip at all
 * would fail the test.
 */

const config: BridgeConfig = {
  companyId: "company-1",
  projectId: "project-1",
  allowedRepositoryOwner: "iMelki",
  dispatchSecretRef: { envVar: "MCK_DISPATCH_SECRET" } as BridgeConfig["dispatchSecretRef"],
  callbackSecretRef: { envVar: "MCK_CALLBACK_SECRET" } as BridgeConfig["callbackSecretRef"],
  missionControlOutcomeSecretRef: {
    envVar: "MCK_MC_SECRET",
  } as BridgeConfig["missionControlOutcomeSecretRef"],
  githubSyncMode: "disabled",
  directorAgentId: "director",
  builderAgentId: "builder",
  validatorAgentId: "validator",
  reviewerAgentId: "reviewer",
  integratorAgentId: "integrator",
};

const hostForbiddenContext = new Proxy({}, {
  get(_target, property) {
    throw new Error(`Paperclip host was touched (${String(property)}) before the mapping was rejected`);
  },
}) as unknown as PluginContext;

function mappingWith(overrides: Partial<BridgeMapping>): BridgeMapping {
  return {
    company_id: config.companyId,
    correlation_id: "mck:correlation:00000001",
    mck_task_id: "task-1",
    attempt_id: "attempt-00000001",
    dispatch_version: 1,
    task_revision: "a".repeat(64),
    github_issue_url: "https://github.com/iMelki/mission-control-kanban/issues/136",
    callback_url: null,
    envelope: { version: 1 } as unknown as MckDispatch,
    parent_issue_id: "issue-parent",
    plan_issue_id: "issue-plan",
    build_issue_id: "issue-build",
    validate_issue_id: "issue-validate",
    review_issue_id: "issue-review",
    release_issue_id: "issue-release",
    intake_status: "accepted",
    lifecycle_status: null,
    receipt_id: null,
    last_error: null,
    intake_generation: 1,
    intake_owner_token: null,
    intake_lease_started_at: null,
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateReceiptForMapping dispatch-version gate", () => {
  it("rejects a v1 mapping before any Paperclip host call", async () => {
    await expect(validateReceiptForMapping(
      hostForbiddenContext,
      config,
      mappingWith({}),
      { schemaVersion: "agent-settings.factory-run-receipt.v2" },
    )).rejects.toThrow(/requires a dispatch v2 mapping/);
  });

  it("rejects a mapping whose persisted envelope is v1 even when the row claims v2", async () => {
    await expect(validateReceiptForMapping(
      hostForbiddenContext,
      config,
      mappingWith({ dispatch_version: 2 }),
      { schemaVersion: "agent-settings.factory-run-receipt.v2" },
    )).rejects.toThrow(/requires a dispatch v2 mapping/);
  });

  it("rejects a mapping owned by another company before the version gate", async () => {
    await expect(validateReceiptForMapping(
      hostForbiddenContext,
      config,
      mappingWith({ company_id: "company-2", dispatch_version: 2 }),
      {},
    )).rejects.toThrow(/does not belong to the authorized company/);
  });
});
