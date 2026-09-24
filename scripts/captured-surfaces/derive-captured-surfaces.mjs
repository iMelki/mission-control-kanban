/**
 * CANONICAL captured-surface gate. Derives the routes a Next.js App Router app really
 * serves, and checks the repo's committed capture manifest against them.
 *
 * Promoted from mission-control-kanban (mission-control-kanban#142, #144), which shipped
 * the first working version. This file is the fleet-wide generalisation: zero dependencies,
 * plain ESM, no tsx, no repo-specific imports, runnable as
 *
 *   node <path>/derive-captured-surfaces.mjs --repo <repoRoot>
 *
 * WHY IT EXISTS  (uiux-fleet-rescore-2026-08-12.md, Gap 2)
 * -------------------------------------------------------
 * A route that is never captured scores as if it were fine. Absence of evidence reads as
 * absence of a problem. mission-control-kanban's Frontend Revenue cockpit shipped in
 * 690a5fb and scored 5.4 for five consecutive rounds purely by never being looked at.
 *
 * WHAT ROUND 6 PROVED THE FIRST VERSION COULD NOT CATCH  (all four exited 0)
 * -------------------------------------------------------------------------
 *   (a) an entry with no `capture` field, because nothing read it;
 *   (b) `capture: "excludedd"` — the typo also dodged the reason check, which
 *       string-matched the literal "excluded";
 *   (c) every cockpit flipped to `excluded` with `reason: "x"`, silently emptying the
 *       scoring programme;
 *   (d) `capture: "required"` on a surface nobody had ever captured — the exact failure
 *       the gate was written to prevent. Six of nine required surfaces were in that state.
 * All four are covered here, each with its own stable problem code.
 *
 * WHAT THIS VERSION ADDS ON TOP  (agent-settings, 2026-08-16)
 * ----------------------------------------------------------
 * 1. LIVENESS. Round 6 also proved that a capture can be taken against something that is
 *    not the app. content-factory answered HTTP 500 on a live socket for a whole round and
 *    still read as "browser-proven and current". A lane once measured 26 routes that had
 *    all 302'd to /login and reported identical readings. The predecessor probe recorded
 *    `status` and never asserted on it, never compared the final URL to the requested
 *    route, and never counted elements — so a 500 page, a login redirect and a loading
 *    skeleton were all recordable as clean captures. A capture record must now carry a
 *    `liveness` block proving it observed a 2xx response, at the route it asked for, with
 *    real rendered content. See probe-captured-surfaces.mjs, which emits it.
 * 2. ROUTER FIDELITY. The predecessor's segment filter was
 *      `s.startsWith('(') && s.endsWith(')')`
 *    which is right for route groups and wrong for two other Next conventions:
 *      - `_folder` PRIVATE folders opt the folder AND ALL SUBFOLDERS out of routing
 *        (nextjs.org/docs/app/getting-started/project-structure, "Private folders").
 *        The predecessor derived them as real routes.
 *      - INTERCEPTING routes `(.)f` `(..)f` `(..)(..)f` `(...)f` do not end in `)`, so the
 *        predecessor kept the marker as a literal URL segment and derived a route that
 *        cannot be visited. An intercepted route renders at the INTERCEPTED url on a hard
 *        load, so it is not a separate capturable surface.
 *    Both are latent rather than live in this fleet today, and that was MEASURED, not
 *    assumed: mission-control has 4 `_*` dirs and content-factory 1, and on 2026-08-16
 *    none of them contained a `page` file. No fleet app uses intercepting routes yet.
 *    Recorded as latent so nobody re-derives it as a live incident.
 * 3. REPO-AGNOSTIC DERIVATION. App dirs, dynamic-segment expansion and liveness thresholds
 *    come from config, not from an import of one repo's `src/lib`.
 * 4. CONCRETE URL FOR DYNAMIC ROUTES. `/reports/[token]` cannot be screenshotted. A
 *    capture of a dynamic pattern must name the concrete URL that was actually loaded.
 *
 * FAIL-CLOSED BY CONSTRUCTION
 * ---------------------------
 * There is no warn-only mode. A repo that has not adopted the liveness contract does not
 * quietly pass: it must either adopt it, or declare `livenessContract: "none"` WITH a
 * reason and a tracking issue — the same explicitly-reasoned, attributed downgrade the
 * manifest already demands for exclusions and deferrals. Silence is a failure.
 *
 * Usage:
 *   node derive-captured-surfaces.mjs --repo <root>            # check, exit 1 on drift
 *   node derive-captured-surfaces.mjs --repo <root> --list     # print derived routes
 *   node derive-captured-surfaces.mjs --repo <root> --json     # machine-readable report
 *   node derive-captured-surfaces.mjs --self-test              # negative proof, exit 1 on regress
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MANIFEST_RELATIVE_PATH = 'docs/captured-surfaces.json';
export const DEFAULT_APP_DIRS = ['src/app', 'app'];

/** The only capture decisions this programme recognises. Checked at RUNTIME, not by tsc. */
export const CAPTURE_DECISIONS = ['required', 'excluded'];
/** The only liveness-contract declarations. `none` is legal but must be justified. */
export const LIVENESS_CONTRACTS = ['v1', 'none'];

