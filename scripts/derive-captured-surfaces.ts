/**
 * Derives the app's real, capturable surfaces from the Next.js App Router tree and
 * checks the committed surface list in docs/captured-surfaces.json against them.
 *
 * Why this exists (#142): the captured-surface list used by the UI/UX scoring
 * programme was a hand-maintained claim. `/workspace/frontend-revenue` shipped in
 * commit 690a5fb and never entered the list, so every scoring round measured the app
 * without ever looking at that cockpit — absence of evidence scored as absence of a
 * problem.
 *
 * What this gate actually guarantees (#144). The first version of this script said it
 * "fails until someone records a capture decision". It did not. It failed until someone
 * recorded an *entry*, and an entry could be meaningless:
 *
 *   (a) an entry with no `capture` field at all passed, because nothing read it;
 *   (b) `capture: "excludedd"` passed, and the typo also dodged the missing-reason
 *       check, which string-matched the exact literal "excluded";
 *   (c) flipping every cockpit to `excluded` with `reason: "x"` passed, silently
 *       emptying the scoring programme;
 *   (d) `capture: "required"` on a surface nobody had ever captured passed — the same
 *       absence-of-evidence failure the gate was written to prevent. Six of the nine
 *       required surfaces had never been captured when this was found.
 *
 * The `CaptureDecision` union is a compile-time type. `JSON.parse` returns `any`, so the
 * cast to `CapturedSurfaceManifest` asserted a shape nothing verified. Every check below
 * therefore validates the parsed value at RUNTIME. A capture decision is now valid only
 * when it is a recognised decision, carries the justification its kind demands, and — for
 * `required` — names a capture that actually happened, at a commit, by a named method.
 *
 * Reuses two enumerations that already exist rather than inventing a third:
 *   1. the App Router filesystem convention (src/app/ ** /page.tsx), and
 *   2. GITHUB_PROJECT_WORKSPACE_MAPPINGS, the registry that defines every
 *      /workspace/[slug] cockpit (src/lib/github-project-sync.ts).
 *
 * Usage:
 *   npx tsx scripts/derive-captured-surfaces.ts          # check, exit 1 on drift
 *   npx tsx scripts/derive-captured-surfaces.ts --list    # print derived routes
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GITHUB_PROJECT_WORKSPACE_MAPPINGS } from '../src/lib/github-project-sync';

export const MANIFEST_RELATIVE_PATH = 'docs/captured-surfaces.json';
const APP_DIR_RELATIVE_PATH = 'src/app';

/** The only capture decisions this programme recognises. Checked at runtime, not just by tsc. */
export const CAPTURE_DECISIONS = ['required', 'excluded'] as const;
export type CaptureDecision = (typeof CAPTURE_DECISIONS)[number];

/**
 * A justification must carry information. "x", "n/a" and "TBD" are refusals to answer
 * dressed as answers, and they are what turns a review gate into a formality.
 */
