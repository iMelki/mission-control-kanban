import type { IssueDocument } from "@paperclipai/shared";
import { sha256 } from "./contracts.js";
import { factoryPathValidationError } from "./factory-paths.js";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const gitShaPattern = /^[a-f0-9]{40}$/;
const callerPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function id(value: unknown) {
  return text(value) && idPattern.test(value);
}

function hash(value: unknown) {
  return text(value) && sha256Pattern.test(value);
}

function utc(value: unknown) {
  return text(value) && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function fail(label: string): never {
  throw new Error(`${label} is not canonical schema-valid evidence`);
}

function assertHashAttestation(value: unknown, label: string) {
  if (
    !record(value)
    || !exactKeys(value, [
      "issueSha256",
      "runSha256",
      "agentSha256",
      "workspaceSha256",
      "configRevisionSetSha256",
      "toolDecisionSetSha256",
    ])
    || Object.values(value).some((candidate) => !hash(candidate))
  ) {
    fail(label);
  }
}

function assertPrivacy(
  value: unknown,
  options: { includesCommandArgumentFlag: boolean },
) {
  const keys = [
    "secretsIncluded",
    "directContactOrPaymentIdentifiersIncluded",
    "rawPrivateLogsIncluded",
    ...(options.includesCommandArgumentFlag ? ["rawCommandArgumentsIncluded"] : []),
    "redactionApplied",
  ];
  if (
    !record(value)
    || !exactKeys(value, keys)
    || value.secretsIncluded !== false
    || value.directContactOrPaymentIdentifiersIncluded !== false
    || value.rawPrivateLogsIncluded !== false
    || (
      options.includesCommandArgumentFlag
      && value.rawCommandArgumentsIncluded !== false
    )
    || value.redactionApplied !== true
  ) {
    fail("Factory evidence privacy");
  }
}

export interface FactoryValidationEvidence {
  schemaVersion: "agent-settings.factory-validation-evidence.v1";
  status: "passed";
  generatedAtUtc: string;
  paperclip: {
    companyId: string;
    projectId: string;
    rootIssueId: string;
    validatorIssueId: string;
    validatorRunId: string;
    validatorAgentId: string;
    workspaceId: string;
  };
  candidate: {
    baseSha: string;
    headSha: string;
    snapshotSha256: string;
    changedPaths: string[];
  };
  bindings: {
    envelopeSha256: string;
    validationReceiptSha256: string;
    contextReceiptSha256: string;
    commandSetSha256: string;
  };
  commands: Array<{ id: string; commandSha256: string }>;
  validation: {
    commandCount: number;
    passedCommandCount: number;
    startedAtUtc: string;
    finishedAtUtc: string;
    durationMs: number;
  };
  privacy: {
    secretsIncluded: false;
    directContactOrPaymentIdentifiersIncluded: false;
    rawPrivateLogsIncluded: false;
    rawCommandArgumentsIncluded: false;
    redactionApplied: true;
  };
}

export interface FactoryReleaseEvidence {
  schemaVersion: "agent-settings.factory-release-evidence.v1";
  bindings: {
    envelopeSha256: string;
    validationReceiptSha256: string;
    contextReceiptSha256: string;
    validationEvidenceSha256: string;
    candidateSnapshotSha256: string;
    headBeforeReleaseSha: string;
    changedPaths: string[];
  };
  paperclip: {
    apiCommit: "021ab2f08e07463b038c3d1472f227d2d5f68ca4"; // gitleaks:allow — pinned SDK provenance, not a credential
    companyId: string;
    builder: Record<string, string>;
    validator: Record<string, string>;
    reviewer: Record<string, string>;
    approvalSetSha256: string;
    toolActionSetSha256: string;
    confirmationSetSha256: string;
  };
  run: {
    builderAgentId: string;
    paperclipIssueId: string;
    paperclipRunId: string;
    rootIssueId: string;
    validatorIssueId: string;
    validatorRunId: string;
    workspaceId: string;
    roleProfile: "factory-builder";
    profileManifestSha256: string;
    effectiveConfigSha256: string;
    toolInventorySha256: string;
    startedAtUtc: string;
    finishedAtUtc: string;
    durationMs: number;
  };
  review: {
    reviewerId: string;
    reviewerRunId: string;
    paperclipIssueId: string;
    roleProfile: "factory-independent-reviewer";
    profileManifestSha256: string;
    effectiveConfigSha256: string;
    toolInventorySha256: string;
    decision: "accept";
    freshSession: true;
    builderSessionReused: false;
    reviewedAtUtc: string;
  };
  approvals: Array<{
    requestId: string;
    kind: string;
    requiredForRelease: boolean;
    status: string;
    resolvedAtUtc: string | null;
  }>;
  publications: Array<{
    target: string;
    deliveryId: string;
    status: string;
    publishedAtUtc: string | null;
  }>;
  metrics: Record<string, unknown>;
  privacy: {
    secretsIncluded: false;
    directContactOrPaymentIdentifiersIncluded: false;
    rawPrivateLogsIncluded: false;
    redactionApplied: true;
  };
}

export function canonicalJson(value: unknown): string {
  const canonicalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonicalize);
    if (!record(candidate)) return candidate;
    return Object.fromEntries(
      Object.keys(candidate)
        .sort()
        .map((key) => [key, canonicalize(candidate[key])]),
    );
  };
  return JSON.stringify(canonicalize(value));
}