/** A justification must carry information. "x", "n/a", "TBD" are refusals dressed as answers. */
const MIN_REASON_LENGTH = 20;
const PLACEHOLDER_REASON = /^(x+|n\/?a|tbd|todo|none|-+|\.+|\?+)$/i;
/** A tracking reference: a repo issue (#144), a full URL, or a 40-hex commit. */
const TRACKING_REFERENCE = /^(#\d+|https?:\/\/\S+|[0-9a-f]{40})$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Liveness floors. Deliberately low: this rejects "nothing rendered", not "not pretty".
 * A fleet login page measured ~78 elements; a Next loading skeleton measures far fewer.
 * A repo may raise them in its manifest, never silently lower them below these.
 */
export const LIVENESS_FLOOR = { minElements: 100, minTextLength: 200 };

// ---------------------------------------------------------------------------
// 1. Route derivation — Next.js App Router filesystem conventions.
//    Source: nextjs.org/docs/app/getting-started/project-structure (v16.3.1, 2026-07-21).
// ---------------------------------------------------------------------------

const PAGE_FILE = /^page\.(tsx|ts|jsx|js|mjs)$/;
/** `(.)f` `(..)f` `(...)f` `(..)(..)f` — intercepting routes. Checked BEFORE route groups. */
const INTERCEPTING_SEGMENT = /^(\(\.{1,3}\))+./;
/** `(group)` — organisational only, omitted from the URL. */
const ROUTE_GROUP_SEGMENT = /^\(.+\)$/;
/** `_folder` — opts the folder and all its subfolders out of routing entirely. */
const PRIVATE_SEGMENT = /^_/;
/** `@slot` — a named parallel-route slot; never appears in the URL. */
const PARALLEL_SLOT_SEGMENT = /^@/;
/** `%5Ffoo` is the escape hatch for a URL segment that really does start with `_`. */
const ESCAPED_UNDERSCORE = /^%5F/i;

export function isPrivateSegment(segment) {
  return PRIVATE_SEGMENT.test(segment) && !ESCAPED_UNDERSCORE.test(segment);
}
export function isInterceptingSegment(segment) {
  return INTERCEPTING_SEGMENT.test(segment);
}
export function isRouteGroupSegment(segment) {
  return !isInterceptingSegment(segment) && ROUTE_GROUP_SEGMENT.test(segment);
}
export function isParallelSlotSegment(segment) {
  return PARALLEL_SLOT_SEGMENT.test(segment);
}
export function isDynamicRoute(route) {
  return route.includes('[');
}

/**
 * Turns App Router `page` file paths (relative to an app dir) into URL patterns.
 * Returns `{ routes, skipped }` so a dropped page file is visible, never silent.
 */
export function routePatternsFromPageFiles(pageFilesRelativeToAppDir) {
  const routes = new Set();
  const skipped = [];
  for (const file of pageFilesRelativeToAppDir) {
    const segments = file.split(/[\\/]/).slice(0, -1).filter((s) => s.length > 0);

    const privateAt = segments.find(isPrivateSegment);
    if (privateAt) {
      skipped.push({ file, reason: 'private-folder', segment: privateAt });
      continue;
    }
    const interceptAt = segments.find(isInterceptingSegment);
    if (interceptAt) {
      // Renders at the INTERCEPTED url on a hard load, so it is not its own surface.
      skipped.push({ file, reason: 'intercepting-route', segment: interceptAt });
      continue;
    }

    const urlSegments = segments
      .filter((s) => !isRouteGroupSegment(s) && !isParallelSlotSegment(s))
      .map((s) => s.replace(ESCAPED_UNDERSCORE, '_'));
    const route = `/${urlSegments.join('/')}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
    routes.add(route);
  }
  return { routes: [...routes].sort(), skipped };
}

/**
 * Expands dynamic patterns using explicitly configured values. A pattern with no configured
 * expansion is KEPT as a pattern rather than dropped, so it still demands a capture decision.
 */
export function expandDynamicRoutes(routePatterns, expansions = {}) {
  const expanded = new Set();
  for (const pattern of routePatterns) {
    const values = expansions[pattern];
    if (Array.isArray(values) && values.length > 0) {
      for (const value of values) {
        expanded.add(pattern.replace(/\[[^\]]+\]/, String(value)));
      }
      continue;
    }
    expanded.add(pattern);
  }
  return [...expanded].sort();
}

/** Bounded walk. `maxDepth` exists because unbounded recursive scans have frozen this host. */
export function findPageFiles(appDir, { maxDepth = 12, ignoreDirs = ['api', 'node_modules', '.next'] } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.includes(entry.name)) continue;
        walk(full, depth + 1);
        continue;
      }
      if (PAGE_FILE.test(entry.name)) found.push(path.relative(appDir, full));
    }
  };
  walk(appDir, 0);
  return found.sort();
}

// ---------------------------------------------------------------------------
// 2. Manifest validation. Everything below runs against the PARSED value.
//    `JSON.parse` returns `any`; a TypeScript cast asserts a shape nothing checked.
// ---------------------------------------------------------------------------

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const normalisePath = (p) => (typeof p === 'string' ? p.replace(/[?#].*$/, '').replace(/(.)\/+$/, '$1') : p);

function checkJustification(route, field, value, code, problems) {
  if (!isNonEmptyString(value)) {
    problems.push({ route, code, detail: `"${field}" is missing or empty` });
    return;
  }
  const trimmed = value.trim();
  if (PLACEHOLDER_REASON.test(trimmed)) {
    problems.push({
      route,
      code: `${code}_placeholder`,
      detail: `"${field}" is the placeholder ${JSON.stringify(trimmed)}, which records no decision`,
    });
    return;
  }
  if (trimmed.length < MIN_REASON_LENGTH) {
    problems.push({
      route,
      code: `${code}_placeholder`,
      detail: `"${field}" is ${trimmed.length} chars; a real justification needs at least ${MIN_REASON_LENGTH}`,
    });
  }
}

function checkTracking(route, field, value, code, problems, detail) {
  if (!isNonEmptyString(value) || !TRACKING_REFERENCE.test(value.trim())) {
    problems.push({ route, code, detail });
  }
}

/**
 * The liveness contract. This is the half the predecessor did not have, and it is the half
 * round 6 proved was load-bearing: a listening socket is not a served app.
 */
function checkLiveness(route, record, thresholds, problems) {
  const liveness = record.liveness;
  if (!isPlainObject(liveness)) {
    problems.push({
      route,
      code: 'liveness_missing',
      detail:
        `"capturedAt.liveness" is absent. A capture with no liveness evidence cannot ` +
        `distinguish the app from an HTTP 500, a login redirect, or a loading skeleton — all three ` +
        `have been recorded as clean captures in this fleet.`,
    });
    return;
  }
  // (i) A socket is not an app.
  if (!Number.isInteger(liveness.httpStatus) || liveness.httpStatus < 200 || liveness.httpStatus > 299) {
    problems.push({
      route,
      code: 'liveness_http_status',
      detail: `"liveness.httpStatus" must be 2xx; got ${JSON.stringify(liveness.httpStatus)}. content-factory answered 500 on a live socket for a whole scoring round.`,
    });
  }
  // (ii) A login redirect is a capture of the login page, not of this route.
  const finalPath = normalisePath(liveness.finalPath);
  const wanted = normalisePath(liveness.requestedPath ?? route);
  if (!isNonEmptyString(finalPath)) {
    problems.push({
      route,
      code: 'liveness_final_path_missing',
      detail: `"liveness.finalPath" must record the URL path the browser ended on, so a redirect cannot masquerade as a capture`,
    });
  } else if (finalPath !== wanted) {
    problems.push({
      route,
      code: 'liveness_redirected',
      detail: `the browser ended on ${JSON.stringify(finalPath)} but the surface is ${JSON.stringify(wanted)}: this captured a redirect target, not this route`,
    });
  }
  // (iii) A loading skeleton and an empty shell are not the page.
  if (!isPositiveInt(liveness.elementCount) || liveness.elementCount < thresholds.minElements) {
    problems.push({
      route,
      code: 'liveness_element_count',
      detail: `"liveness.elementCount" is ${JSON.stringify(liveness.elementCount)}; at least ${thresholds.minElements} DOM elements are required. A fleet login page measured ~78 and a loading skeleton fewer still.`,
    });
  }
  if (!Number.isInteger(liveness.textLength) || liveness.textLength < thresholds.minTextLength) {
    problems.push({
      route,
      code: 'liveness_text_length',
      detail: `"liveness.textLength" is ${JSON.stringify(liveness.textLength)}; at least ${thresholds.minTextLength} characters of rendered text are required`,
    });
  }
  if (!Number.isInteger(liveness.skeletonMarkers) || liveness.skeletonMarkers > 0) {
    problems.push({
      route,
      code: 'liveness_skeleton',
      detail: `"liveness.skeletonMarkers" must be present and 0; ${JSON.stringify(liveness.skeletonMarkers)} means the probe measured a loading state, not the page`,
    });
  }
}

export function resolveLivenessThresholds(parsed) {
  const declared = isPlainObject(parsed) && isPlainObject(parsed.liveness) ? parsed.liveness : {};
  return {
    // A repo may RAISE the floor; it may never lower it below the canonical minimum.
    minElements: Math.max(LIVENESS_FLOOR.minElements, Number(declared.minElements) || 0),
    minTextLength: Math.max(LIVENESS_FLOOR.minTextLength, Number(declared.minTextLength) || 0),
  };
}

export function validateManifestShape(parsed) {
  const problems = [];
  if (!isPlainObject(parsed)) {
    return [{ route: null, code: 'manifest_not_object', detail: 'the manifest is not a JSON object' }];
  }
  if (!Array.isArray(parsed.surfaces)) {
    return [{ route: null, code: 'surfaces_not_array', detail: '"surfaces" is missing or not an array' }];
  }

  // --- the liveness contract must be DECLARED. Silence is not legacy, it is a failure. ---
  let livenessEnforced = false;
  const contract = parsed.livenessContract;
  if (isPlainObject(contract) && contract.mode === 'none') {
    checkJustification(null, 'livenessContract.reason', contract.reason, 'liveness_contract_unjustified', problems);
    checkTracking(
      null,
      'livenessContract.issue',
      contract.issue,
      'liveness_contract_untracked',
      problems,
      `"livenessContract.issue" must name an issue, URL, or commit so an unproven capture programme cannot go quiet`
    );
  } else if (contract === 'v1' || (isPlainObject(contract) && contract.mode === 'v1')) {
    livenessEnforced = true;
  } else {
    problems.push({
      route: null,
      code: 'liveness_contract_undeclared',
      detail:
        `"livenessContract" is ${JSON.stringify(contract)}; it must be "v1" (every capture carries liveness evidence) ` +
        `or {"mode":"none","reason":...,"issue":...}. There is no warn-only mode: an undeclared contract is a failure.`,
    });
  }

  const thresholds = resolveLivenessThresholds(parsed);
  const viewportLabels = new Set(
    Array.isArray(parsed.viewports)
      ? parsed.viewports.filter(isPlainObject).map((v) => String(v.label))
      : []
  );

  const seen = new Set();
  let requiredCount = 0;

  parsed.surfaces.forEach((raw, index) => {
    const position = `surfaces[${index}]`;
    if (!isPlainObject(raw)) {
      problems.push({ route: null, code: 'entry_not_object', detail: `${position} is not an object` });
      return;
    }
    const route = isNonEmptyString(raw.route) ? raw.route : null;
    if (!route) {
      problems.push({ route: null, code: 'route_invalid', detail: `${position} has no usable "route" string` });
      return;
    }
    if (!route.startsWith('/')) {
      problems.push({ route, code: 'route_invalid', detail: `route ${JSON.stringify(route)} does not start with "/"` });
    }
    if (seen.has(route)) {
      problems.push({ route, code: 'route_duplicated', detail: `route ${route} is listed more than once` });
    }
    seen.add(route);

    // (a) a missing `capture` was simply never read.
    if (!('capture' in raw)) {
      problems.push({ route, code: 'capture_missing', detail: `no "capture" field; an entry without a decision is not a decision` });
      return;
    }
    // (b) "excludedd" is not a decision, and it must not dodge the reason check.
    if (!CAPTURE_DECISIONS.includes(raw.capture)) {
      problems.push({
        route,
        code: 'capture_unrecognised',
        detail: `capture ${JSON.stringify(raw.capture)} is not one of ${CAPTURE_DECISIONS.join(' | ')}`,
      });
      return;
    }

    if (raw.capture === 'excluded') {
      // (c) a blanket downgrade must cost a real justification and an owner.
      checkJustification(route, 'reason', raw.reason, 'exclusion_reason_missing', problems);
      checkTracking(
        route,
        'excludedBy',
        raw.excludedBy,
        'exclusion_untracked',
        problems,
        `"excludedBy" must name an issue (#144), a URL, or a 40-hex commit so the downgrade is attributable`
      );
      return;
    }

    requiredCount += 1;

    if (isPlainObject(raw.captureDeferred)) {
      checkJustification(route, 'captureDeferred.reason', raw.captureDeferred.reason, 'deferral_reason_missing', problems);
      checkTracking(
        route,
        'captureDeferred.issue',
        raw.captureDeferred.issue,
        'deferral_untracked',
        problems,
        `"captureDeferred.issue" must name an issue, URL, or commit so the debt cannot go quiet`
      );
      if ('capturedAt' in raw) {
        problems.push({
          route,
          code: 'deferral_contradicts_capture',
          detail: `both "capturedAt" and "captureDeferred" are set; the surface is either captured or deferred`,
        });
      }
      return;
    }

    // (d) required + never captured used to PASS. It is the whole failure mode.
    if (!('capturedAt' in raw)) {
      problems.push({
        route,
        code: 'required_never_captured',
        detail:
          `capture "required" but no "capturedAt" record: the surface is unmeasured, not known-good. ` +
          `Capture it (probe-captured-surfaces.mjs) or record an explicit "captureDeferred" with a reason and issue.`,
      });
      return;
    }
    const record = raw.capturedAt;
    if (!isPlainObject(record)) {
      problems.push({ route, code: 'capture_record_invalid', detail: `"capturedAt" is not an object` });
      return;
    }
    if (!isNonEmptyString(record.commit) || !FULL_SHA.test(record.commit.trim())) {
      problems.push({
        route,
        code: 'capture_record_invalid',
        detail: `"capturedAt.commit" must be a full 40-hex sha; got ${JSON.stringify(record.commit)}`,
      });
    }
    if (!isNonEmptyString(record.date) || !ISO_DATE.test(record.date.trim())) {
      problems.push({
        route,
        code: 'capture_record_invalid',
        detail: `"capturedAt.date" must be YYYY-MM-DD; got ${JSON.stringify(record.date)}`,
      });
    }
    if (!isNonEmptyString(record.method)) {
      problems.push({
        route,
        code: 'capture_record_invalid',
        detail: `"capturedAt.method" must name how the surface was measured, so the capture is reproducible`,
      });
    }
    if (!Array.isArray(record.viewports) || record.viewports.length === 0) {
      problems.push({ route, code: 'capture_viewports_invalid', detail: `"capturedAt.viewports" must list at least one viewport label` });
    } else if (viewportLabels.size > 0) {
      const unknown = record.viewports.filter((label) => !viewportLabels.has(String(label)));
      if (unknown.length > 0) {
        problems.push({
          route,
          code: 'capture_viewports_invalid',
          detail: `"capturedAt.viewports" names ${JSON.stringify(unknown)}, absent from the manifest "viewports" list`,
        });
      }
      const uncovered = [...viewportLabels].filter((label) => !record.viewports.map(String).includes(label));
      if (uncovered.length > 0) {
        problems.push({
          route,
          code: 'capture_viewports_incomplete',
          detail: `declared viewports ${JSON.stringify(uncovered)} were never captured for this surface`,
        });
      }
    }
    // A dynamic pattern cannot be visited. The capture must name the URL it really loaded.
    if (isDynamicRoute(route) && !isNonEmptyString(record.concreteUrl)) {
      problems.push({
        route,
        code: 'dynamic_capture_without_concrete_url',
        detail: `${route} is a dynamic pattern; "capturedAt.concreteUrl" must name the concrete URL the browser actually loaded`,
      });
    }
    if (livenessEnforced) checkLiveness(route, record, thresholds, problems);
  });

  if (parsed.surfaces.length > 0 && requiredCount === 0) {
    problems.push({
      route: null,
      code: 'programme_empty',
      detail: `every surface is excluded or absent, so the scoring programme covers nothing`,
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 3. Diff against what the app really serves.
// ---------------------------------------------------------------------------

export function diffSurfaces(derived, manifest, { skipped = [] } = {}) {
  const problems = validateManifestShape(manifest);
  const surfaces =
    isPlainObject(manifest) && Array.isArray(manifest.surfaces)
      ? manifest.surfaces.filter((e) => isPlainObject(e) && isNonEmptyString(e.route))
      : [];

  const declared = surfaces.map((s) => s.route).sort();
  const declaredSet = new Set(declared);
  const derivedSet = new Set(derived);

  const missingFromManifest = derived.filter((r) => !declaredSet.has(r));
  const staleInManifest = declared.filter((r) => !derivedSet.has(r));
  for (const route of missingFromManifest) {
    problems.push({
      route,
      code: 'route_missing_from_manifest',
      detail: `the app serves ${route} but the surface list does not list it, so it would score as if it were fine`,
    });
  }
  for (const route of staleInManifest) {
    problems.push({ route, code: 'route_stale_in_manifest', detail: `${route} is listed but the app no longer serves it` });
  }

  const codes = (prefix) => problems.filter((p) => p.code.startsWith(prefix) && p.route).map((p) => p.route);
  return {
    derived,
    declared,
    skipped,
    missingFromManifest,
    staleInManifest,
    exclusionsWithoutReason: codes('exclusion_reason_missing'),
    requiredNeverCaptured: problems.filter((p) => p.code === 'required_never_captured' && p.route).map((p) => p.route),
    livenessFailures: codes('liveness_'),
    problems,
  };
}

// ---------------------------------------------------------------------------
// 4. Repo wiring.
// ---------------------------------------------------------------------------

export function readConfig(repoRoot, explicitPath) {
  const candidates = [
    explicitPath,
    path.join(repoRoot, 'docs', 'captured-surfaces.config.json'),
    path.join(repoRoot, 'captured-surfaces.config.json'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { ...JSON.parse(fs.readFileSync(candidate, 'utf8')), configPath: candidate };
  }
  return {};
}

export function resolveDerivation(repoRoot, manifest, config) {
  const fromManifest = isPlainObject(manifest) && isPlainObject(manifest.derivation) ? manifest.derivation : {};
  const merged = { ...fromManifest, ...config };
  const appDirs = (merged.appDirs && merged.appDirs.length ? merged.appDirs : DEFAULT_APP_DIRS).filter((d) =>
    fs.existsSync(path.join(repoRoot, d))
  );
  return {
    appDirs,
    dynamicExpansions: merged.dynamicExpansions || {},
    ignoreDirs: merged.ignoreDirs || ['api', 'node_modules', '.next'],
    maxDepth: merged.maxDepth || 12,
    manifestPath: merged.manifestPath || DEFAULT_MANIFEST_RELATIVE_PATH,
  };
}

export function deriveSurfacesFromRepo(repoRoot, derivation) {
  const allFiles = [];
  const skipped = [];
  for (const appDir of derivation.appDirs) {
    const abs = path.join(repoRoot, appDir);
    const files = findPageFiles(abs, { maxDepth: derivation.maxDepth, ignoreDirs: derivation.ignoreDirs });
    const result = routePatternsFromPageFiles(files);
    allFiles.push(...result.routes);
    skipped.push(...result.skipped.map((s) => ({ ...s, appDir })));
  }
  return { routes: expandDynamicRoutes([...new Set(allFiles)].sort(), derivation.dynamicExpansions), skipped };
}

/** Returns the parsed value UNVALIDATED on purpose: validation is diffSurfaces' job. */
export function readManifest(repoRoot, manifestPath = DEFAULT_MANIFEST_RELATIVE_PATH) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, manifestPath), 'utf8'));
}

