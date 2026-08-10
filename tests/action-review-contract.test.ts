/**
 * Pins the action-review contract (fleet EUX-09 primitive, #139):
 * tone vocabulary, the four-question consequence contract, typed-confirmation
 * gate blocking behavior, and error normalization.
 * Ported from Component Marketplace tests/action-review-contract.test.mjs at 6a49e75.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_REVIEW_CONSEQUENCE_KEYS,
  ACTION_REVIEW_CONSEQUENCE_META,
  ACTION_REVIEW_TONES,
  describeActionReviewError,
  getActionReviewConfirmBlockedReason,
  isTypedConfirmationSatisfied,
  normalizeTypedConfirmationInput,
} from '../src/components/ui/action-review-contract';

test('tone vocabulary stays pinned to default and destructive', () => {
  assert.deepEqual(ACTION_REVIEW_TONES, ['default', 'destructive']);
});

test('the consequence summary answers exactly the four rubric questions in order', () => {
  assert.deepEqual(ACTION_REVIEW_CONSEQUENCE_KEYS, [
    'immediateEffect',
    'confirmedEffect',
    'resultLocation',
    'willNotHappen',
  ]);
  assert.deepEqual(Object.keys(ACTION_REVIEW_CONSEQUENCE_META), [
    ...ACTION_REVIEW_CONSEQUENCE_KEYS,
  ]);
  for (const key of ACTION_REVIEW_CONSEQUENCE_KEYS) {
    assert.ok(ACTION_REVIEW_CONSEQUENCE_META[key].label.length > 0);
  }
});

test('typed confirmation forgives surrounding whitespace only', () => {
  assert.equal(normalizeTypedConfirmationInput('  my-workspace  '), 'my-workspace');
  assert.equal(isTypedConfirmationSatisfied('my-workspace', 'my-workspace'), true);
  assert.equal(isTypedConfirmationSatisfied('my-workspace', '  my-workspace '), true);
});

test('typed confirmation blocks until the value matches exactly', () => {
  assert.equal(isTypedConfirmationSatisfied('my-workspace', ''), false);
  assert.equal(isTypedConfirmationSatisfied('my-workspace', 'my'), false);
  assert.equal(isTypedConfirmationSatisfied('my-workspace', 'My-Workspace'), false);
  assert.equal(isTypedConfirmationSatisfied('my-workspace', 'my workspace'), false);
});

test('an empty expected value fails closed instead of auto-unlocking', () => {
  assert.equal(isTypedConfirmationSatisfied('', ''), false);
  assert.equal(isTypedConfirmationSatisfied('   ', '   '), false);
});

test('confirm blocked reason distinguishes pending from a gate mismatch', () => {
  assert.equal(
    getActionReviewConfirmBlockedReason({
      pending: true,
      expectedConfirmation: 'my-workspace',
      typedValue: 'my-workspace',
    }),
    'pending'
  );
  assert.equal(
    getActionReviewConfirmBlockedReason({
      pending: false,
      expectedConfirmation: 'my-workspace',
      typedValue: 'nope',
    }),
    'confirmation_mismatch'
  );
  assert.equal(
    getActionReviewConfirmBlockedReason({
      pending: false,
      expectedConfirmation: 'my-workspace',
      typedValue: 'my-workspace',
    }),
    null
  );
  assert.equal(
    getActionReviewConfirmBlockedReason({ pending: false, typedValue: '' }),
    null,
    'no gate configured means confirm is not blocked'
  );
});

test('rejected onConfirm errors normalize to operator-readable non-empty text', () => {
  assert.equal(describeActionReviewError(new Error('  HTTP 500 from the bridge ')), 'HTTP 500 from the bridge');
  assert.equal(describeActionReviewError('plain string reason'), 'plain string reason');
  assert.equal(
    describeActionReviewError(new Error('   ')),
    'The action failed before it completed. Nothing was confirmed; review the logs and retry.'
  );
  assert.equal(
    describeActionReviewError(undefined),
    'The action failed before it completed. Nothing was confirmed; review the logs and retry.'
  );
  assert.notEqual(describeActionReviewError(null), '');
});
