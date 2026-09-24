/**
 * Resolves the set of source files that render a given surface, and fingerprints their
 * CONTENT, so a capture can be invalidated when the thing it measured changes.
 *
 * Why this exists (#147). `docs/captured-surfaces.json` records a `capturedAt.commit`
 * per surface. Nothing ever compared that commit to the code. `scripts/derive-captured-
 * surfaces.ts` validated the sha's SHAPE (40 hex) and stopped there, so a surface could
 * drift back to unmeasured while the gate stayed green — the same "absence of evidence
 * scored as absence of a problem" shape as #142 and #144, one level up.
 *
 * That was not hypothetical when this was written: `5b846ce` changed
 * `src/app/globals.css`, which the root layout imports and every surface therefore
 * renders through, yet eight of the nine surfaces still cited the pre-change commit
 * `e50e256` and `npm run surfaces:check` exited 0.
 *
 * ---------------------------------------------------------------------------
 * HOW DEEP THE DEPENDENCY SET GOES, AND WHY
 * ---------------------------------------------------------------------------
 * A route's `page.tsx` alone is NOT the surface. `/settings` renders
 * `RuntimeConfigTemplateGallery`, and the #145 clipping bug lived in that component,
 * not in the page. Hashing only `page.tsx` would have missed the very bug the capture
 * was re-taken for.
 *
 * A whole-repo hash is the other failure: every commit would invalidate every surface,
 * the gate would cry wolf on doc edits and API changes, and it would be routed around
 * within a week. This repo's own history is the argument — most commits touch
 * `scripts/`, `tests/`, `docs/` or `src/app/api/`, none of which render anything.
 *
 * So: the dependency set is the TRANSITIVE CLOSURE OF STATIC LOCAL IMPORTS, seeded from
 * the files the App Router actually renders for that route:
 *   - the route's own `page.tsx` (`/workspace/<slug>` resolves to `[slug]/page.tsx`),
 *   - every `layout.tsx` / `template.tsx` on the route's ancestor path — these always
 *     wrap the page, and the root layout is how `globals.css` reaches every surface,
 *   - the styling configuration that decides what the utility classes in those files
 *     MEAN (`tailwind.config.ts`, `postcss.config.mjs`).
 * The walk follows `@/…`, `./…` and `../…` specifiers only. Bare specifiers are
 * node_modules and stop the walk.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS WILL MISS. Stated so nobody reads a green gate as more than it is.
 * ---------------------------------------------------------------------------
 *  1. npm dependency changes. `package-lock.json` is deliberately NOT in the set: a
 *     lucide-react or tailwind bump can genuinely reflow a page, but including the lock
 *     file invalidates all nine surfaces on every routine bump, which is the cry-wolf
 *     failure above. This is the largest known blind spot.
 *  2. Runtime data. `/settings` renders whatever `MCK_*` env vars resolve on the host;
 *     `/workspace/<slug>` renders database rows. Content can change the layout with no
 *     source file changing at all.
 *  3. API route handlers under `src/app/api/**`. A page that `fetch`es a string URL has
 *     no static import edge to follow, so a response-shape change is invisible here.
 *  4. `loading.tsx` / `error.tsx` / `not-found.tsx`. They render transiently or on
 *     failure, not in the settled state the probe measures. None exist today.
 *  5. `next.config.mjs`, fonts and other `public/` assets.
 *  6. Dynamic `import(variable)` — only literal specifiers are resolvable statically.
 * Unresolvable literal imports are reported rather than dropped, so the set cannot go
 * quietly incomplete: an incomplete set makes the digest a lie by omission.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { GITHUB_PROJECT_WORKSPACE_MAPPINGS } from '../src/lib/github-project-sync';

/** Bumped when the resolution rules change, so old digests are not silently compared
 *  against a set computed by different rules. A bump invalidates every capture ON PURPOSE. */
export const DEPENDENCY_CONTRACT_VERSION = 1;

const SRC_DIR = 'src';
const APP_DIR = 'src/app';

/** Config files that decide what the classes in every rendered file mean. */
export const GLOBAL_STYLE_SEEDS = ['tailwind.config.ts', 'postcss.config.mjs'];

/** Files the App Router wraps a page with, innermost last. */
const WRAPPER_BASENAMES = ['layout', 'template'];

const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.css', '.json'];
/** Extensions worth scanning for further imports. A .json leaf has none. */
const SCANNABLE = /\.(tsx?|jsx?|mjs|cjs|css)$/;

/**
 * Literal module specifiers: `from '…'`, `import('…')`, `require('…')`, and the bare
 * `import '…'` side-effect form (how `globals.css` enters the graph), plus CSS `@import`.
 */
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|@import\s+(?:url\()?\s*)['"]([^'"]+)['"]/g;

