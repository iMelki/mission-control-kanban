/**
 * Path containment checks for routes that serve or act on files under a
 * configured base directory (PROJECTS_PATH, WORKSPACE_BASE_PATH).
 *
 * A plain `candidate.startsWith(base)` check is not enough:
 *   - `/projects-evil/x` starts with `/projects` (sibling-prefix escape);
 *   - a symlink inside the base can point anywhere on disk.
 *
 * So containment is checked against `base + path.sep`, and the decision is
 * made on the real (symlink-resolved) paths of both the target and the base.
 * Ported from crshdn/mission-control 555fa9a.
 */

import path from 'path';

export type ContainedPathResult =
  | { ok: true; realPath: string; realBase: string }
  | { ok: false; reason: 'outside-base' | 'not-found' };

/** True when `candidate` is `base` itself or a descendant of it. Both must be absolute. */
export function isWithinBase(candidate: string, base: string): boolean {
  if (candidate === base) return true;
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return candidate.startsWith(prefix);
}

async function realpathOrNull(target: string): Promise<string | null> {
  const fs = await import('node:fs/promises');
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

/** Upper bound on symlink hops followed while classifying a missing target (Linux uses 40). */
const MAX_LINK_HOPS = 40;

/**
 * Decide between `not-found` and `outside-base` for a target that does not exist.
 *
 * Answering `not-found` from the ENOENT alone is an existence oracle: if an
 * existing part of the path is a symlink that leaves the base, the route would
 * answer 404 when the outside path is missing and 403 when it exists. So the
 * deepest existing entry on the path is resolved first, and the answer is
 * `outside-base` whenever that entry (or, for a dangling symlink, the place it
 * points to) is outside every base, whether or not the outside path exists.
 */
async function classifyMissingTarget(
  absoluteTarget: string,
  realBases: readonly string[],
  hops = 0,
): Promise<'outside-base' | 'not-found'> {
  if (hops > MAX_LINK_HOPS) return 'outside-base';
  const fs = await import('node:fs/promises');
  const insideARealBase = (candidate: string) => realBases.some((real) => isWithinBase(candidate, real));

  // Deepest existing entry. lstat (not stat) so a dangling symlink counts as existing.
  let probe = absoluteTarget;
  let isSymlink: boolean;
  for (;;) {
    try {
      isSymlink = (await fs.lstat(probe)).isSymbolicLink();
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return 'outside-base';
      const parent = path.dirname(probe);
      if (parent === probe) return 'outside-base';
      probe = parent;
    }
  }

  let realProbe: string;
  try {
    realProbe = await fs.realpath(probe);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!isSymlink || (code !== 'ENOENT' && code !== 'ENOTDIR')) return 'outside-base';
    // Dangling symlink: classify by where it points, not by whether that place exists.
    let destination: string;
    try {
      destination = path.resolve(await fs.realpath(path.dirname(probe)), await fs.readlink(probe));
    } catch {
      return 'outside-base';
    }
    if (!insideARealBase(destination)) return 'outside-base';
    return classifyMissingTarget(destination, realBases, hops + 1);
  }
  return insideARealBase(realProbe) ? 'not-found' : 'outside-base';
}

/**
 * Resolve `targetPath` and confirm it lives inside one of `bases`.
 *
 * Paths that are lexically outside every base are rejected before the target
 * is touched on disk, so the result does not reveal whether files outside the
 * base exist. A target that is lexically inside but whose real path escapes
 * (symlink) is rejected as `outside-base`. A missing target is `not-found`
 * only when its deepest existing ancestor resolves inside a base; when that
 * ancestor escapes through a symlink it is `outside-base` (see
 * classifyMissingTarget), so 404 vs 403 never depends on an outside path.
 */
export async function resolvePathWithinBases(
  targetPath: string,
  bases: readonly string[],
): Promise<ContainedPathResult> {
  const absoluteTarget = path.resolve(targetPath);

  const resolvedBases: Array<{ lexical: string; real: string | null }> = [];
  for (const base of bases) {
    if (!base) continue;
    resolvedBases.push({ lexical: path.resolve(base), real: await realpathOrNull(base) });
  }

  const lexicallyInside = resolvedBases.some(
    ({ lexical, real }) => isWithinBase(absoluteTarget, lexical) || (real !== null && isWithinBase(absoluteTarget, real)),
  );
  if (!lexicallyInside) return { ok: false, reason: 'outside-base' };

  const fs = await import('node:fs/promises');
  let realPath: string;
  try {
    realPath = await fs.realpath(absoluteTarget);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      const realBases = resolvedBases.flatMap(({ real }) => (real === null ? [] : [real]));
      return { ok: false, reason: await classifyMissingTarget(absoluteTarget, realBases) };
    }
    // ELOOP, EACCES, etc.: refuse rather than guess.
    return { ok: false, reason: 'outside-base' };
  }

  const match = resolvedBases.find(({ real }) => real !== null && isWithinBase(realPath, real));
  if (!match || match.real === null) return { ok: false, reason: 'outside-base' };

  return { ok: true, realPath, realBase: match.real };
}