export function formatDiff(diff, manifestPath = DEFAULT_MANIFEST_RELATIVE_PATH) {
  if (diff.problems.length === 0) return '';
  const lines = [`${manifestPath} does not describe a valid capture programme:`];
  for (const p of diff.problems) lines.push(`  [${p.code}] ${p.route ?? '(manifest)'}: ${p.detail}`);
  if (diff.missingFromManifest.length > 0) {
    lines.push(`  Fix: add each unlisted route with capture "required" plus a "capturedAt" record, or "excluded" plus a reason and "excludedBy".`);
  }
  if (diff.livenessFailures.length > 0) {
    lines.push(`  Fix: re-run probe-captured-surfaces.mjs; a capture must prove it saw a 2xx response at the requested route with real rendered content.`);
  }
  return lines.join('\n');
}

export function checkRepo(repoRoot, { configPath } = {}) {
  const config = readConfig(repoRoot, configPath);
  const probeManifestPath = config.manifestPath || DEFAULT_MANIFEST_RELATIVE_PATH;
  const manifest = readManifest(repoRoot, probeManifestPath);
  const derivation = resolveDerivation(repoRoot, manifest, config);
  const { routes, skipped } = deriveSurfacesFromRepo(repoRoot, derivation);
  return { derivation, manifest, diff: diffSurfaces(routes, manifest, { skipped }) };
}

