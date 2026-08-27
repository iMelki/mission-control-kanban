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
 * What this gate STILL did not guarantee (#147). A capture was validated for shape and
 * never for freshness. `capturedAt.commit` had to be 40 hex characters; nothing ever
 * compared it to the code. So a surface could be re-edited after its capture and the gate
 * stayed green — the capture drifted back to unmeasured while still reading as evidence.
 *
 *   (e) `capture: "required"` + a `capturedAt` naming a commit older than the files that
 *       render the surface passed. This was live, not hypothetical: `5b846ce` changed
 *       `src/app/globals.css`, which the root layout imports and every surface renders
 *       through, and eight of the nine surfaces still cited the pre-change `e50e256`.
 *
 * A capture record therefore now also carries `sourceDigest`: a content fingerprint of
 * the files that render that surface (see scripts/surface-dependencies.ts for the
 * dependency-resolution rules and, importantly, for what they miss). The gate recomputes
 * it from the working tree and fails when it moved. Content, not ancestry — a re-land or
 * a rebase that reproduces identical files keeps the capture valid, and a rewrite that
 * keeps the same sha does not.
 *
 * Usage:
 *   npx tsx scripts/derive-captured-surfaces.ts             # check, exit 1 on drift
 *   npx tsx scripts/derive-captured-surfaces.ts --list       # print derived routes
 *   npx tsx scripts/derive-captured-surfaces.ts --fingerprint # print each surface's digest
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GITHUB_PROJECT_WORKSPACE_MAPPINGS } from '../src/lib/github-project-sync';
import {
  DEPENDENCY_CONTRACT_VERSION,
  fingerprintSurface,
  type SurfaceFingerprint,
} from './surface-dependencies';

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
/** `sourceDigest`: the 16-hex fingerprint fingerprintSurface() produces. */
const SOURCE_DIGEST = /^[0-9a-f]{16}$/;

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
  /**
   * Content fingerprint (16 hex) of the files that render this surface, at capture time.
   * Recomputed by the gate; a mismatch means the surface changed since it was measured,
   * so the capture is no longer evidence about the current code (#147).
   */
  sourceDigest: string;
  /** How many files that fingerprint covered. Recorded so a shrinking set is visible. */
  sourceFileCount?: number;
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
  /** Captured entries whose rendering source changed after the capture was taken (#147). */
  staleCaptures: string[];
  /** Every complaint, including the shape violations the old cast hid. */
  problems: SurfaceProblem[];
}

/**
 * Supplies the current content fingerprint for a route, or null when nothing renders it.
 *
 * This is a REQUIRED argument to `diffSurfaces` rather than an optional one. An optional
 * freshness source would make "nobody passed it" indistinguishable from "nothing was
 * stale", which is the fail-open shape this whole file exists to close: the caller must
 * say what it is checking against.
 */
