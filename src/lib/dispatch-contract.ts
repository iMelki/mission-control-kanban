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
 * Projects-ops entries are matched after `normalizePlaceholderText`
 * on both sides (NFKC, case-fold, whitespace collapse, bullets, and
 * trailing punctuation); no fuzzy matching. Sources (file:line on projects-ops `dev`):
 *   scripts/Ensure-RepoIssueProjectVisibility.ps1
 *   scripts/Invoke-GitHubProjectMutation.ps1
 * The two generated Allowed File Scope defaults (projects-ops comma form and
 * MemSys semicolon form) are also on the exported list, and are matched as
 * a whole string after NFKC, case-fold, collapsed whitespace, and an optional
 * trailing period, never as split tokens.
 */
export const GENERIC_SYNC_PLACEHOLDER_STRINGS = [
  // Ensure-RepoIssueProjectVisibility.ps1:35 and Invoke-GitHubProjectMutation.ps1:49 (Impact)
  'Keeps repository work visible in the mapped operator cockpit and MCK sync.',
  // Ensure-RepoIssueProjectVisibility.ps1:36 and Invoke-GitHubProjectMutation.ps1:50 (Allowed File Scope)
  'Owning repo issue, docs, scripts, and tests named by the task.',
  // Comma-split pieces of that scope default that are not themselves real
  // file scopes. Bare 'docs' and 'scripts' are real local scopes, so they
  // stay off this list (kanban#227).
  'Owning repo issue',
  'and tests named by the task.',
  // MemSys default Allowed File Scope. Added to this exported list under
  // section 5, rule 5 of docs/SYNC_FIELD_AUTHORITY.md. Both generated
  // scope defaults are matched as a whole string after NFKC, case-fold,
  // collapsed whitespace, and an optional trailing period, never as split
  // tokens, so bare 'docs' and 'scripts' stay real scopes.
  'Owning repo issue; docs; scripts; and tests named by the task',
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
  // Ensure-RepoIssueProjectVisibility.ps1:48 (Safety Rules)
  'Do not mutate external upstream repos from portfolio repair.',
  // Ensure-RepoIssueProjectVisibility.ps1:49 and Invoke-GitHubProjectMutation.ps1:64
  'Do not dispatch agents from this repair script.',
  // Invoke-GitHubProjectMutation.ps1:57 (Test Requirements)
  'Run this wrapper in dry-run mode before apply.',
  // Invoke-GitHubProjectMutation.ps1:58
  'Run mapped MCK workspace sync only after endpoint alignment passes.',
  // Invoke-GitHubProjectMutation.ps1:60 (Rollback Plan)
  'Use the generated rollback manifest to restore prior Project field values or remove newly created Project items.',
  // Invoke-GitHubProjectMutation.ps1:62 (Safety Rules)
  'Do not mutate external upstream repos.',
  // Invoke-GitHubProjectMutation.ps1:63
  'Do not create MCK-only cards.',
] as const;