// ---------------------------------------------------------------------------
// 5. Self-test — the negative proof. Every fixture asserts its OWN failure code, so a
//    check that starts failing for an unrelated reason is not mistaken for coverage.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));

export function runSelfTest() {
  const fixturesDir = path.join(here, 'fixtures', 'manifests');
  const results = [];
  const record = (name, ok, detail) => results.push({ name, ok, detail });

  const eq = (name, actual, expected) => {
    const a = JSON.stringify([...actual].sort());
    const e = JSON.stringify([...expected].sort());
    record(name, a === e, a === e ? `codes ${a}` : `expected ${e}, got ${a}`);
  };
  const codesFor = (manifest, route) =>
    validateManifestShape(manifest).filter((p) => p.route === route).map((p) => p.code);

  // --- route derivation, including the two conventions the predecessor got wrong ---
  const derived = routePatternsFromPageFiles([
    'page.tsx',
    'settings/page.tsx',
    '(marketing)/pricing/page.tsx',
    '@modal/preview/page.tsx',
    '_internal/scratch/page.tsx',
    'blog/_drafts/secret/page.tsx',
    'feed/(.)photo/page.tsx',
    'feed/(..)(..)deep/page.tsx',
    '%5Fliteral/page.tsx',
    'reports/[token]/page.tsx',
  ]);
  eq('route derivation', derived.routes, ['/', '/_literal', '/preview', '/pricing', '/reports/[token]', '/settings']);
  eq(
    'private + intercepting page files are skipped, not silently dropped',
    derived.skipped.map((s) => s.reason),
    ['private-folder', 'private-folder', 'intercepting-route', 'intercepting-route']
  );
  eq(
    'dynamic expansion uses configured values',
    expandDynamicRoutes(['/workspace/[slug]', '/settings'], { '/workspace/[slug]': ['alpha', 'beta'] }),
    ['/settings', '/workspace/alpha', '/workspace/beta']
  );
  eq(
    'an unexpanded dynamic pattern is KEPT, so it still demands a decision',
    expandDynamicRoutes(['/reports/[token]'], {}),
    ['/reports/[token]']
  );

  // --- manifest fixtures, one failure mode each ---
  for (const file of fs.readdirSync(fixturesDir).sort()) {
    if (!file.endsWith('.json')) continue;
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
    const actual = fixture.route === null || fixture.route === undefined
      ? validateManifestShape(fixture.manifest).filter((p) => !p.route).map((p) => p.code)
      : codesFor(fixture.manifest, fixture.route);
    eq(`${file} :: ${fixture.expect_summary}`, actual, fixture.expect_codes);
  }

  // --- drift fixtures need the derived list, so they live here ---
  const validCapture = {
    commit: 'e50e2565631b00c25dd524bfd337f5cf1f635d06',
    date: '2026-08-13',
    viewports: ['mobile', 'desktop'],
    method: 'probe-captured-surfaces.mjs',
    liveness: { httpStatus: 200, finalPath: '/', elementCount: 900, textLength: 3000, skeletonMarkers: 0 },
  };
  const viewports = [{ label: 'mobile', width: 390, height: 844 }, { label: 'desktop', width: 1440, height: 900 }];
  const driftManifest = {
    livenessContract: 'v1',
    viewports,
    surfaces: [{ route: '/', capture: 'required', capturedAt: validCapture }],
  };
  const drift = diffSurfaces(['/', '/workspace/frontend-revenue'], driftManifest);
  eq(
    'a route the app serves but the manifest omits is drift',
    drift.problems.filter((p) => p.route === '/workspace/frontend-revenue').map((p) => p.code),
    ['route_missing_from_manifest']
  );
  record('the drift message names the failure mode', /score as if it were fine/.test(formatDiff(drift)), 'ok');
  const clean = diffSurfaces(['/'], driftManifest);
  eq('the positive control raises nothing', clean.problems.map((p) => p.code), []);

  const failed = results.filter((r) => !r.ok);
  return { results, failed, passed: results.length - failed.length, total: results.length };
}