export function prefixedSha256(value: string) {
  return `sha256:${sha256(value)}`;
}

export function canonicalSha256(value: unknown) {
  return prefixedSha256(canonicalJson(value));
}

export interface LatestEvidenceRevision {
  id: string;
  revisionNumber: number;
  createdByAgentId: string | null;
  createdByRunId: string | null;
}

export interface EvidenceDocumentReadback<T> {
  evidence: T;
  bodySha256: string;
  updatedAtMs: number;
  latestRevision: LatestEvidenceRevision;
}

export function parseFactoryValidationEvidence(value: unknown): FactoryValidationEvidence {
  if (
    !record(value)
    || !exactKeys(value, [
      "schemaVersion",
      "status",
      "generatedAtUtc",
      "paperclip",
      "candidate",
      "bindings",
      "commands",
      "validation",
      "privacy",
    ])
    || value.schemaVersion !== "agent-settings.factory-validation-evidence.v1"
    || value.status !== "passed"
    || !utc(value.generatedAtUtc)
  ) {
    fail("Validator-authored factory-validation-evidence");
  }
  const paperclip = value.paperclip;
  if (
    !record(paperclip)
    || !exactKeys(paperclip, [
      "companyId",
      "projectId",
      "rootIssueId",
      "validatorIssueId",
      "validatorRunId",
      "validatorAgentId",
      "workspaceId",
    ])
    || Object.values(paperclip).some((candidate) => !id(candidate))
  ) {
    fail("Validator evidence Paperclip binding");
  }
  const candidate = value.candidate;
  if (
    !record(candidate)
    || !exactKeys(candidate, ["baseSha", "headSha", "snapshotSha256", "changedPaths"])
    || !text(candidate.baseSha)
    || !gitShaPattern.test(candidate.baseSha)
    || !text(candidate.headSha)
    || !gitShaPattern.test(candidate.headSha)
    || !hash(candidate.snapshotSha256)
    || !Array.isArray(candidate.changedPaths)
    || candidate.changedPaths.length < 1
    || candidate.changedPaths.length > 512
    || new Set(candidate.changedPaths).size !== candidate.changedPaths.length
    || candidate.changedPaths.some((path) => (
      factoryPathValidationError(path, "changed") !== null
    ))
  ) {
    fail("Validator evidence candidate");
  }
  const bindings = value.bindings;
  if (
    !record(bindings)
    || !exactKeys(bindings, [
      "envelopeSha256",
      "validationReceiptSha256",
      "contextReceiptSha256",
      "commandSetSha256",
    ])
    || Object.values(bindings).some((candidate) => !hash(candidate))
  ) {
    fail("Validator evidence hash binding");
  }
  const commands = value.commands;
  if (
    !Array.isArray(commands)
    || commands.length < 1
    || commands.length > 256
    || commands.some((command) => (
      !record(command)
      || !exactKeys(command, ["id", "commandSha256"])
      || !text(command.id)
      || command.id.length > 160
      || !hash(command.commandSha256)
    ))
    || new Set(commands.map((command) => (command as { id: string }).id)).size !== commands.length
    || canonicalSha256(commands) !== bindings.commandSetSha256
  ) {
    fail("Validator evidence command set");
  }
  const validation = value.validation;
  if (
    !record(validation)
    || !exactKeys(validation, [
      "commandCount",
      "passedCommandCount",
      "startedAtUtc",
      "finishedAtUtc",
      "durationMs",
    ])
    || !integer(validation.commandCount, 1, 256)
    || validation.commandCount !== commands.length
    || validation.passedCommandCount !== validation.commandCount
    || !utc(validation.startedAtUtc)
    || !utc(validation.finishedAtUtc)
    || Date.parse(String(validation.startedAtUtc)) > Date.parse(String(validation.finishedAtUtc))
    || !integer(validation.durationMs)
  ) {
    fail("Validator evidence validation interval");
  }
  assertPrivacy(value.privacy, { includesCommandArgumentFlag: true });
  return value as unknown as FactoryValidationEvidence;
}