const LEADING_PLACEHOLDER_PUNCTUATION = /^[\s\-*+>\u2022\u2023\u2043\u00b7\u25e6\u2010-\u2015.,;:!?'"`]+/u;
const TRAILING_PLACEHOLDER_PUNCTUATION = /[\s.,;:!?'"`\u2026\u3002]+$/u;

/**
 * docs/SYNC_FIELD_AUTHORITY.md section 5, rule 6: Unicode NFKC, casefold,
 * trim and collapse internal whitespace, then strip leading bullets and
 * punctuation and trailing sentence punctuation. Path characters such as `/`
 * and `*` at the end are kept, so `docs/` and `docs/**` stay real scopes.
 */
export function normalizePlaceholderText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(LEADING_PLACEHOLDER_PUNCTUATION, '')
    .replace(TRAILING_PLACEHOLDER_PUNCTUATION, '')
    .trim();
}

const GENERIC_SYNC_PLACEHOLDER_SET: ReadonlySet<string> = new Set(
  GENERIC_SYNC_PLACEHOLDER_STRINGS.map((entry) => normalizePlaceholderText(entry)),
);

function isPlaceholderToken(token: string): boolean {
  const normalized = normalizePlaceholderText(token);
  return normalized.length > 0 && GENERIC_SYNC_PLACEHOLDER_SET.has(normalized);
}

/**
 * Generated Allowed File Scope defaults (MemSys semicolon form and
 * projects-ops comma form). Compared only as a whole string after
 * `normalizeGenericSyncPlaceholderText`. Never tokenized, so bare 'docs'
 * and 'scripts' stay real scopes.
 */
const GENERIC_SYNC_PLACEHOLDER_WHOLE_STRINGS = [
  'Owning repo issue; docs; scripts; and tests named by the task',
  'Owning repo issue, docs, scripts, and tests named by the task.',
] as const;

/**
 * Unicode NFKC, then case-fold, then trim and collapse internal whitespace
 * (including space around `;` or `,`) to a single canonical space or
 * separator. A trailing period is optional.
 */
export function normalizeGenericSyncPlaceholderText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s*,\s*/g, ', ')
    .trim()
    .replace(/\.+$/, '');
}

const GENERIC_SYNC_PLACEHOLDER_WHOLE_STRING_NORMALIZED: ReadonlySet<string> = new Set(
  GENERIC_SYNC_PLACEHOLDER_WHOLE_STRINGS.map(normalizeGenericSyncPlaceholderText),
);

