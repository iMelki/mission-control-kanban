const ENCODED_SEPARATOR_PATTERN = /%(?:25)*(?:2f|5c)/i;
const DRIVE_PATH_PATTERN = /^[A-Za-z]:/;
const GLOB_PATTERN = /[*?]/;

export type FactoryPathKind = "scope" | "changed";

export function factoryPathValidationError(
  value: unknown,
  kind: FactoryPathKind,
): string | null {
  if (typeof value !== "string" || value.length === 0) return "must be a non-empty string";
  if (value.length > 512) return "must be at most 512 characters";
  if (value !== value.trim()) return "must not contain leading or trailing whitespace";
  if (value.normalize("NFC") !== value) return "must use NFC-normalized Unicode";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "must not contain control characters";
  if (value.startsWith("/") || DRIVE_PATH_PATTERN.test(value)) return "must be repository-relative";
  if (value.startsWith("//") || value.startsWith("\\\\")) return "must not be a UNC path";
  if (value.includes("\\")) return "must use forward slashes";
  if (ENCODED_SEPARATOR_PATTERN.test(value)) return "must not contain encoded path separators";
  if (value.startsWith("~") && (value.length === 1 || value[1] === "/")) {
    return "must not use a home-directory shorthand";
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0)) return "must not contain empty path segments";
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "must not contain dot or dot-dot path segments";
  }
  if (kind === "changed" && GLOB_PATTERN.test(value)) {
    return "changed paths must not contain glob tokens";
  }
  return null;
}

export function isCanonicalFactoryPath(value: unknown, kind: FactoryPathKind): value is string {
  return factoryPathValidationError(value, kind) === null;
}

function escapeRegExp(character: string) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function scopePatternToRegExp(scope: string) {
  let expression = "^";
  for (let index = 0; index < scope.length; index += 1) {
    const character = scope[index];
    if (character === "*" && scope[index + 1] === "*") {
      const followedBySlash = scope[index + 2] === "/";
      expression += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
      continue;
    }
    if (character === "*") {
      expression += "[^/]*";
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += escapeRegExp(character);
  }
  return new RegExp(`${expression}$`);
}

export function factoryPathMatchesScope(changedPath: string, allowedScope: readonly string[]) {
  if (!isCanonicalFactoryPath(changedPath, "changed")) return false;
  return allowedScope.some((scope) => (
    isCanonicalFactoryPath(scope, "scope")
    && scopePatternToRegExp(scope).test(changedPath)
  ));
}

export function factoryChangedPathsMatchScope(
  changedPaths: readonly string[],
  allowedScope: readonly string[],
) {
  return changedPaths.length > 0
    && allowedScope.length > 0
    && changedPaths.every((changedPath) => factoryPathMatchesScope(changedPath, allowedScope));
}
