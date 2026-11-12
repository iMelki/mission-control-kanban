export type DispatchReadiness = 'raw' | 'needs_grooming' | 'ready_for_agent' | 'needs_human';
export type DispatchReviewMode = 'human_required' | 'auto_checks_only' | 'pair_review';
export type DispatchRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DispatchMetadata {
  source_issue_url?: string;
  target_repo?: string;
  project_workstream?: string;
  allowed_file_scope?: string[];
  acceptance_criteria?: string[];
  test_requirements?: string[];
  risk_level?: DispatchRiskLevel;
  readiness?: DispatchReadiness;
  review_mode?: DispatchReviewMode;
  impact?: string;
  rollback_plan?: string;
  safety_rules?: string[];
}

export interface DispatchValidationResult {
  canDispatch: boolean;
  missingFields: string[];
  blockers: string[];
  warnings: string[];
}

export interface DispatchValidationOptions {
  /**
   * Set to 2 to also enforce the canonical factory v2 envelope work-contract
   * bounds. Version 1 dispatch has no length contract, so the default is
   * unchanged for every existing caller.
   */
  factoryDispatchVersion?: 1 | 2;
  /** Task title; the v2 envelope carries it verbatim as `work.title`. */
  taskTitle?: string;
}

/**
 * Text bounds the canonical factory task envelope enforces
 * (`validateCanonicalFactoryTaskEnvelope` in
 * `integrations/paperclip-bridge/src/contracts.ts`). Mirrored here — not
 * imported — because that module pulls in `node:crypto` and this one is bundled
 * into client components. `tests/factory-webhooks.test.ts` pins the mirror to
 * the canonical validator so the two cannot drift apart silently.
 */
export const FACTORY_V2_WORK_CONTRACT_LIMITS = {
  title: { min: 8, max: 240 },
  acceptance_criteria: { min: 8, max: 1_000 },
  test_requirements: { min: 3, max: 500 },
  rollback_plan: { min: 8, max: 1_000 },
  list_items: { max: 64 },
} as const;

export interface DispatchUiSummary {
  state: 'ready' | 'blocked' | 'needs_grooming' | 'human_only';
  headline: string;
  tone: 'success' | 'warning' | 'danger';
  blockers: string[];
  warnings: string[];
  readinessLabel: string;
  reviewModeLabel?: string;
  riskLevelLabel?: string;
}

const ACTIVE_WORK_STATUSES = new Set(['assigned', 'in_progress', 'testing', 'review', 'done']);

const REQUIRED_FIELD_LABELS: Array<[keyof DispatchMetadata, string]> = [
  ['target_repo', 'target repo'],
  ['project_workstream', 'project/workstream'],
  ['allowed_file_scope', 'allowed file scope'],
  ['acceptance_criteria', 'acceptance criteria'],
  ['test_requirements', 'test requirements'],
  ['risk_level', 'risk level'],
  ['readiness', 'readiness'],
  ['review_mode', 'review mode'],
  ['impact', 'impact'],
  ['rollback_plan', 'rollback/fallback plan'],
];

export const READINESS_LABELS: Record<DispatchReadiness, string> = {
  raw: 'Raw',
  needs_grooming: 'Needs Grooming',
  ready_for_agent: 'Ready for Agent',
  needs_human: 'Needs Human',
};

export const REVIEW_MODE_LABELS: Record<DispatchReviewMode, string> = {
  human_required: 'Human Required',
  auto_checks_only: 'Auto Checks Only',
  pair_review: 'Pair Review',
};

export const RISK_LEVEL_LABELS: Record<DispatchRiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/**
 * Generic portfolio-repair default strings from iMelki/projects-ops (dev).
 * Matched EXACTLY after trim: no fuzzy matching, regex, or case folding.
 * Sources (file:line on projects-ops `dev`):
 *   scripts/Ensure-RepoIssueProjectVisibility.ps1
 *   scripts/Invoke-GitHubProjectMutation.ps1
 * MemSys-sourced strings, if they differ, are a follow-up.
 */