const GENERIC_SYNC_PLACEHOLDER_WHOLE_STRING_SEQUENCES: readonly string[][] = Array.from(
  new Map(
    GENERIC_SYNC_PLACEHOLDER_WHOLE_STRINGS.map((placeholder) => {
      const tokens = normalizeGenericSyncPlaceholderText(placeholder)
        .split(/[;,]/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      return [tokens.join('\0'), tokens] as const;
    }),
  ).values(),
);

/**
 * Drop a generated Allowed File Scope default when it appears as a
 * contiguous token sequence, including a superstring such as the MemSys
 * default plus `; src/**`. Bare 'docs', 'scripts', and 'docs/**' stay.
 */
export function stripGeneratedScopePlaceholderTokens(items: readonly string[]): string[] {
  const remaining = [...items];
  const normalized = remaining.map((item) => normalizeGenericSyncPlaceholderText(item));

  for (const sequence of GENERIC_SYNC_PLACEHOLDER_WHOLE_STRING_SEQUENCES) {
    let index = 0;
    while (index <= normalized.length - sequence.length) {
      if (sequence.every((token, offset) => normalized[index + offset] === token)) {
        remaining.splice(index, sequence.length);
        normalized.splice(index, sequence.length);
        continue;
      }
      index += 1;
    }
  }

  return remaining;
}

/**
 * Split a dispatch string on the list separators used by portfolio-repair
 * joins (`; `, `;`, LF, CRLF), trimming each piece. Does not split on commas,
 * so the full Allowed File Scope default stays one token and is matched
 * whole; the comma-split pieces are listed separately.
 */
export function splitGenericSyncPlaceholderTokens(value: string): string[] {
  return value
    .split(/[;\r\n]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * True when `value` is a known generic sync placeholder: an item equal after
 * `normalizePlaceholderText`, a whole-string generated Allowed File Scope
 * default after NFKC / case-fold / whitespace normalization with an optional
 * trailing period, or a `;` / LF / CRLF join whose every non-empty token is
 * such an item (any join or subset). Bare 'docs' or 'scripts' stay real scopes.
 */
export function isGenericSyncPlaceholder(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (isPlaceholderToken(trimmed)) {
    return true;
  }
  if (GENERIC_SYNC_PLACEHOLDER_WHOLE_STRING_NORMALIZED.has(normalizeGenericSyncPlaceholderText(trimmed))) {
    return true;
  }

  const tokens = splitGenericSyncPlaceholderTokens(trimmed);
  return tokens.length > 0 && tokens.every((token) => isPlaceholderToken(token));
}

/** Contract content keys a groomed card fills in by hand. */
const CONTRACT_CONTENT_KEYS = [
  'allowed_file_scope',
  'acceptance_criteria',
  'test_requirements',
  'rollback_plan',
  'safety_rules',
  'impact',
] as const satisfies ReadonlyArray<keyof DispatchMetadata>;

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === 'string' && item.trim().length > 0);
  }
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * True when the contract holds generic placeholder text and nothing else:
 * at least one content key carries a placeholder, and no content key has a
 * substantive value once placeholders are stripped (section 4, rule 3).
 */
export function isPlaceholderOnlyContract(metadata: DispatchMetadata | undefined): boolean {
  if (!metadata) {
    return false;
  }
  let sawPlaceholder = false;
  for (const key of CONTRACT_CONTENT_KEYS) {
    const value = metadata[key];
    if (!hasContent(value)) {
      continue;
    }
    if (hasContent(stripGenericSyncPlaceholders(value))) {
      return false;
    }
    sawPlaceholder = true;
  }
  return sawPlaceholder;
}

export const PLACEHOLDER_DONE_DRIFT_REASON =
  'Done card with a placeholder-only dispatch contract: the contract holds only generic sync placeholders. Sync does not change readiness on Done cards; groom or confirm the contract by hand.';

/**
 * A short, stable fingerprint of the contract content keys, or undefined when
 * the contract is not placeholder-only. Sync stores it in `sync_flags` so a
 * placeholder-only Done card is logged once, and again only when its contract
 * changes. FNV-1a keeps this free of Node-only modules (this file is also
 * bundled for the browser).
 */
export function placeholderOnlyContractFingerprint(metadata: DispatchMetadata | undefined): string | undefined {
  if (!isPlaceholderOnlyContract(metadata)) {
    return undefined;
  }
  const canonical = JSON.stringify(CONTRACT_CONTENT_KEYS.map((key) => [key, metadata?.[key] ?? null]));
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Drop generic placeholder items (and empty strings) from a dispatch value.
 * A string that is itself a placeholder, or a join/subset of only
 * placeholder items, becomes undefined. Mixed joins keep the non-placeholder
 * tokens. Arrays keep only substantive items; an array of only placeholders
 * becomes undefined.
 */
export function stripGenericSyncPlaceholders(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0 || isGenericSyncPlaceholder(trimmed)) {
      return undefined;
    }

    const listItems = trimmed.replaceAll(';', ',').split(',').flatMap((chunk) => chunk.split(String.fromCharCode(10))).flatMap((item) => {
      const itemTrimmed = item.trim();
      return itemTrimmed ? [itemTrimmed] : [];
    });
    const withoutGeneratedScope = stripGeneratedScopePlaceholderTokens(listItems);
    if (withoutGeneratedScope.length !== listItems.length) {
      const keptScope = withoutGeneratedScope.filter((item) => !isGenericSyncPlaceholder(item));
      return keptScope.length > 0 ? keptScope : undefined;
    }

    const tokens = splitGenericSyncPlaceholderTokens(trimmed);
    if (tokens.length <= 1) {
      return value;
    }

    const kept = tokens.filter((token) => !isPlaceholderToken(token));
    if (kept.length === 0) {
      return undefined;
    }
    if (kept.length === tokens.length) {
      return value;
    }
    return kept;
  }

  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const stripped = stripGenericSyncPlaceholders(item);
      if (stripped === undefined) {
        return [];
      }
      return Array.isArray(stripped) ? stripped : [stripped];
    });
    return items.length > 0 ? items : undefined;
  }

  return value;
}

/** Dispatch keys stored as string lists; every other key is a scalar string. */
const LIST_DISPATCH_KEY_SET: ReadonlySet<string> = new Set([
  'allowed_file_scope',
  'acceptance_criteria',
  'test_requirements',
  'safety_rules',
]);