const isLocalSpecifier = (specifier: string): boolean =>
  specifier.startsWith('@/') || specifier.startsWith('./') || specifier.startsWith('../');

const toPosix = (relativePath: string): string => relativePath.split(path.sep).join('/');

function firstExistingFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Resolves one local specifier to an absolute file, mirroring the `@/* -> ./src/*` tsconfig alias. */
export function resolveLocalSpecifier(
  repoRoot: string,
  fromFile: string,
  specifier: string
): string | null {
  if (!isLocalSpecifier(specifier)) return null;
  const base = specifier.startsWith('@/')
    ? path.join(repoRoot, SRC_DIR, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  return firstExistingFile([
    base,
    ...RESOLVE_EXTENSIONS.map((extension) => base + extension),
    ...RESOLVE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ]);
}

/** The App Router files that render `route`, outermost first. `null` when no page serves it. */
export function renderSeedsForRoute(repoRoot: string, route: string): string[] | null {
  const appDir = path.join(repoRoot, APP_DIR);
  const slugs = new Set(GITHUB_PROJECT_WORKSPACE_MAPPINGS.map((mapping) => mapping.slug));
  const rawSegments = route.split('/').filter((segment) => segment.length > 0);
  const segments = rawSegments.map((segment, index) =>
    rawSegments[0] === 'workspace' && index === 1 && slugs.has(segment) ? '[slug]' : segment
  );

  const seeds: string[] = [];
  // Wrappers on every ancestor directory, root first: they always wrap the page.
  for (let depth = 0; depth <= segments.length; depth += 1) {
    const dir = path.join(appDir, ...segments.slice(0, depth));
    for (const basename of WRAPPER_BASENAMES) {
      const found = firstExistingFile(
        RESOLVE_EXTENSIONS.map((extension) => path.join(dir, basename + extension))
      );
      if (found) seeds.push(found);
    }
  }

  const page = firstExistingFile(
    RESOLVE_EXTENSIONS.map((extension) => path.join(appDir, ...segments, `page${extension}`))
  );
  if (!page) return null;
  seeds.push(page);
  for (const seed of GLOBAL_STYLE_SEEDS) {
    const full = path.join(repoRoot, seed);
    if (fs.existsSync(full)) seeds.push(full);
  }
  return seeds;
}

export interface SurfaceDependencies {
  /** Repo-relative POSIX paths, sorted. The files whose content defines this surface. */
  files: string[];
  /** Literal local specifiers that resolved to nothing, as "file -> specifier". */
  unresolved: string[];
}

/** Walks the static local-import closure from the route's render seeds. */
export function resolveSurfaceDependencies(repoRoot: string, route: string): SurfaceDependencies | null {
  const seeds = renderSeedsForRoute(repoRoot, route);
  if (!seeds) return null;

  const visited = new Set<string>();
  const unresolved = new Set<string>();
  const stack = [...seeds];

  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (visited.has(file) || !fs.existsSync(file)) continue;
    visited.add(file);
    if (!SCANNABLE.test(file)) continue;

    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (!isLocalSpecifier(specifier)) continue;
      const resolved = resolveLocalSpecifier(repoRoot, file, specifier);
      if (resolved) stack.push(resolved);
      else unresolved.add(`${toPosix(path.relative(repoRoot, file))} -> ${specifier}`);
    }
  }

  return {
    files: [...visited].map((file) => toPosix(path.relative(repoRoot, file))).sort(),
    unresolved: [...unresolved].sort(),
  };
}

/**
 * Hashes content with line endings normalised to LF.
 *
 * This repo has no `.gitattributes` and `core.autocrlf=true`, so the same commit checks
 * out with CRLF on Windows and LF on Linux. Hashing raw bytes would make every capture
 * fail on the other platform — a gate that fails for a reason unrelated to its subject
 * gets disabled, so it would protect nothing.
 */
export function normalisedFileDigest(absolutePath: string): string {
  const text = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface SurfaceFingerprint extends SurfaceDependencies {
  /** sha256 over "<contract-version>\n<path>:<content-digest>\n…". 16 hex chars kept. */
  digest: string;
  fileCount: number;
}

/** The digest recorded in a capture and recomputed by the gate. Content, never ancestry. */
export function fingerprintSurface(repoRoot: string, route: string): SurfaceFingerprint | null {
  const dependencies = resolveSurfaceDependencies(repoRoot, route);
  if (!dependencies) return null;
  const hash = crypto.createHash('sha256');
  hash.update(`v${DEPENDENCY_CONTRACT_VERSION}\n`);
  for (const file of dependencies.files) {
    hash.update(`${file}:${normalisedFileDigest(path.join(repoRoot, file))}\n`);
  }
  return {
    ...dependencies,
    digest: hash.digest('hex').slice(0, 16),
    fileCount: dependencies.files.length,
  };
}
