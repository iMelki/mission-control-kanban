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
    const items = value
      .map((item) => normalizeString(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'string') {
    const items = value
      .split(/\r?\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
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

export function validateDispatchMetadata(metadata: DispatchMetadata | undefined): DispatchValidationResult {
  const normalized = normalizeDispatchMetadata(metadata);
  const missingFields = REQUIRED_FIELD_LABELS.filter(([field]) => {
    const value = normalized?.[field];
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return !value;
  }).map(([, label]) => label);

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

  return {
    canDispatch: blockers.length === 0,
    missingFields,
    blockers,
    warnings,
  };
}