const MIN_REASON_LENGTH = 20;
const PLACEHOLDER_REASON = /^(x+|n\/?a|tbd|todo|none|-+|\.+|\?+)$/i;
/** A tracking reference: a repo issue (#144), a full URL, or a 40-hex commit. */
const TRACKING_REFERENCE = /^(#\d+|https?:\/\/\S+|[0-9a-f]{40})$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Proof that a surface was actually looked at. Required for `capture: "required"`. */
export interface CaptureRecord {
  /** Full 40-hex commit whose source state was measured. Short shas are ambiguous. */
  commit: string;
  /** ISO date (YYYY-MM-DD) the capture was taken. */
  date: string;
  /** Viewport labels covered, which must exist in the manifest's `viewports`. */
  viewports: string[];
  /** How it was measured. A capture with no named method cannot be reproduced or trusted. */
  method: string;
}

/** An explicitly-reasoned downgrade: a required surface knowingly left uncaptured. */
export interface CaptureDeferral {
  reason: string;
  /** Where the debt is tracked, so a deferral cannot be a quiet permanent state. */
  issue: string;
}

export interface CapturedSurfaceEntry {
  route: string;
  capture: CaptureDecision;
  /** Why the surface is excluded. Mandatory for `excluded`. */
  reason?: string;
  /** Who decided to exclude it, so the downgrade is attributable. Mandatory for `excluded`. */
  excludedBy?: string;
  note?: string;
  capturedAt?: CaptureRecord;
  captureDeferred?: CaptureDeferral;
}

export interface ManifestViewport {
  label: string;
  width: number;
  height: number;
}

export interface CapturedSurfaceManifest {
  surfaces: CapturedSurfaceEntry[];
  viewports?: ManifestViewport[];
}

/** One machine-checkable complaint. `route` is null for whole-manifest problems. */
export interface SurfaceProblem {
  route: string | null;
  /** Stable identifier so tests can assert the SPECIFIC reason, not just "something failed". */
  code: string;
  detail: string;
}

export interface SurfaceDiff {
  derived: string[];
  declared: string[];
  /** Routes the app serves that the surface list does not mention at all. */
  missingFromManifest: string[];
  /** Surface-list entries that no longer correspond to a route the app serves. */
  staleInManifest: string[];
  /** Excluded entries that do not say why they are excluded. */
  exclusionsWithoutReason: string[];
  /** Required entries with no capture record and no explicit deferral. */
  requiredNeverCaptured: string[];
  /** Every complaint, including the shape violations the old cast hid. */
  problems: SurfaceProblem[];
}

/**
 * Turns App Router `page` file paths into route patterns.
 * Route groups `(name)` and parallel slots `@name` do not appear in the URL.
 */
export function routePatternsFromPageFiles(pageFilesRelativeToAppDir: string[]): string[] {
  const routes = new Set<string>();
  for (const file of pageFilesRelativeToAppDir) {
    const segments = file
      .split(/[\\/]/)
      .slice(0, -1)
      .filter((segment) => segment.length > 0)
      .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
      .filter((segment) => !segment.startsWith('@'));
    routes.add(`/${segments.join('/')}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1'));
  }
  return [...routes].sort();
}

/**
 * Expands dynamic segments into the concrete routes the app can actually serve.
 * `/workspace/[slug]` resolves through the workspace registry; any other dynamic
 * segment is reported unexpanded so it cannot be silently dropped from scoring.
 */
export function expandDynamicRoutes(
  routePatterns: string[],
  workspaceSlugs: string[] = GITHUB_PROJECT_WORKSPACE_MAPPINGS.map((mapping) => mapping.slug)
): string[] {
  const expanded = new Set<string>();
  for (const pattern of routePatterns) {
    if (pattern === '/workspace/[slug]') {
      for (const slug of workspaceSlugs) expanded.add(`/workspace/${slug}`);
      continue;
    }
    expanded.add(pattern);
  }
  return [...expanded].sort();
}

export function findPageFiles(appDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'api' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        found.push(path.relative(appDir, full));
      }
    }
  };
  walk(appDir);
  return found.sort();
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function checkJustification(
  route: string,
  field: string,
  value: unknown,
  code: string,
  problems: SurfaceProblem[]
): void {
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

/**
 * Validates the PARSED JSON at runtime. `JSON.parse` yields `any`; without this, the
 * `as CapturedSurfaceManifest` cast asserted a shape nothing had checked, and a missing
 * or misspelled `capture` sailed through as a valid decision.
 */
export function validateManifestShape(parsed: unknown): SurfaceProblem[] {
  const problems: SurfaceProblem[] = [];
  if (!isPlainObject(parsed)) {
    return [{ route: null, code: 'manifest_not_object', detail: 'the manifest is not a JSON object' }];
  }
  if (!Array.isArray(parsed.surfaces)) {
    return [{ route: null, code: 'surfaces_not_array', detail: '"surfaces" is missing or not an array' }];
  }

  const viewportLabels = new Set(
    Array.isArray(parsed.viewports)
      ? parsed.viewports.filter(isPlainObject).map((viewport) => String(viewport.label))
      : []
  );

  const seen = new Set<string>();
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

    // Hole (a): a missing `capture` was simply never read.
    if (!('capture' in raw)) {
      problems.push({
        route,
        code: 'capture_missing',
        detail: `no "capture" field; an entry without a decision is not a decision`,
      });
      return;
    }
    // Hole (b): "excludedd" is not a decision, and it must not dodge the reason check.
    if (!CAPTURE_DECISIONS.includes(raw.capture as CaptureDecision)) {
      problems.push({
        route,
        code: 'capture_unrecognised',
        detail: `capture ${JSON.stringify(raw.capture)} is not one of ${CAPTURE_DECISIONS.join(' | ')}`,
      });
      return;
    }

    if (raw.capture === 'excluded') {
      // Hole (c): a blanket downgrade must cost a real justification and an owner.
      checkJustification(route, 'reason', raw.reason, 'exclusion_reason_missing', problems);
      if (!isNonEmptyString(raw.excludedBy) || !TRACKING_REFERENCE.test(raw.excludedBy.trim())) {
        problems.push({
          route,
          code: 'exclusion_untracked',
          detail: `"excludedBy" must name an issue (#144), a URL, or a 40-hex commit so the downgrade is attributable`,
        });
      }
      return;
    }

    requiredCount += 1;

    if (isPlainObject(raw.captureDeferred)) {
      // The explicitly-reasoned downgrade: allowed, but it must be justified and tracked.
      checkJustification(route, 'captureDeferred.reason', raw.captureDeferred.reason, 'deferral_reason_missing', problems);
      if (!isNonEmptyString(raw.captureDeferred.issue) || !TRACKING_REFERENCE.test(raw.captureDeferred.issue.trim())) {
        problems.push({
          route,
          code: 'deferral_untracked',
          detail: `"captureDeferred.issue" must name an issue, URL, or commit so the debt cannot go quiet`,
        });
      }
      if ('capturedAt' in raw) {
        problems.push({
          route,
          code: 'deferral_contradicts_capture',
          detail: `both "capturedAt" and "captureDeferred" are set; the surface is either captured or deferred`,
        });
      }
      return;
    }

    // Hole (d): required + never captured used to PASS. It is the whole failure mode.
    if (!('capturedAt' in raw)) {
      problems.push({
        route,
        code: 'required_never_captured',
        detail:
          `capture "required" but no "capturedAt" record: the surface is unmeasured, not known-good. ` +
          `Capture it (npm run surfaces:probe) or record an explicit "captureDeferred" with a reason and issue.`,
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
      problems.push({
        route,
        code: 'capture_viewports_invalid',
        detail: `"capturedAt.viewports" must list at least one viewport label`,
      });
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
  });

  // The wholesale-disable case: a programme that requires nothing measures nothing.
  if (parsed.surfaces.length > 0 && requiredCount === 0) {
    problems.push({
      route: null,
      code: 'programme_empty',
      detail: `every surface is excluded or absent, so the scoring programme covers nothing`,
    });
  }

  return problems;
}

export function diffSurfaces(derived: string[], manifest: unknown): SurfaceDiff {
  const problems = validateManifestShape(manifest);
  const surfaces: CapturedSurfaceEntry[] =
    isPlainObject(manifest) && Array.isArray(manifest.surfaces)
      ? (manifest.surfaces.filter((entry) => isPlainObject(entry) && isNonEmptyString(entry.route)) as CapturedSurfaceEntry[])
      : [];

  const declared = surfaces.map((surface) => surface.route).sort();
  const declaredSet = new Set(declared);
  const derivedSet = new Set(derived);

  const missingFromManifest = derived.filter((route) => !declaredSet.has(route));
  const staleInManifest = declared.filter((route) => !derivedSet.has(route));
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

  return {
    derived,
    declared,
    missingFromManifest,
    staleInManifest,
    exclusionsWithoutReason: problems
      .filter((problem) => problem.code.startsWith('exclusion_reason_missing') && problem.route)
      .map((problem) => problem.route as string),
    requiredNeverCaptured: problems
      .filter((problem) => problem.code === 'required_never_captured' && problem.route)
      .map((problem) => problem.route as string),
    problems,
  };
}

export function deriveSurfacesFromRepo(repoRoot: string): string[] {
  const appDir = path.join(repoRoot, APP_DIR_RELATIVE_PATH);
  return expandDynamicRoutes(routePatternsFromPageFiles(findPageFiles(appDir)));
}

/** Returns the parsed value UNVALIDATED and untyped on purpose: validation is diffSurfaces' job. */
export function readManifest(repoRoot: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST_RELATIVE_PATH), 'utf8'));
}