export type SurfaceFingerprintLookup = (route: string) => SurfaceFingerprint | null;

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
    // Hole (e): without a content fingerprint a capture can never be shown to be stale,
    // so it would read as evidence forever. A missing digest is not a fresh capture.
    if (!isNonEmptyString(record.sourceDigest) || !SOURCE_DIGEST.test(record.sourceDigest.trim())) {
      problems.push({
        route,
        code: 'capture_digest_missing',
        detail:
          `"capturedAt.sourceDigest" must be the 16-hex fingerprint of the files that render this ` +
          `surface; got ${JSON.stringify(record.sourceDigest)}. Without it the capture can never be ` +
          `shown to be stale. Print it with: npm run surfaces:fingerprint`,
      });
    }
    const capturedViewports = record.viewports;
    if (!Array.isArray(capturedViewports) || capturedViewports.length === 0) {
      problems.push({
        route,
        code: 'capture_viewports_invalid',
        detail: `"capturedAt.viewports" must list at least one viewport label`,
      });
    } else if (viewportLabels.size > 0) {
      const unknown = capturedViewports.filter((label) => !viewportLabels.has(String(label)));
      if (unknown.length > 0) {
        problems.push({
          route,
          code: 'capture_viewports_invalid',
          detail: `"capturedAt.viewports" names ${JSON.stringify(unknown)}, absent from the manifest "viewports" list`,
        });
      }
      const uncovered = [...viewportLabels].filter(
        (label) => !capturedViewports.map(String).includes(label)
      );
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

/**
 * Compares each capture's recorded fingerprint against the surface's CURRENT source.
 *
 * Only routes the app actually serves are checked: a route no longer served is already
 * reported as stale-in-manifest, and fingerprinting a route with no page would report a
 * second, less useful problem for the same fact.
 */
export function checkCaptureFreshness(
  manifest: unknown,
  derived: string[],
  fingerprintFor: SurfaceFingerprintLookup
): SurfaceProblem[] {
  if (typeof fingerprintFor !== 'function') {
    throw new TypeError('checkCaptureFreshness needs a fingerprint lookup; freshness is never skipped by omission');
  }
  const problems: SurfaceProblem[] = [];
  if (!isPlainObject(manifest) || !Array.isArray(manifest.surfaces)) return problems;
  const servedRoutes = new Set(derived);

  for (const raw of manifest.surfaces) {
    if (!isPlainObject(raw) || !isNonEmptyString(raw.route)) continue;
    const route = raw.route;
    if (!servedRoutes.has(route)) continue;
    if (raw.capture !== 'required') continue;
    if (!isPlainObject(raw.capturedAt)) continue;

    const recorded = raw.capturedAt.sourceDigest;
    if (!isNonEmptyString(recorded) || !SOURCE_DIGEST.test(recorded.trim())) continue; // already reported

    const current = fingerprintFor(route);
    if (!current) {
      problems.push({
        route,
        code: 'surface_dependencies_unresolvable',
        detail: `no App Router page renders ${route}, so its capture cannot be checked for staleness`,
      });
      continue;
    }
    if (current.unresolved.length > 0) {
      // An import the walker could not follow means the dependency set is incomplete, so
      // the digest is a lie by omission: a change behind that import would not invalidate.
      problems.push({
        route,
        code: 'surface_dependencies_unresolved',
        detail:
          `${current.unresolved.length} local import(s) in this surface's dependency set could not be ` +
          `resolved, so the fingerprint does not cover everything that renders it: ` +
          `${current.unresolved.slice(0, 3).join('; ')}`,
      });
    }
    if (current.digest !== recorded.trim()) {
      problems.push({
        route,
        code: 'capture_stale',
        detail:
          `${route} changed since it was captured: recorded sourceDigest ${recorded.trim()}, ` +
          `current ${current.digest} over ${current.fileCount} rendering file(s). ` +
          `The capture at ${String(raw.capturedAt.commit).slice(0, 12)} (${String(raw.capturedAt.date)}) ` +
          `describes source this app no longer serves, so it is not evidence about the code as it stands. ` +
          `Re-run npm run surfaces:probe for this surface and record the new capture.`,
      });
    }
  }
  return problems;
}

export function diffSurfaces(
  derived: string[],
  manifest: unknown,
  fingerprintFor: SurfaceFingerprintLookup
): SurfaceDiff {
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
  problems.push(...checkCaptureFreshness(manifest, derived, fingerprintFor));

  return {
    derived,
    declared,
    missingFromManifest,
    staleInManifest,
    staleCaptures: problems
      .filter((problem) => problem.code === 'capture_stale' && problem.route)
      .map((problem) => problem.route as string),
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
  if (diff.staleCaptures.length > 0) {
    lines.push(`  Stale captures (${diff.staleCaptures.length}): ${diff.staleCaptures.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Names which rendering files moved since a capture's commit, purely as an explanation.
 *
 * The FAILURE is decided by the content digest above; this only makes it actionable. It
 * is therefore allowed to come back empty (git missing, unreachable commit, a repo
 * exported without history) without changing the verdict — the gate has already failed
 * and already named the surface.
 */
export function explainStaleCapture(
  repoRoot: string,
  commit: string,
  dependencyFiles: string[]
): string[] | null {
  if (!FULL_SHA.test(commit)) return null;
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: repoRoot, stdio: 'ignore' });
    // Diff the whole tree and intersect in-process: passing 60+ pathspecs risks the
    // Windows argv limit, and one call cannot be truncated halfway.
    const changed = new Set(
      execFileSync('git', ['diff', '--name-only', commit], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );
    return dependencyFiles.filter((file) => changed.has(file));
  } catch {
    return null;
  }
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

  /** Memoised so nine surfaces sharing one component tree read each file once. */
  const fingerprintCache = new Map<string, SurfaceFingerprint | null>();
  const fingerprintFor: SurfaceFingerprintLookup = (route) => {
    if (!fingerprintCache.has(route)) fingerprintCache.set(route, fingerprintSurface(repoRoot, route));
    return fingerprintCache.get(route) ?? null;
  };

  if (process.argv.includes('--fingerprint')) {
    // Deliberately PRINTS and never writes. An auto-writer would let anyone re-green a
    // stale capture without re-measuring anything, which is the hole this closes.
    console.log(`surface dependency contract v${DEPENDENCY_CONTRACT_VERSION}\n`);
    for (const route of derived) {
      const fingerprint = fingerprintFor(route);
      if (!fingerprint) {
        console.log(`${route.padEnd(30)} (no page renders this route)`);
        continue;
      }
      console.log(
        `${route.padEnd(30)} sourceDigest ${fingerprint.digest}  over ${fingerprint.fileCount} file(s)` +
          (fingerprint.unresolved.length > 0 ? `  UNRESOLVED: ${fingerprint.unresolved.join('; ')}` : '')
      );
    }
    console.log(`\nRecord these in ${MANIFEST_RELATIVE_PATH} only alongside a capture you actually took.`);
    process.exit(0);
  }

  const manifest = readManifest(repoRoot);
  const diff = diffSurfaces(derived, manifest, fingerprintFor);
  if (diff.problems.length > 0) {
    console.error(formatDiff(diff));
    for (const route of diff.staleCaptures) {
      const entry = (manifest as CapturedSurfaceManifest).surfaces.find((surface) => surface.route === route);
      const fingerprint = fingerprintFor(route);
      const changed = entry?.capturedAt && fingerprint
        ? explainStaleCapture(repoRoot, entry.capturedAt.commit, fingerprint.files)
        : null;
      if (changed === null) {
        console.error(`\n  ${route}: capture commit unreachable from here, so the changed files cannot be listed.`);
      } else {
        console.error(`\n  ${route}: ${changed.length} rendering file(s) changed since the capture commit:`);
        for (const file of changed.slice(0, 12)) console.error(`      ${file}`);
        if (changed.length > 12) console.error(`      ... and ${changed.length - 12} more`);
      }
    }
    console.error(
      `\ncaptured-surface drift: ${diff.problems.length} problem(s) across ${derived.length} derived route(s).`
    );
    process.exit(1);
  }
  console.log(
    `captured-surface list matches the app: ${derived.length} route(s) derived, ${diff.declared.length} declared, ` +
      `every "required" surface carries a capture record or a tracked deferral, and every capture's ` +
      `sourceDigest still matches the files that render it (contract v${DEPENDENCY_CONTRACT_VERSION}).`
  );
}