/**
 * `stripGenericSyncPlaceholders` for one dispatch key. A mixed join keeps its
 * non-placeholder parts (docs/SYNC_FIELD_AUTHORITY.md section 5, rule 2), and
 * for a scalar key (`impact`, `rollback_plan`, ...) those parts are joined
 * back into one string. Returning the token array for a scalar key made
 * `normalizeDispatchMetadata` drop the value, so the merge silently cleared
 * real local text (kanban#232 review, CodeRabbit 4629945720).
 */
export function stripGenericSyncPlaceholdersForKey(key: string, value: unknown): unknown {
  const stripped = stripGenericSyncPlaceholders(value);
  if (LIST_DISPATCH_KEY_SET.has(key) || !Array.isArray(stripped)) {
    return stripped;
  }
  const joined = stripped
    .flatMap((item) => (typeof item === 'string' && item.trim().length > 0 ? [item.trim()] : []))
    .join('; ');
  return joined.length > 0 ? joined : undefined;
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
  // An explicit clear must be recognized on the raw value before any list
  // parse. Empty, missing, or unparsable input is not a clear.
  if (isExplicitUpstreamListClear(value)) {
    return [UPSTREAM_CLEAR_SIGNAL];
  }

  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const normalized = normalizeString(item);
      return normalized ? [normalized] : [];
    });
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    const items = value.replaceAll(';', ',').split(',').flatMap((chunk) => chunk.split(String.fromCharCode(10))).flatMap((item) => {
      const itemTrimmed = item.trim();
      return itemTrimmed ? [itemTrimmed] : [];
    });
    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

function normalizeAllowedFileScope(value: unknown): string[] | undefined {
  if (isExplicitUpstreamListClear(value)) {
    return [UPSTREAM_CLEAR_SIGNAL];
  }

  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const normalized = normalizeString(item);
      return normalized ? [normalized] : [];
    });
    const kept = stripGeneratedScopePlaceholderTokens(items).filter((item) => !isGenericSyncPlaceholder(item));
    return kept.length > 0 ? kept : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0 || isGenericSyncPlaceholder(trimmed)) {
      return undefined;
    }

    const items = value.replaceAll(';', ',').split(',').flatMap((chunk) => chunk.split(String.fromCharCode(10))).flatMap((item) => {
      const itemTrimmed = item.trim();
      return itemTrimmed ? [itemTrimmed] : [];
    });
    const kept = stripGeneratedScopePlaceholderTokens(items).filter((item) => !isGenericSyncPlaceholder(item));
    return kept.length > 0 ? kept : undefined;
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
    allowed_file_scope: normalizeAllowedFileScope(candidate.allowed_file_scope),
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

/**
 * Explicit upstream clear signal (docs/SYNC_FIELD_AUTHORITY.md section 4,
 * rule 5). An empty value, a missing heading or a placeholder is never a
 * clear. Only a section or field whose whole trimmed value is exactly this
 * token (case-sensitive) asks MCK to clear the local value, and MCK then
 * writes a tombstone for it. Enum fields (`readiness`, `review_mode`,
 * `risk_level`) cannot carry it because their mappers drop unknown text.
 */
export const UPSTREAM_CLEAR_SIGNAL = 'MCK-CLEAR';

export function isExplicitUpstreamClear(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim() === UPSTREAM_CLEAR_SIGNAL;
  }
  if (Array.isArray(value)) {
    return value.length === 1 && typeof value[0] === 'string' && value[0].trim() === UPSTREAM_CLEAR_SIGNAL;
  }
  return false;
}

/**
 * List-field clear check used before any list parse (splitting commas,
 * bullets, or newlines into items). A clear is only the explicit
 * `UPSTREAM_CLEAR_SIGNAL` on the raw value, including a single list bullet or
 * checkbox in front of the token. An empty, missing, or unparsable list is
 * never a clear.
 */