// ---------------------------------------------------------------------------
// 6. CLI.
// ---------------------------------------------------------------------------

const isDirectRun = (() => {
  const entry = process.argv[1];
  return entry ? path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url)) : false;
})();

if (isDirectRun) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes('--self-test')) {
    const { results, failed, passed, total } = runSelfTest();
    for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : ` -- ${r.detail}`}`);
    console.log(`\nself-test: ${passed}/${total} passed.`);
    process.exit(failed.length > 0 ? 1 : 0);
  }

  const repoRoot = path.resolve(flag('--repo') || process.cwd());
  const configPath = flag('--config');

  if (argv.includes('--list')) {
    const config = readConfig(repoRoot, configPath);
    let manifest = {};
    try {
      manifest = readManifest(repoRoot, config.manifestPath || DEFAULT_MANIFEST_RELATIVE_PATH);
    } catch {
      /* --list must work before a manifest exists, so a repo can bootstrap one */
    }
    const derivation = resolveDerivation(repoRoot, manifest, config);
    const { routes, skipped } = deriveSurfacesFromRepo(repoRoot, derivation);
    if (argv.includes('--json')) {
      console.log(JSON.stringify({ repoRoot, appDirs: derivation.appDirs, routes, skipped }, null, 2));
    } else {
      for (const route of routes) console.log(route);
      for (const s of skipped) console.error(`  (skipped ${s.file}: ${s.reason} "${s.segment}")`);
    }
    process.exit(0);
  }

  const { derivation, diff } = checkRepo(repoRoot, { configPath });
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ repoRoot, appDirs: derivation.appDirs, ...diff }, null, 2));
    process.exit(diff.problems.length > 0 ? 1 : 0);
  }
  if (diff.problems.length > 0) {
    console.error(formatDiff(diff, derivation.manifestPath));
    console.error(`\ncaptured-surface drift: ${diff.problems.length} problem(s) across ${diff.derived.length} derived route(s).`);
    process.exit(1);
  }
  console.log(
    `captured-surface list matches the app: ${diff.derived.length} route(s) derived, ${diff.declared.length} declared, ` +
      `every "required" surface carries a capture record or a tracked deferral, and every capture carries liveness evidence.`
  );
}
