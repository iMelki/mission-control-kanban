import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertExactTestedHostCommit } from "../src/host-compatibility.js";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const hostRoot = path.resolve(
  process.env.PAPERCLIP_HOST_PATH
    ?? path.join(pluginRoot, "..", "..", "..", "paperclip"),
);
const packageJson = JSON.parse(
  readFileSync(path.join(pluginRoot, "package.json"), "utf8"),
) as {
  paperclipHostCompatibility?: {
    testedCommit?: string;
    testedFiles?: Array<{
      path?: string;
      blobSha?: string;
      sha256?: string;
    }>;
  };
};
const compatibility = packageJson.paperclipHostCompatibility ?? {};
const expectedCommit = compatibility.testedCommit ?? "";
const testedFiles = compatibility.testedFiles ?? [];
const migrationFiles = [
  "001_mck_factory_bridge.sql",
  "002_lifecycle_retry_evidence.sql",
  "003_independent_lifecycle_channels.sql",
  "004_owner_fenced_leases.sql",
  "005_company_isolation.sql",
];
const validatorPath = path.join(
  hostRoot,
  "server",
  "src",
  "services",
  "plugin-database.ts",
);

function git(args: string[]): string {
  return execFileSync("git", ["-C", hostRoot, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  }).trim();
}

// Kept byte-for-byte equivalent to Paperclip 021ab2f's private splitter. The
// host commit and validator file must be exact and clean before this is used.
function splitSqlStatements(input: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | "\"" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char === ";") {
      const statement = input.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  const trailing = input.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

if (!existsSync(validatorPath)) {
  throw new Error(`Paperclip host validator is unavailable at ${validatorPath}`);
}
const actualCommit = git(["rev-parse", "HEAD"]);
assertExactTestedHostCommit(expectedCommit, actualCommit);
const origin = git(["remote", "get-url", "origin"]);
if (origin !== "git@github.com:iMelki/paperclip.git") {
  throw new Error("Paperclip host origin is not the expected owned fork");
}
try {
  execFileSync(
    "git",
    ["-C", hostRoot, "diff", "--quiet", "HEAD", "--", "server/src/services/plugin-database.ts"],
    { timeout: 30_000, windowsHide: true },
  );
} catch {
  throw new Error("Paperclip host migration validator has uncommitted changes");
}

if (testedFiles.length > 0) {
  for (const entry of testedFiles) {
    const relativePath = entry.path?.trim() ?? "";
    if (
      !relativePath
      || path.isAbsolute(relativePath)
      || relativePath.includes("..")
      || relativePath.includes("\\")
      || !entry.blobSha?.match(/^[a-f0-9]{40}$/)
      || !entry.sha256?.match(/^[a-f0-9]{64}$/)
    ) {
      throw new Error("Plugin package declares an invalid Paperclip host file attestation");
    }
    const hostFile = path.resolve(hostRoot, relativePath);
    if (!hostFile.startsWith(`${hostRoot}${path.sep}`) || !existsSync(hostFile)) {
      throw new Error(`Paperclip host compatibility file is unavailable: ${relativePath}`);
    }
    const actualBlob = git(["rev-parse", `HEAD:${relativePath}`]);
    if (actualBlob !== entry.blobSha) {
      throw new Error(
        `Paperclip host file blob mismatch for ${relativePath}: expected ${entry.blobSha}, got ${actualBlob}`,
      );
    }
    const actualSha256 = createHash("sha256")
      .update(readFileSync(hostFile))
      .digest("hex");
    if (actualSha256 !== entry.sha256) {
      throw new Error(
        `Paperclip host file SHA-256 mismatch for ${relativePath}: expected ${entry.sha256}, got ${actualSha256}`,
      );
    }
  }
}

const hostModule = await import(pathToFileURL(validatorPath).href);
const derivePluginDatabaseNamespace = hostModule
  .derivePluginDatabaseNamespace as (
    pluginKey: string,
    namespaceSlug?: string,
  ) => string;
const validatePluginMigrationStatement = hostModule
  .validatePluginMigrationStatement as (
    statement: string,
    namespace: string,
    coreReadTables?: readonly string[],
  ) => void;
if (
  typeof derivePluginDatabaseNamespace !== "function"
  || typeof validatePluginMigrationStatement !== "function"
) {
  throw new Error("Paperclip host migration validator exports are unavailable");
}

const namespace = derivePluginDatabaseNamespace(
  "imelki.mck-paperclip-bridge",
  "mck_factory_bridge",
);
if (namespace !== "plugin_mck_factory_bridge_7ec566f3b4") {
  throw new Error(`Unexpected Paperclip plugin namespace: ${namespace}`);
}

let statementCount = 0;
for (const migrationFile of migrationFiles) {
  const migrationPath = path.join(pluginRoot, "migrations", migrationFile);
  const statements = splitSqlStatements(readFileSync(migrationPath, "utf8"));
  if (statements.length === 0) {
    throw new Error(`Plugin migration is empty: ${migrationFile}`);
  }
  for (const statement of statements) {
    validatePluginMigrationStatement(statement, namespace, ["issues"]);
    statementCount += 1;
  }
}

console.log(JSON.stringify({
  schema: "mck.paperclip-host-migration-validation.v1",
  status: "passed",
  hostCommit: actualCommit,
  hostValidatorSha256: createHash("sha256")
    .update(readFileSync(validatorPath))
    .digest("hex"),
  migrationCount: migrationFiles.length,
  statementCount,
}));
