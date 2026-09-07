/**
 * Canonical coverage-denominator primitive.
 *
 * WHY THIS FILE EXISTS (mission-control-kanban#159)
 * -------------------------------------------------
 * `scripts/probe-surface-a11y.mjs` carried FOUR independent copies of
 *
 *     population === 0 ? 100 : Math.round((measured / population) * 1000) / 10
 *
 * at lines 1021, 1381, 2332 and 2356. Every copy answers "I measured nothing"
 * and "I measured everything" with the SAME VALUE, 100. On 2026-08-24 the route
 * `/` at mobile rendered zero controls and was published as
 * `coveragePct: 100, status: "full"` and counted among the surfaces at full
 * coverage. The page had failed to render.
 *
 * A coverage percentage without a denominator assertion is not a measurement.
 * The rule this module enforces:
 *
 *     A ratio may only be reported when its denominator is > 0.
 *     A zero denominator is its own OUTCOME, never a score.
 *
 * PRIOR ART -- both reference engines already do this, and neither reports a
 * zero-element run as a pass (read 2026-09-07):
 *
 *   - axe-core publishes FOUR result arrays, and the fourth exists for exactly
 *     this case: "the inapplicable array lists all the rules for which no
 *     matching elements were found on the page". A rule with zero matching
 *     nodes is never placed in `passes`.
 *     https://github.com/dequelabs/axe-core/blob/develop/doc/API.md
 *
 *   - Lighthouse gives the same case the distinct status `notApplicable` and
 *     EXCLUDES it from the weighted average rather than scoring it: an audit
 *     that does not apply "does not affect your score".
 *     https://developer.chrome.com/docs/lighthouse/accessibility/scoring
 *
 *   - NULL RESULT, stated plainly: pa11y does NOT distinguish these. A page
 *     with zero testable elements and a genuinely clean page both print
 *     "no issues found" and exit 0. pa11y fails open on this axis, so it is
 *     not usable as prior art here -- only as a warning.
 *     https://github.com/pa11y/pa11y
 *
 * @module coverage-denominator
 */

/** Denominator was zero: nothing was measurable. NEVER a score, never 'full'. */
export const EMPTY = 'empty';
/** The denominator itself is not a usable count (NaN, negative, non-integer). */
export const INVALID = 'invalid';
/** Denominator > 0 and the measured fraction cleared the full-coverage bar. */
export const FULL = 'full';
/** Denominator > 0 and the measured fraction did not clear the bar. */
export const PARTIAL = 'partial';

/** A status is only quotable as complete coverage when it is exactly this. */
export const FULL_COVERAGE_STATUSES = Object.freeze([FULL]);

export const DEFAULT_FULL_THRESHOLD_PCT = 99.5;

/**
 * Classify a coverage measurement.
 *
 * The ONLY supported way to turn a (measured, population) pair into a
 * percentage in this repo. Call sites must not re-derive the ratio; the
 * ratchet test in `tests/coverage-denominator.test.mjs` fails the build when
 * they do.
 *
 * @param {object} input
 * @param {number} input.population   Denominator: things that COULD be measured.
 * @param {number} input.measured     Numerator: things actually measured.
 * @param {number} [input.staleAfterSampleDestroyed=0] Controls lost when the
 *   sample was destroyed mid-pass. Non-zero forbids `full` even at 100%.
 * @param {number} [input.fullThresholdPct=99.5]
 * @returns {{population:number, measured:number, coveragePct:number|null,
 *            status:string, reason:string|null, scorable:boolean}}
 *   `coveragePct` is `null` -- NOT 100 and NOT 0 -- whenever the measurement
 *   has no denominator to stand on. `scorable` is false in exactly those cases.
 */
export function classifyCoverage(input) {
  const {
    population,
    measured,
    staleAfterSampleDestroyed = 0,
    fullThresholdPct = DEFAULT_FULL_THRESHOLD_PCT,
  } = input || {};

  if (!Number.isInteger(population) || population < 0) {
    return {
      population,
      measured,
      coveragePct: null,
      status: INVALID,
      reason: 'denominator-not-a-count',
      scorable: false,
    };
  }
  if (!Number.isInteger(measured) || measured < 0) {
    return {
      population,
      measured,
      coveragePct: null,
      status: INVALID,
      reason: 'numerator-not-a-count',
      scorable: false,
    };
  }
  if (measured > population) {
    return {
      population,
      measured,
      coveragePct: null,
      status: INVALID,
      reason: 'numerator-exceeds-denominator',
      scorable: false,
    };
  }
  // THE DEFECT THIS MODULE EXISTS TO CLOSE. Do not "simplify" this to 100.
  if (population === 0) {
    return {
      population,
      measured,
      coveragePct: null,
      status: EMPTY,
      reason: 'zero-denominator',
      scorable: false,
    };
  }

  const coveragePct = Math.round((measured / population) * 1000) / 10;
  const status =
    coveragePct >= fullThresholdPct && staleAfterSampleDestroyed === 0 ? FULL : PARTIAL;
  return { population, measured, coveragePct, status, reason: null, scorable: true };
}

/**
 * Render a coverage percentage for a human-readable banner.
 * A non-scorable measurement must never print as a number, because a reader
 * scanning a log cannot tell `100%` from `100%`.
 *
 * @param {number|null} coveragePct
 * @param {string} [status]
 * @returns {string}
 */
export function formatCoveragePct(coveragePct, status) {
  if (coveragePct === null || coveragePct === undefined) {
    return status === EMPTY ? 'n/a (zero denominator)' : 'n/a';
  }
  return coveragePct + '%';
}

/**
 * Denominator assertion for an aggregate claim.
 *
 * "Scored N of M surfaces" is only publishable when M > 0. This is the
 * assertion class that agent-settings#863 D2 and this repo's #159 were both
 * missing: a coverage figure quoted with no proof that anything was in scope.
 *
 * @param {object} input
 * @param {number} input.expected  M -- entities that SHOULD have been observed.
 * @param {number} input.observed  N -- entities actually observed.
 * @param {string} input.basis     How M was derived. An empty basis is a defect:
 *   a denominator drawn from the same list as the numerator measures the
 *   curated list against itself (the exact agent-settings#863 D2 shape).
 * @returns {{ok:boolean, status:string, reason:string|null, detail:string}}
 */
export function assertDenominator(input) {
  const { expected, observed, basis } = input || {};
  if (!Number.isInteger(expected) || expected < 0) {
    return {
      ok: false,
      status: INVALID,
      reason: 'denominator-not-a-count',
      detail: 'expected=' + JSON.stringify(expected),
    };
  }
  if (expected === 0) {
    return {
      ok: false,
      status: EMPTY,
      reason: 'zero-denominator',
      detail:
        'nothing was in scope, so no coverage figure may be published; ' +
        'zero rows is an ERROR outcome, never a full-coverage outcome',
    };
  }
  if (!Number.isInteger(observed) || observed < 0 || observed > expected) {
    return {
      ok: false,
      status: INVALID,
      reason: 'numerator-out-of-range',
      detail: 'observed=' + JSON.stringify(observed) + ' expected=' + expected,
    };
  }
  if (typeof basis !== 'string' || basis.trim().length === 0) {
    return {
      ok: false,
      status: INVALID,
      reason: 'denominator-basis-undeclared',
      detail: 'a denominator with no declared basis cannot be checked for self-reference',
    };
  }
  return {
    ok: true,
    status: observed === expected ? FULL : PARTIAL,
    reason: null,
    detail: 'scored ' + observed + ' of ' + expected + ' (' + basis + ')',
  };
}
