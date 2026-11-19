/**
 * Evidence that may move a card (or the GitHub Project) to Done or Review.
 * docs/SYNC_FIELD_AUTHORITY.md section 6, rule 4: only a merge to `main` (or
 * the repo's production branch), or a closed issue with evidence, can do it.
 * Evidence means a linked merged PR into `main`, or a closing comment that
 * names what shipped. A merge into `dev` is never evidence (rule 3).
 */
export type StatusEvidence =
  | { kind: 'merged_pr'; base_ref: string; merged: boolean; url?: string }
  | { kind: 'closing_comment'; shipped: string; url?: string };

export const DEFAULT_PRODUCTION_BRANCHES: readonly string[] = ['main', 'master'];

export function isDoneOrReviewEvidence(
  evidence: StatusEvidence | null | undefined,
  productionBranches: readonly string[] = DEFAULT_PRODUCTION_BRANCHES,
): boolean {
  if (!evidence || typeof evidence !== 'object') {
    return false;
  }
  if (evidence.kind === 'merged_pr') {
    const base = typeof evidence.base_ref === 'string' ? evidence.base_ref.trim() : '';
    return evidence.merged === true && base.length > 0 && productionBranches.includes(base);
  }
  if (evidence.kind === 'closing_comment') {
    return typeof evidence.shipped === 'string' && evidence.shipped.trim().length > 0;
  }
  return false;
}

export function hasDoneOrReviewEvidence(
  evidence: ReadonlyArray<StatusEvidence> | null | undefined,
  productionBranches: readonly string[] = DEFAULT_PRODUCTION_BRANCHES,
): boolean {
  return Array.isArray(evidence) && evidence.some((item) => isDoneOrReviewEvidence(item, productionBranches));
}
