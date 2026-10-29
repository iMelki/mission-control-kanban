/**
 * Pure helpers for the Dembrandt design-token drift check (scripts/design-drift.mjs).
 *
 * Dembrandt renders a route, reads computed styles and, with `--compare`,
 * returns a drift report per route: a 0-100 `score` (0 = identical), a
 * `summary` of changed/added/removed tokens and an `inconclusive` flag when
 * nothing comparable was measured. This module turns one report per route into
 * a single verdict against OUR threshold, so the gate does not depend on the
 * CLI's built-in fail threshold and can be unit tested without a browser.
 */

/** Exact Dembrandt release this check runs. Bump deliberately, then re-baseline. */
export const DEMBRANDT_VERSION = '0.39.2';

/** Same default as Dembrandt's own gate (DEFAULT_DRIFT_CONFIG.failThreshold). */
export const DEFAULT_THRESHOLD = 10;

/** Key routes: the dashboard, one workspace board and the settings page. */
export const DEFAULT_ROUTES = ['/', '/workspace/default', '/settings'];

export const STATUS = Object.freeze({
  STABLE: 'stable',
  DRIFT: 'drift',
  INCONCLUSIVE: 'inconclusive',
  MISSING_BASELINE: 'missing-baseline',
  ERROR: 'error',
});

/** `/` -> `root`, `/workspace/default` -> `workspace-default`. */
export function routeSlug(route) {
  const slug = String(route)
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();
  return slug || 'root';
}

/**
 * Classify one route. `drift` is Dembrandt's report, or null when the route
 * could not be compared (`error` explains why).
 */
export function classifyRoute({ route, drift = null, error = null, baselineMissing = false }, threshold = DEFAULT_THRESHOLD) {
  if (baselineMissing) return { route, status: STATUS.MISSING_BASELINE, score: null, error };
  if (error || !drift) return { route, status: STATUS.ERROR, score: null, error: error || 'no drift report' };
  if (drift.inconclusive) return { route, status: STATUS.INCONCLUSIVE, score: drift.score ?? null, summary: drift.summary };
  const score = Number(drift.score);
  if (!Number.isFinite(score)) return { route, status: STATUS.ERROR, score: null, error: 'drift score is not a number' };
  return {
    route,
    status: score > threshold ? STATUS.DRIFT : STATUS.STABLE,
    score,
    summary: drift.summary,
    changes: Array.isArray(drift.changes) ? drift.changes : [],
    warnings: drift.warnings || [],
  };
}

/**
 * Overall verdict. Only an all-stable run passes: a route that could not be
 * measured is a failure to evaluate, never a silent pass.
 */
export function evaluateDrift(results, threshold = DEFAULT_THRESHOLD) {
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`threshold must be a number >= 0, got ${threshold}`);
  const routes = results.map((result) => classifyRoute(result, threshold));
  const count = (status) => routes.filter((route) => route.status === status).length;
  const ok = routes.length > 0 && routes.every((route) => route.status === STATUS.STABLE);
  return {
    ok,
    threshold,
    maxScore: routes.reduce((max, route) => (route.score != null && route.score > max ? route.score : max), 0),
    counts: {
      stable: count(STATUS.STABLE),
      drift: count(STATUS.DRIFT),
      inconclusive: count(STATUS.INCONCLUSIVE),
      missingBaseline: count(STATUS.MISSING_BASELINE),
      error: count(STATUS.ERROR),
    },
    routes,
  };
}

/** Exit codes mirror Dembrandt's: 0 stable, 1 drift, 2 could not evaluate. */
export function exitCodeFor(verdict) {
  if (verdict.ok) return 0;
  if (verdict.routes.some((route) => route.status === STATUS.DRIFT)) return 1;
  return 2;
}

/** Short Markdown report for the job summary and the artifact. */
export function formatMarkdown(verdict, { baseUrl, version = DEMBRANDT_VERSION } = {}) {
  const lines = [
    '# Design drift',
    '',
    `Dembrandt ${version} against ${baseUrl || 'the running app'}; threshold ${verdict.threshold} (0 = identical, 100 = unrelated).`,
    '',
    `**Result: ${verdict.ok ? 'stable' : 'drift or not evaluated'}**`,
    '',
    '| Route | Status | Score | Changed | Added | Removed |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const route of verdict.routes) {
    const summary = route.summary || {};
    lines.push(`| \`${route.route}\` | ${route.status} | ${route.score ?? '-'} | ${summary.changed ?? '-'} | ${summary.added ?? '-'} | ${summary.removed ?? '-'} |`);
  }
  for (const route of verdict.routes) {
    if (route.error) lines.push('', `- \`${route.route}\`: ${route.error}`);
    const changes = route.changes || [];
    if (route.status !== STATUS.DRIFT || changes.length === 0) continue;
    lines.push('', `## \`${route.route}\``, '');
    for (const change of changes.slice(0, 20)) {
      const values = [change.before, change.after].filter((value) => value != null).join(' -> ');
      lines.push(`- ${change.category} ${change.kind}: ${change.label}${values ? ` (${values})` : ''}`);
    }
    if (changes.length > 20) lines.push(`- ...and ${changes.length - 20} more`);
  }
  lines.push('', 'If the change is intended, run `npm run design:drift -- --update-baseline` and commit `docs/design-drift/baseline/`.');
  return `${lines.join('\n')}\n`;
}
