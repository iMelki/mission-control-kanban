/**
 * Action-review contract (fleet EUX-09 primitive).
 * Ported from Component Marketplace `src/components/ui/action-review-contract.ts`
 * at 6a49e75, adapted to MCK house style. Typed four-question consequence
 * contract, typed-confirmation gate logic, and error normalization for the
 * ActionReviewDialog that replaces native confirm()/alert() guards (#139).
 */

import type { ReactNode } from 'react';

export const ACTION_REVIEW_TONES = ['default', 'destructive'] as const;

export type ActionReviewTone = (typeof ACTION_REVIEW_TONES)[number];

/**
 * The four questions every consequential action button must answer before an
 * operator confirms it (fleet UI/UX rubric section 1.7 / EUX-09). Owning apps
 * fill these as structured fields; the dialog never accepts a free-text blob.
 */
export interface ActionReviewConsequences {
  /** What happens immediately when the operator confirms. */
  immediateEffect: ReactNode;
  /** What backend change runs after confirmation. */
  confirmedEffect: ReactNode;
  /** Where the operator can see the result afterward. */
  resultLocation: ReactNode;
  /** What explicitly will NOT happen, so scope stays bounded. */
  willNotHappen: ReactNode;
}

export const ACTION_REVIEW_CONSEQUENCE_KEYS = [
  'immediateEffect',
  'confirmedEffect',
  'resultLocation',
  'willNotHappen',
] as const;

export type ActionReviewConsequenceKey =
  (typeof ACTION_REVIEW_CONSEQUENCE_KEYS)[number];

export const ACTION_REVIEW_CONSEQUENCE_META: Record<
  ActionReviewConsequenceKey,
  { label: string }
> = {
  immediateEffect: { label: 'Happens now' },
  confirmedEffect: { label: 'Runs after confirm' },
  resultLocation: { label: 'Result appears in' },
  willNotHappen: { label: 'Will not happen' },
};

export type ActionReviewConfirmBlockedReason =
  | 'pending'
  | 'confirmation_mismatch';

/**
 * Normalizes operator input for the typed-confirmation gate. Only surrounding
 * whitespace is forgiven; the visible characters must match exactly.
 */
export function normalizeTypedConfirmationInput(value: string): string {
  return value.trim();
}

/**
 * True when the typed value unlocks the confirm button. An empty expected
 * value can never be satisfied, so a misconfigured gate fails closed.
 */
export function isTypedConfirmationSatisfied(
  expectedValue: string,
  typedValue: string
): boolean {
  const expected = normalizeTypedConfirmationInput(expectedValue);
  if (!expected) {
    return false;
  }
  return normalizeTypedConfirmationInput(typedValue) === expected;
}

/**
 * Single source of truth for why the confirm button is blocked, shared by the
 * component and its tests. Returns null when confirming is allowed.
 */
export function getActionReviewConfirmBlockedReason(options: {
  pending: boolean;
  expectedConfirmation?: string;
  typedValue: string;
}): ActionReviewConfirmBlockedReason | null {
  if (options.pending) {
    return 'pending';
  }
  if (
    options.expectedConfirmation !== undefined &&
    !isTypedConfirmationSatisfied(options.expectedConfirmation, options.typedValue)
  ) {
    return 'confirmation_mismatch';
  }
  return null;
}

/**
 * Maps a rejected onConfirm promise to operator-readable text. Never returns
 * an empty string, so the error surface always carries a next step.
 */
export function describeActionReviewError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'The action failed before it completed. Nothing was confirmed; review the logs and retry.';
}