export const GENERIC_SYNC_PLACEHOLDER_STRINGS = [
  // Ensure-RepoIssueProjectVisibility.ps1:35 and Invoke-GitHubProjectMutation.ps1:49 (Impact)
  'Keeps repository work visible in the mapped operator cockpit and MCK sync.',
  // Ensure-RepoIssueProjectVisibility.ps1:36 and Invoke-GitHubProjectMutation.ps1:50 (Allowed File Scope)
  'Owning repo issue, docs, scripts, and tests named by the task.',
  // Ensure-RepoIssueProjectVisibility.ps1:38 and Invoke-GitHubProjectMutation.ps1:52 (Acceptance Criteria)
  'Issue is present on the mapped GitHub Project.',
  // Ensure-RepoIssueProjectVisibility.ps1:39 and Invoke-GitHubProjectMutation.ps1:53
  'Required dispatch fields are populated for MCK import.',
  // Ensure-RepoIssueProjectVisibility.ps1:40 and Invoke-GitHubProjectMutation.ps1:54
  'Mapped MCK workspace sync imports or updates the local task mirror.',
  // Ensure-RepoIssueProjectVisibility.ps1:43 (Test Requirements)
  'Run this script in -DryRun mode before broad repair.',
  // Ensure-RepoIssueProjectVisibility.ps1:44
  'Run mapped MCK workspace sync after Project membership repair.',
  // Ensure-RepoIssueProjectVisibility.ps1:46 (Rollback Plan)
  'Remove the Project item from the mapped board or set Status=Done if this issue should not be visible in MCK.',
  // Invoke-GitHubProjectMutation.ps1:57 (Test Requirements)
  'Run this wrapper in dry-run mode before apply.',
  // Invoke-GitHubProjectMutation.ps1:58
  'Run mapped MCK workspace sync only after endpoint alignment passes.',
  // Invoke-GitHubProjectMutation.ps1:60 (Rollback Plan)
  'Use the generated rollback manifest to restore prior Project field values or remove newly created Project items.',
] as const;

const GENERIC_SYNC_PLACEHOLDER_SET: ReadonlySet<string> = new Set(GENERIC_SYNC_PLACEHOLDER_STRINGS);

/**
 * True when `value` is a string whose trimmed form equals one of
 * `GENERIC_SYNC_PLACEHOLDER_STRINGS` exactly.
 */
export function isGenericSyncPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && GENERIC_SYNC_PLACEHOLDER_SET.has(value.trim());
}

/**
 * Drop generic placeholder items (and empty strings) from a dispatch value.
 * A string that is itself a placeholder becomes undefined. Arrays keep only
 * substantive items; an array of only placeholders becomes undefined.
 */
export function stripGenericSyncPlaceholders(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0 || GENERIC_SYNC_PLACEHOLDER_SET.has(trimmed)) {
      return undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const stripped = stripGenericSyncPlaceholders(item);
      return stripped === undefined ? [] : [stripped];
    });
    return items.length > 0 ? items : undefined;
  }

  return value;
}

export function requiresDispatchContractBeforeWorkStarts(status: string | undefined): boolean {
  return typeof status === 'string' && ACTIVE_WORK_STATUSES.has(status);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const normalized = normalizeString(item);
      return normalized ? [normalized] : [];
    });
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'string') {
    const items = value.replaceAll(';', ',').split(',').flatMap((chunk) => chunk.split(String.fromCharCode(10))).flatMap((item) => {
      const trimmed = item.trim();
      return trimmed ? [trimmed] : [];
    });
    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

export function normalizeDispatchMetadata(input: unknown): DispatchMetadata | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const metadata: DispatchMetadata = {
    source_issue_url: normalizeString(candidate.source_issue_url),
    target_repo: normalizeString(candidate.target_repo),
    project_workstream: normalizeString(candidate.project_workstream),
    allowed_file_scope: normalizeStringArray(candidate.allowed_file_scope),
    acceptance_criteria: normalizeStringArray(candidate.acceptance_criteria),
    test_requirements: normalizeStringArray(candidate.test_requirements),
    risk_level: normalizeString(candidate.risk_level) as DispatchRiskLevel | undefined,
    readiness: normalizeString(candidate.readiness) as DispatchReadiness | undefined,
    review_mode: normalizeString(candidate.review_mode) as DispatchReviewMode | undefined,
    impact: normalizeString(candidate.impact),
    rollback_plan: normalizeString(candidate.rollback_plan),
    safety_rules: normalizeStringArray(candidate.safety_rules),
  };

  const hasAnyValue = Object.values(metadata).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return Boolean(value);
  });

  return hasAnyValue ? metadata : undefined;
}