export function parseFactoryReleaseEvidence(value: unknown): FactoryReleaseEvidence {
  if (
    !record(value)
    || !exactKeys(value, [
      "schemaVersion",
      "bindings",
      "paperclip",
      "run",
      "review",
      "approvals",
      "publications",
      "metrics",
      "privacy",
    ])
    || value.schemaVersion !== "agent-settings.factory-release-evidence.v1"
  ) {
    fail("Reviewer-authored factory-release-evidence");
  }
  const bindings = value.bindings;
  if (
    !record(bindings)
    || !exactKeys(bindings, [
      "envelopeSha256",
      "validationReceiptSha256",
      "contextReceiptSha256",
      "validationEvidenceSha256",
      "candidateSnapshotSha256",
      "headBeforeReleaseSha",
      "changedPaths",
    ])
    || !hash(bindings.envelopeSha256)
    || !hash(bindings.validationReceiptSha256)
    || !hash(bindings.contextReceiptSha256)
    || !hash(bindings.validationEvidenceSha256)
    || !hash(bindings.candidateSnapshotSha256)
    || !text(bindings.headBeforeReleaseSha)
    || !gitShaPattern.test(bindings.headBeforeReleaseSha)
    || !Array.isArray(bindings.changedPaths)
    || bindings.changedPaths.length < 1
    || bindings.changedPaths.length > 512
    || new Set(bindings.changedPaths).size !== bindings.changedPaths.length
    || bindings.changedPaths.some((path) => (
      factoryPathValidationError(path, "changed") !== null
    ))
  ) {
    fail("Reviewer evidence binding");
  }
  const paperclip = value.paperclip;
  if (
    !record(paperclip)
    || !exactKeys(paperclip, [
      "apiCommit",
      "companyId",
      "builder",
      "validator",
      "reviewer",
      "approvalSetSha256",
      "toolActionSetSha256",
      "confirmationSetSha256",
    ])
    || paperclip.apiCommit !== "021ab2f08e07463b038c3d1472f227d2d5f68ca4"
    || !id(paperclip.companyId)
    || !hash(paperclip.approvalSetSha256)
    || !hash(paperclip.toolActionSetSha256)
    || !hash(paperclip.confirmationSetSha256)
  ) {
    fail("Reviewer evidence Paperclip binding");
  }
  assertHashAttestation(paperclip.builder, "Reviewer evidence Builder attestation");
  assertHashAttestation(paperclip.validator, "Reviewer evidence Validator attestation");
  assertHashAttestation(paperclip.reviewer, "Reviewer evidence Reviewer attestation");
  const run = value.run;
  if (
    !record(run)
    || !exactKeys(run, [
      "builderAgentId",
      "paperclipIssueId",
      "paperclipRunId",
      "rootIssueId",
      "validatorIssueId",
      "validatorRunId",
      "workspaceId",
      "roleProfile",
      "profileManifestSha256",
      "effectiveConfigSha256",
      "toolInventorySha256",
      "startedAtUtc",
      "finishedAtUtc",
      "durationMs",
    ])
    || ![
      run.builderAgentId,
      run.paperclipIssueId,
      run.paperclipRunId,
      run.rootIssueId,
      run.validatorIssueId,
      run.validatorRunId,
      run.workspaceId,
    ].every(id)
    || run.roleProfile !== "factory-builder"
    || ![
      run.profileManifestSha256,
      run.effectiveConfigSha256,
      run.toolInventorySha256,
    ].every(hash)
    || !utc(run.startedAtUtc)
    || !utc(run.finishedAtUtc)
    || Date.parse(String(run.startedAtUtc)) > Date.parse(String(run.finishedAtUtc))
    || !integer(run.durationMs)
  ) {
    fail("Reviewer evidence Builder run");
  }
  const review = value.review;
  if (
    !record(review)
    || !exactKeys(review, [
      "reviewerId",
      "reviewerRunId",
      "paperclipIssueId",
      "roleProfile",
      "profileManifestSha256",
      "effectiveConfigSha256",
      "toolInventorySha256",
      "decision",
      "freshSession",
      "builderSessionReused",
      "reviewedAtUtc",
    ])
    || ![review.reviewerId, review.reviewerRunId, review.paperclipIssueId].every(id)
    || review.roleProfile !== "factory-independent-reviewer"
    || ![
      review.profileManifestSha256,
      review.effectiveConfigSha256,
      review.toolInventorySha256,
    ].every(hash)
    || review.decision !== "accept"
    || review.freshSession !== true
    || review.builderSessionReused !== false
    || !utc(review.reviewedAtUtc)
  ) {
    fail("Reviewer evidence independent review");
  }
  if (
    run.builderAgentId === review.reviewerId
    || run.paperclipRunId === review.reviewerRunId
    || run.validatorRunId === review.reviewerRunId
  ) {
    fail("Reviewer evidence independent identities");
  }
  if (
    !Array.isArray(value.approvals)
    || value.approvals.length > 64
    || value.approvals.some((approval) => (
      !record(approval)
      || !exactKeys(approval, [
        "requestId",
        "kind",
        "requiredForRelease",
        "status",
        "resolvedAtUtc",
      ])
      || !id(approval.requestId)
      || ![
        "paperclip-approval",
        "tool-gateway-action",
        "request-confirmation",
        "human-release",
      ].includes(String(approval.kind))
      || typeof approval.requiredForRelease !== "boolean"
      || !["pending", "approved", "rejected", "expired"].includes(String(approval.status))
      || (
        approval.resolvedAtUtc !== null
        && !utc(approval.resolvedAtUtc)
      )
      || (
        approval.requiredForRelease === true
        && (approval.status !== "approved" || !utc(approval.resolvedAtUtc))
      )
    ))
  ) {
    fail("Reviewer evidence approvals");
  }
  if (
    !Array.isArray(value.publications)
    || value.publications.length > 64
    || value.publications.some((publication) => (
      !record(publication)
      || !exactKeys(publication, ["target", "deliveryId", "status", "publishedAtUtc"])
      || !["mck", "mission-control", "github", "github-project", "paperclip"].includes(
        String(publication.target),
      )
      || !id(publication.deliveryId)
      || !["pending", "delivered", "failed", "skipped"].includes(String(publication.status))
      || (publication.publishedAtUtc !== null && !utc(publication.publishedAtUtc))
    ))
  ) {
    fail("Reviewer evidence publications");
  }
  const metrics = value.metrics;
  if (
    !record(metrics)
    || !exactKeys(metrics, [
      "retryCount",
      "deferralCount",
      "inputTokens",
      "outputTokens",
      "billedCents",
      "hostPressure",
      "backendLatencyMs",
      "caller",
    ])
    || !integer(metrics.retryCount, 0, 2)
    || !integer(metrics.deferralCount)
    || !["inputTokens", "outputTokens", "billedCents", "backendLatencyMs"].every((key) => (
      metrics[key] === null || integer(metrics[key])
    ))
    || !["unknown", "normal", "elevated", "critical"].includes(String(metrics.hostPressure))
    || !text(metrics.caller)
    || !callerPattern.test(metrics.caller)
  ) {
    fail("Reviewer evidence metrics");
  }
  assertPrivacy(value.privacy, { includesCommandArgumentFlag: false });
  return value as unknown as FactoryReleaseEvidence;
}

