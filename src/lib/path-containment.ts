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

/**
 * Resolve `targetPath` and confirm it lives inside one of `bases`.
 *
 * Paths that are lexically outside every base are rejected before the target
 * is touched on disk, so the result does not reveal whether files outside the
 * base exist. A target that is lexically inside but whose real path escapes
 * (symlink) is rejected as `outside-base`.
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
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'not-found' };
    // ELOOP, EACCES, etc.: refuse rather than guess.
    return { ok: false, reason: 'outside-base' };
  }

  const match = resolvedBases.find(({ real }) => real !== null && isWithinBase(realPath, real));
  if (!match || match.real === null) return { ok: false, reason: 'outside-base' };

  return { ok: true, realPath, realBase: match.real };
}