export function serializeDispatchMetadata(metadata: DispatchMetadata | undefined): string | null {
  const normalized = normalizeDispatchMetadata(metadata);
  return normalized ? JSON.stringify(normalized) : null;
}

export function parseDispatchMetadata(raw: unknown): DispatchMetadata | undefined {
  if (!raw) {
    return undefined;
  }

  if (typeof raw === 'string') {
    try {
      return normalizeDispatchMetadata(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  return normalizeDispatchMetadata(raw);
}

function isNonEmptyDispatchValue(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isNonEmptyDispatchValue(item));
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => isNonEmptyDispatchValue(item));
  }

  return true;
}

/**
 * Key-level merge of upstream-derived dispatch metadata into a locally stored
 * contract.
 *
 * Precedence: local edits win unless upstream explicitly provides a non-empty,
 * non-placeholder value. A value is non-empty when a trimmed string has length
 * and is not a known generic sync placeholder, an array has at least one
 * non-empty non-placeholder item (placeholder items are dropped first), or any
 * other non-null scalar is present. Missing, empty, or placeholder-only
 * upstream keys leave the local key unchanged. This applies to every key,
 * including locally authored contract fields such as `allowed_file_scope`,
 * `test_requirements`, and `rollback_plan`. `dispatch_ready` is not stored on
 * this object; callers recompute it from the merged result via
 * `validateDispatchMetadata`.
 */
export function mergeDispatchMetadataFromUpstream(
  local: DispatchMetadata | undefined,
  upstream: DispatchMetadata | undefined,
): DispatchMetadata | undefined {
  const localRecord = local && typeof local === 'object'
    ? { ...(local as Record<string, unknown>) }
    : {};
  const upstreamRecord = upstream && typeof upstream === 'object'
    ? { ...(upstream as Record<string, unknown>) }
    : {};

  const merged: Record<string, unknown> = { ...localRecord };
  for (const [key, value] of Object.entries(upstreamRecord)) {
    const substantive = stripGenericSyncPlaceholders(value);
    if (isNonEmptyDispatchValue(substantive)) {
      merged[key] = substantive;
    }
  }

  return normalizeDispatchMetadata(merged);
}


/**
 * Pre-validates the fields that become the canonical v2 envelope `work` block.
 * Returns operator-readable blockers so short or oversized text is refused
 * before the envelope is built, instead of surfacing later as the opaque
 * "Canonical factory task envelope work contract is invalid" error.
 */
export function validateFactoryV2WorkContract(
  metadata: DispatchMetadata | undefined,
  taskTitle?: string,
): string[] {
  const normalized = normalizeDispatchMetadata(metadata);
  const limits = FACTORY_V2_WORK_CONTRACT_LIMITS;
  const blockers: string[] = [];

  // The envelope carries the raw task title, so measure it untrimmed.
  if (typeof taskTitle === 'string') {
    const length = taskTitle.length;
    if (length < limits.title.min || length > limits.title.max) {
      blockers.push(
        `Task title must be ${limits.title.min}-${limits.title.max} characters for factory dispatch v2 (currently ${length})`
      );
    }
  }

  const checkList = (
    values: string[] | undefined,
    label: string,
    bound: { min: number; max: number },
  ) => {
    if (!values || values.length === 0) {
      return;
    }
    if (values.length > limits.list_items.max) {
      blockers.push(`${label} must hold at most ${limits.list_items.max} entries for factory dispatch v2 (currently ${values.length})`);
    }
    values.forEach((value, index) => {
      if (value.length < bound.min || value.length > bound.max) {
        blockers.push(
          `${label} entry ${index + 1} must be ${bound.min}-${bound.max} characters for factory dispatch v2 (currently ${value.length})`
        );
      }
    });
  };

  checkList(normalized?.acceptance_criteria, 'Acceptance criteria', limits.acceptance_criteria);
  checkList(normalized?.test_requirements, 'Test requirements', limits.test_requirements);

  const rollback = normalized?.rollback_plan;
  if (rollback && (rollback.length < limits.rollback_plan.min || rollback.length > limits.rollback_plan.max)) {
    blockers.push(
      `Rollback plan must be ${limits.rollback_plan.min}-${limits.rollback_plan.max} characters for factory dispatch v2 (currently ${rollback.length})`
    );
  }

  return blockers;
}

