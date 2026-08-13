/**
 * Derives the app's real, capturable surfaces from the Next.js App Router tree and
 * diffs them against the committed surface list in docs/captured-surfaces.json.
 *
 * Why this exists (#142): the captured-surface list used by the UI/UX scoring
 * programme was a hand-maintained claim. `/workspace/frontend-revenue` shipped in
 * commit 690a5fb and never entered the list, so every scoring round measured the app
 * without ever looking at that cockpit — absence of evidence scored as absence of a
 * problem. Deriving the list from the routes the app actually serves means a newly
 * added route fails this check until someone records a capture decision for it.
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

export type CaptureDecision = 'required' | 'excluded';

export interface CapturedSurfaceEntry {
  route: string;
  capture: CaptureDecision;
  reason?: string;
}

export interface CapturedSurfaceManifest {
  surfaces: CapturedSurfaceEntry[];
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

export function diffSurfaces(
  derived: string[],
  manifest: CapturedSurfaceManifest
): SurfaceDiff {
  const declared = manifest.surfaces.map((surface) => surface.route).sort();
  const declaredSet = new Set(declared);
  const derivedSet = new Set(derived);
  return {
    derived,
    declared,
    missingFromManifest: derived.filter((route) => !declaredSet.has(route)),
    staleInManifest: declared.filter((route) => !derivedSet.has(route)),
    exclusionsWithoutReason: manifest.surfaces
      .filter((surface) => surface.capture === 'excluded' && !surface.reason?.trim())
      .map((surface) => surface.route),
  };
}

export function deriveSurfacesFromRepo(repoRoot: string): string[] {
  const appDir = path.join(repoRoot, APP_DIR_RELATIVE_PATH);
  return expandDynamicRoutes(routePatternsFromPageFiles(findPageFiles(appDir)));
}

export function readManifest(repoRoot: string): CapturedSurfaceManifest {
  const raw = fs.readFileSync(path.join(repoRoot, MANIFEST_RELATIVE_PATH), 'utf8');
  return JSON.parse(raw) as CapturedSurfaceManifest;
}

export function formatDiff(diff: SurfaceDiff): string {
  const lines: string[] = [];
  if (diff.missingFromManifest.length > 0) {
    lines.push(
      `Routes the app serves but ${MANIFEST_RELATIVE_PATH} does not list (they would score as if they were fine):`
    );
    for (const route of diff.missingFromManifest) lines.push(`  + ${route}`);
    lines.push(
      `  Fix: add each route to ${MANIFEST_RELATIVE_PATH} with capture "required", or "excluded" plus a reason.`
    );
  }
  if (diff.staleInManifest.length > 0) {
    lines.push(`Surface-list entries with no matching route in the app:`);
    for (const route of diff.staleInManifest) lines.push(`  - ${route}`);
  }
  if (diff.exclusionsWithoutReason.length > 0) {
    lines.push(`Excluded surfaces with no reason recorded:`);
    for (const route of diff.exclusionsWithoutReason) lines.push(`  ? ${route}`);
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
  const problems =
    diff.missingFromManifest.length + diff.staleInManifest.length + diff.exclusionsWithoutReason.length;
  if (problems > 0) {
    console.error(formatDiff(diff));
    console.error(`\ncaptured-surface drift: ${problems} problem(s) across ${derived.length} derived route(s).`);
    process.exit(1);
  }
  console.log(
    `captured-surface list matches the app: ${derived.length} route(s) derived, ${diff.declared.length} declared.`
  );
}