export function isExplicitUpstreamListClear(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (isExplicitUpstreamClear(value)) {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const withoutBullet = trimmed.replace(/^(?:[-*]\s*\[[ xX]\]\s*|[-*]\s*|\d+\.\s*)/, '').trim();
  return isExplicitUpstreamClear(withoutBullet);
}

function upstreamAsksToClear(key: string, value: unknown): boolean {
  return LIST_DISPATCH_KEY_SET.has(key)
    ? isExplicitUpstreamListClear(value)
    : isExplicitUpstreamClear(value);
}

/**
 * docs/SYNC_FIELD_AUTHORITY.md section 7 (CTO ruling 2026-11-19 14:49 IST,
 * the #212 Security Medium): these keys are local-owned. Sync never writes
 * them, on update or on import. An upstream value that differs from local is
 * reported as drift and changes nothing. `allowed_file_scope` becomes the
 * factory `allowedPaths`, so an issue editor must never be able to change it.
 */
export const LOCAL_OWNED_DISPATCH_KEYS = ['allowed_file_scope', 'safety_rules', 'review_mode'] as const;
/**
 * Sandbox and review controls that GitHub refresh must not overwrite.
 * Retained for backwards compatibility with call sites from kanban#227.
 */
export const LOCAL_ONLY_DISPATCH_FIELDS_ON_REFRESH = LOCAL_OWNED_DISPATCH_KEYS;
export type LocalOwnedDispatchKey = (typeof LOCAL_OWNED_DISPATCH_KEYS)[number];
const LOCAL_OWNED_DISPATCH_KEY_SET: ReadonlySet<string> = new Set(LOCAL_OWNED_DISPATCH_KEYS);

/**
 * Local once set (section 7, test T21): upstream fills these only when the
 * local value is empty and never replaces a non-empty local value.
 */
export const FILL_ONLY_DISPATCH_KEYS = ['target_repo', 'project_workstream'] as const;
const FILL_ONLY_DISPATCH_KEY_SET: ReadonlySet<string> = new Set(FILL_ONLY_DISPATCH_KEYS);

export interface DispatchMetadataMergeDrift {
  field: string;
  reason: string;
}

export interface DispatchMetadataMergeResult {
  merged: DispatchMetadata | undefined;
  /** `dispatch_metadata.<key>` names cleared by an explicit upstream signal. */
  explicit_clears: string[];
  /** Upstream values for local-owned keys that differ from local; not applied. */
  local_owned_drift: DispatchMetadataMergeDrift[];
}

function sameDispatchValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Key-level merge of upstream-derived dispatch metadata into a locally stored
 * contract, with the reasons behind every non-default outcome.
 *
 * - Missing, empty, or placeholder-only upstream values never change local.
 * - `UPSTREAM_CLEAR_SIGNAL` clears a GitHub-owned key (caller writes the
 *   tombstone).
 * - `LOCAL_OWNED_DISPATCH_KEYS` are never written; a differing upstream value
 *   is returned as drift.
 * - `FILL_ONLY_DISPATCH_KEYS` are written only while local is empty.
 * - Every other key: a non-empty, non-placeholder upstream value refreshes.
 *
 * `dispatch_ready` is not stored on this object; callers recompute it from
 * the merged result via `validateDispatchMetadata`.
 */
export function mergeDispatchMetadataFromUpstreamDetailed(
  local: DispatchMetadata | undefined,
  upstream: DispatchMetadata | undefined,
): DispatchMetadataMergeResult {
  const normalizedLocal = normalizeDispatchMetadata(local) as Record<string, unknown> | undefined;
  const localRecord: Record<string, unknown> = normalizedLocal ? { ...normalizedLocal } : {};
  const upstreamRecord = upstream && typeof upstream === 'object'
    ? { ...(upstream as Record<string, unknown>) }
    : {};

  const merged: Record<string, unknown> = { ...localRecord };
  const explicitClears: string[] = [];
  const drift: DispatchMetadataMergeDrift[] = [];

  for (const [key, value] of Object.entries(upstreamRecord)) {
    const localValue = localRecord[key];
    const localHasValue = isNonEmptyDispatchValue(stripGenericSyncPlaceholdersForKey(key, localValue));

    if (LOCAL_OWNED_DISPATCH_KEY_SET.has(key)) {
      const substantive = upstreamAsksToClear(key, value) ? undefined : stripGenericSyncPlaceholdersForKey(key, value);
      const upstreamValue = isNonEmptyDispatchValue(substantive)
        ? (normalizeDispatchMetadata({ [key]: substantive }) as Record<string, unknown> | undefined)?.[key]
        : undefined;
      const upstreamDiffers = upstreamAsksToClear(key, value)
        ? localHasValue
        : upstreamValue !== undefined && (!localHasValue || !sameDispatchValue(upstreamValue, localValue));
      if (upstreamDiffers) {
        drift.push({
          field: `dispatch_metadata.${key}`,
          reason: `Upstream ${upstreamAsksToClear(key, value) ? 'asks to clear' : 'differs on'} local-owned field ${key}; sync never writes it. Change it in MCK if intended.`,
        });
      }
      continue;
    }

    if (upstreamAsksToClear(key, value)) {
      if (FILL_ONLY_DISPATCH_KEY_SET.has(key)) {
        continue;
      }
      if (isNonEmptyDispatchValue(localValue)) {
        delete merged[key];
        explicitClears.push(`dispatch_metadata.${key}`);
      }
      continue;
    }

    // List fields: parse only after the explicit-clear check. An empty or
    // unparsable list is not a write and not a clear.
    if (LIST_DISPATCH_KEY_SET.has(key)) {
      const parsed = normalizeStringArray(value);
      if (!parsed) {
        continue;
      }
      const listValue = stripGenericSyncPlaceholdersForKey(key, parsed);
      if (!isNonEmptyDispatchValue(listValue)) {
        continue;
      }
      merged[key] = listValue;
      continue;
    }

    const substantive = stripGenericSyncPlaceholdersForKey(key, value);
    if (!isNonEmptyDispatchValue(substantive)) {
      continue;
    }

    if (FILL_ONLY_DISPATCH_KEY_SET.has(key) && localHasValue) {
      continue;
    }

    merged[key] = substantive;
  }

  return {
    merged: normalizeDispatchMetadata(merged),
    explicit_clears: explicitClears,
    local_owned_drift: drift,
  };
}

/**
 * Contract for a card a sync creates (section 7 and 8.1): local-owned keys
 * are never taken from upstream, explicit clear signals are dropped, and
 * readiness is always Needs Grooming.
 */
export function buildSyncImportDispatchMetadata(metadata: DispatchMetadata | undefined): DispatchMetadata | undefined {
  const record: Record<string, unknown> = { ...((metadata ?? {}) as Record<string, unknown>) };
  for (const key of LOCAL_OWNED_DISPATCH_KEYS) {
    delete record[key];
  }
  return stripExplicitUpstreamClears({ ...(record as DispatchMetadata), readiness: 'needs_grooming' });
}

/** See `mergeDispatchMetadataFromUpstreamDetailed`; returns the merged value only. */
export function mergeDispatchMetadataFromUpstream(
  local: DispatchMetadata | undefined,
  upstream: DispatchMetadata | undefined,
): DispatchMetadata | undefined {
  return mergeDispatchMetadataFromUpstreamDetailed(local, upstream).merged;
}

/**
 * Drop explicit clear signals from a fresh import, so a new card never stores
 * the signal itself as a value.
 */
export function stripExplicitUpstreamClears(metadata: DispatchMetadata | undefined): DispatchMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  const record: Record<string, unknown> = { ...(metadata as Record<string, unknown>) };
  for (const [key, value] of Object.entries(record)) {
    if (isExplicitUpstreamClear(value)) {
      delete record[key];
    }
  }
  return normalizeDispatchMetadata(record);
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
    const substantive = isExplicitUpstreamClear(value) ? undefined : stripGenericSyncPlaceholders(value);
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
