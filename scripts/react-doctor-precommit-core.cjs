const FRONTEND_SOURCE_PATTERN = /^(src|app|components|lib|hooks)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/i;

function normalizeRepoRelativePath(candidate) {
  const normalized = String(candidate ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");

  if (
    !normalized ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function selectFrontendFiles(candidates) {
  const selected = new Set();

  for (const candidate of candidates) {
    const normalized = normalizeRepoRelativePath(candidate);
    if (normalized && FRONTEND_SOURCE_PATTERN.test(normalized)) {
      selected.add(normalized);
    }
  }

  return [...selected].sort();
}

function readStagedFrontendFiles({ spawnSync, repoRoot }) {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      shell: false,
    }
  );

  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error:
        result.error?.message ||
        String(result.stderr || "Could not read staged files from the Git index.").trim(),
    };
  }

  return {
    ok: true,
    files: selectFrontendFiles(String(result.stdout || "").split("\0")),
  };
}

function buildReactDoctorArgs() {
  return [
    "-y",
    "react-doctor@latest",
    ".",
    "--verbose",
    "--scope",
    "files",
    "--staged",
    "--blocking",
    "warning",
    "--no-score",
    "--no-color",
  ];
}

function classifyReactDoctorResult(result, output) {
  if (result.error) {
    return { ok: false, message: `Failed to start React Doctor: ${result.error.message}` };
  }

  if (result.status === null) {
    const reason = result.signal ? `signal ${result.signal}` : "unknown termination";
    return { ok: false, message: `React Doctor exited unexpectedly (${reason}).` };
  }

  if (/No source files found\.|No staged source files found\./i.test(output)) {
    return { ok: true, skipped: true, message: "No staged frontend source files found." };
  }

  if (result.status === 0) {
    return {
      ok: true,
      skipped: false,
      message: "Staged frontend diagnostics passed the local warning-level gate.",
    };
  }

  return {
    ok: false,
    message: `React Doctor found blocking staged diagnostics (exit ${result.status}).`,
  };
}

module.exports = {
  buildReactDoctorArgs,
  classifyReactDoctorResult,
  normalizeRepoRelativePath,
  readStagedFrontendFiles,
  selectFrontendFiles,
};