export function validateDispatchMetadata(
  metadata: DispatchMetadata | undefined,
  options?: DispatchValidationOptions,
): DispatchValidationResult {
  const normalized = normalizeDispatchMetadata(metadata);
  const missingFields = REQUIRED_FIELD_LABELS.flatMap(([field, label]) => {
    const value = normalized?.[field];
    const substantive = stripGenericSyncPlaceholders(value);
    if (Array.isArray(substantive)) {
      return substantive.length === 0 ? [label] : [];
    }
    return substantive ? [] : [label];
  });

  const blockers = [...missingFields.map((field) => `Missing ${field}`)];
  const warnings: string[] = [];

  if (!normalized?.readiness) {
    blockers.push('Readiness is not set');
  } else if (normalized.readiness !== 'ready_for_agent') {
    blockers.push(`Readiness is ${READINESS_LABELS[normalized.readiness]}`);
  }

  if (normalized?.risk_level && ['high', 'critical'].includes(normalized.risk_level)) {
    warnings.push('High-risk work still requires explicit human review before merge');
  }

  if (normalized?.review_mode === 'auto_checks_only' && normalized?.risk_level && ['high', 'critical'].includes(normalized.risk_level)) {
    blockers.push('High-risk work cannot use Auto Checks Only review mode');
  }

  if (options?.factoryDispatchVersion === 2) {
    blockers.push(...validateFactoryV2WorkContract(normalized, options.taskTitle));
  }

  return {
    canDispatch: blockers.length === 0,
    missingFields,
    blockers,
    warnings,
  };
}

export function summarizeDispatchContract(metadata: DispatchMetadata | undefined): DispatchUiSummary {
  const normalized = normalizeDispatchMetadata(metadata);
  const validation = validateDispatchMetadata(normalized);
  const readiness = normalized?.readiness;
  const reviewMode = normalized?.review_mode;
  const riskLevel = normalized?.risk_level;

  if (validation.canDispatch) {
    return {
      state: 'ready',
      headline: riskLevel && ['high', 'critical'].includes(riskLevel)
        ? 'Ready for agent dispatch, but keep human review in the loop'
        : 'Ready for agent dispatch',
      tone: riskLevel && ['high', 'critical'].includes(riskLevel) ? 'warning' : 'success',
      blockers: [],
      warnings: validation.warnings,
      readinessLabel: readiness ? READINESS_LABELS[readiness] : 'Ready',
      reviewModeLabel: reviewMode ? REVIEW_MODE_LABELS[reviewMode] : undefined,
      riskLevelLabel: riskLevel ? RISK_LEVEL_LABELS[riskLevel] : undefined,
    };
  }

  if (readiness === 'needs_human') {
    return {
      state: 'human_only',
      headline: 'Human-only work; keep this out of agent dispatch',
      tone: 'danger',
      blockers: validation.blockers,
      warnings: validation.warnings,
      readinessLabel: READINESS_LABELS[readiness],
      reviewModeLabel: reviewMode ? REVIEW_MODE_LABELS[reviewMode] : undefined,
      riskLevelLabel: riskLevel ? RISK_LEVEL_LABELS[riskLevel] : undefined,
    };
  }

  if (readiness === 'raw' || readiness === 'needs_grooming') {
    return {
      state: 'needs_grooming',
      headline: 'Needs grooming before agent dispatch',
      tone: 'warning',
      blockers: validation.blockers,
      warnings: validation.warnings,
      readinessLabel: READINESS_LABELS[readiness],
      reviewModeLabel: reviewMode ? REVIEW_MODE_LABELS[reviewMode] : undefined,
      riskLevelLabel: riskLevel ? RISK_LEVEL_LABELS[riskLevel] : undefined,
    };
  }

  return {
    state: 'blocked',
    headline: 'Dispatch blocked until the contract is complete',
    tone: 'danger',
    blockers: validation.blockers,
    warnings: validation.warnings,
    readinessLabel: readiness ? READINESS_LABELS[readiness] : 'Not Set',
    reviewModeLabel: reviewMode ? REVIEW_MODE_LABELS[reviewMode] : undefined,
    riskLevelLabel: riskLevel ? RISK_LEVEL_LABELS[riskLevel] : undefined,
  };
}