export function parseEvidenceDocument<T>(
  document: IssueDocument | null,
  expected: {
    companyId: string;
    issueId: string;
    key: string;
    agentId: string;
    latestRevision: LatestEvidenceRevision;
    parse: (value: unknown) => T;
  },
): EvidenceDocumentReadback<T> {
  const createdAtMs = Date.parse(String(document?.createdAt ?? ""));
  const updatedAtMs = Date.parse(String(document?.updatedAt ?? ""));
  const latestRevision = expected.latestRevision;
  if (
    !document
    || document.companyId !== expected.companyId
    || document.issueId !== expected.issueId
    || document.key !== expected.key
    || document.format !== "markdown"
    || !text(document.latestRevisionId)
    || !integer(document.latestRevisionNumber, 1)
    || document.latestRevisionId !== latestRevision.id
    || document.latestRevisionNumber !== latestRevision.revisionNumber
    || document.createdByAgentId !== expected.agentId
    || document.updatedByAgentId !== expected.agentId
    || document.createdByUserId !== null
    || document.updatedByUserId !== null
    || !Number.isFinite(createdAtMs)
    || !Number.isFinite(updatedAtMs)
    || createdAtMs > updatedAtMs
    || document.lockedAt === null
    || latestRevision.createdByAgentId !== expected.agentId
    || latestRevision.createdByRunId === null
    || !id(latestRevision.createdByRunId)
  ) {
    throw new Error(
      `${expected.key} is not the exact latest ${expected.agentId}-authored Paperclip document`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(document.body);
  } catch {
    throw new Error(`${expected.key} body is not canonical JSON evidence`);
  }
  return {
    evidence: expected.parse(parsed),
    bodySha256: prefixedSha256(document.body),
    updatedAtMs,
    latestRevision,
  };
}

export function assertEvidenceRevisionRun(
  readback: EvidenceDocumentReadback<unknown>,
  expectedRunId: string,
  label: string,
) {
  if (readback.latestRevision.createdByRunId !== expectedRunId) {
    throw new Error(`${label} latest revision is not authored by its recorded Paperclip run`);
  }
}