export function formatDiff(diff: SurfaceDiff): string {
  if (diff.problems.length === 0) return '';
  const lines: string[] = [`${MANIFEST_RELATIVE_PATH} does not describe a valid capture programme:`];
  for (const problem of diff.problems) {
    lines.push(`  [${problem.code}] ${problem.route ?? '(manifest)'}: ${problem.detail}`);
  }
  if (diff.missingFromManifest.length > 0) {
    lines.push(
      `  Fix: add each unlisted route with capture "required" plus a "capturedAt" record, or "excluded" plus a reason and "excludedBy".`
    );
  }
  return lines.join('\n');
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
})();

if (isDirectRun) {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
  const derived = deriveSurfacesFromRepo(repoRoot);
  if (process.argv.includes('--list')) {
    for (const route of derived) console.log(route);
    process.exit(0);
  }
  const diff = diffSurfaces(derived, readManifest(repoRoot));
  if (diff.problems.length > 0) {
    console.error(formatDiff(diff));
    console.error(
      `\ncaptured-surface drift: ${diff.problems.length} problem(s) across ${derived.length} derived route(s).`
    );
    process.exit(1);
  }
  console.log(
    `captured-surface list matches the app: ${derived.length} route(s) derived, ${diff.declared.length} declared, ` +
      `every "required" surface carries a capture record or a tracked deferral.`
  );
}
