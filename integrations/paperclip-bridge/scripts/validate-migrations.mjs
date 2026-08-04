import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POSTGRES_IMAGE =
  "postgres@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca";
const COMMAND_TIMEOUT_MS = 120_000;
const READY_ATTEMPTS = 60;
const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
const migrationFiles = [
  "001_mck_factory_bridge.sql",
  "002_lifecycle_retry_evidence.sql",
  "003_independent_lifecycle_channels.sql",
  "004_owner_fenced_leases.sql",
  "005_company_isolation.sql",
];
const containerName = `mck-bridge-migrations-${randomUUID().slice(0, 12)}`;
const ephemeralPassword = randomUUID().replaceAll("-", "");
const startedAt = Date.now();

function redact(value) {
  return String(value).replaceAll(ephemeralPassword, "<redacted>");
}

function printableArgs(args) {
  return args
    .map((value) => value.startsWith("POSTGRES_PASSWORD=")
      ? "POSTGRES_PASSWORD=<redacted>"
      : value)
    .join(" ");
}

function commandError(args, result) {
  const detail = redact(
    [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim()
      .slice(0, 4_000),
  );
  return new Error(
    `docker ${printableArgs(args)} failed with status ${String(result.status)}`
      + (detail ? `\n${detail}` : ""),
  );
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input: options.input,
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`docker ${args[0] ?? "command"} failed: ${redact(result.error.message)}`);
  }
  if (!options.allowFailure && result.status !== 0) {
    throw commandError(args, result);
  }
  return result;
}

function waitForPostgres() {
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1) {
    const result = docker(
      ["exec", containerName, "pg_isready", "-U", "postgres"],
      { allowFailure: true, timeoutMs: 5_000 },
    );
    if (result.status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("Pinned PostgreSQL 17 container did not become ready");
}

function psql(database, sql, options = {}) {
  const args = [
    "exec",
    "-i",
    containerName,
    "psql",
    "-X",
    "-U",
    "postgres",
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "--no-align",
    "--tuples-only",
    "--quiet",
  ];
  const result = docker(args, {
    input: sql,
    allowFailure: options.allowFailure,
  });
  if (options.expectFailure) {
    if (result.status === 0) {
      throw new Error(options.label ?? "Expected PostgreSQL command to fail closed");
    }
    const combined = `${result.stdout}\n${result.stderr}`;
    if (
      options.expectedMessage
      && !combined.includes(options.expectedMessage)
    ) {
      throw new Error(
        `${options.label ?? "PostgreSQL failure"} did not contain the expected diagnostic`,
      );
    }
  } else if (result.status !== 0) {
    throw commandError(args, result);
  }
  return result.stdout.trim();
}

function createDatabase(database) {
  docker(["exec", containerName, "createdb", "-U", "postgres", database]);
  psql(
    database,
    [
      "CREATE SCHEMA plugin_mck_factory_bridge_7ec566f3b4;",
      "CREATE TABLE public.issues (",
      "  id uuid PRIMARY KEY,",
      "  company_id uuid NOT NULL",
      ");",
    ].join("\n"),
  );
}

function migrationSql(filenames) {
  return filenames
    .map((filename) =>
      readFileSync(path.join(migrationsDirectory, filename), "utf8"))
    .join("\n");
}

function applyMigrations(database, filenames = migrationFiles) {
  psql(database, `BEGIN;\n${migrationSql(filenames)}\nCOMMIT;`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function validateEmptyInstall() {
  const database = "empty_install";
  createDatabase(database);
  applyMigrations(database);
  const result = psql(
    database,
    [
      "SELECT",
      "  (SELECT count(*) FROM plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings),",
      "  (SELECT count(*) FROM plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries),",
      "  (SELECT count(*) FROM plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries),",
      "  (SELECT count(*) FROM information_schema.columns",
      "   WHERE table_schema = 'plugin_mck_factory_bridge_7ec566f3b4'",
      "     AND column_name = 'company_id'",
      "     AND is_nullable = 'NO');",
    ].join("\n"),
  );
  assertEqual(result, "0|0|0|3", "Empty migration chain readback");
}

function seedLegacyMapping(database, input) {
  psql(
    database,
    [
      "INSERT INTO public.issues (id, company_id) VALUES",
      `  ('11111111-1111-4111-8111-111111111111', '${input.parentCompanyId}'),`,
      `  ('22222222-2222-4222-8222-222222222222', '${input.buildCompanyId}');`,
      "INSERT INTO plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings (",
      "  correlation_id, mck_task_id, attempt_id, dispatch_version, task_revision,",
      "  github_issue_url, callback_url, envelope, parent_issue_id, build_issue_id,",
      "  intake_status",
      ") VALUES (",
      "  'correlation-legacy', 'task-legacy', 'attempt-legacy', 2, repeat('a', 64),",
      "  'https://github.com/iMelki/mission-control-kanban/issues/47',",
      "  'http://127.0.0.1:3021/api/webhooks/agent-completion', '{}'::jsonb,",
      "  '11111111-1111-4111-8111-111111111111',",
      "  '22222222-2222-4222-8222-222222222222', 'accepted'",
      ");",
    ].join("\n"),
  );
}

function validateLegacyBackfill() {
  const database = "legacy_backfill";
  createDatabase(database);
  applyMigrations(database, migrationFiles.slice(0, 4));
  seedLegacyMapping(database, {
    parentCompanyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    buildCompanyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  psql(
    database,
    [
      "INSERT INTO plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries (",
      "  delivery_id, payload_hash, event_type, status, mapping_correlation_id",
      ") VALUES ('delivery-legacy', repeat('b', 64), 'mck.dispatch', 'accepted', 'correlation-legacy');",
      "INSERT INTO plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries (",
      "  delivery_key, correlation_id, delivery_id, callback_url, payload, raw_body,",
      "  payload_hash, status",
      ") VALUES (",
      "  'lifecycle-legacy', 'correlation-legacy', 'lifecycle-delivery-legacy',",
      "  'http://127.0.0.1:3021/api/webhooks/agent-completion', '{}'::jsonb, '{}',",
      "  repeat('c', 64), 'pending'",
      ");",
    ].join("\n"),
  );
  applyMigrations(database, [migrationFiles[4]]);

  const ownership = psql(
    database,
    [
      "SELECT company_id::text || ':' || correlation_id",
      "FROM plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings",
      "UNION ALL",
      "SELECT company_id::text || ':' || delivery_id",
      "FROM plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries",
      "UNION ALL",
      "SELECT company_id::text || ':' || delivery_key",
      "FROM plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries",
      "ORDER BY 1;",
    ].join("\n"),
  );
  assertEqual(
    ownership,
    [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:correlation-legacy",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:delivery-legacy",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:lifecycle-legacy",
    ].join("\n"),
    "Legacy company backfill",
  );

  const constraints = psql(
    database,
    [
      "SELECT conname || ':' || pg_get_constraintdef(oid)",
      "FROM pg_constraint",
      "WHERE connamespace = 'plugin_mck_factory_bridge_7ec566f3b4'::regnamespace",
      "  AND conname IN (",
      "    'bridge_mappings_pkey',",
      "    'bridge_deliveries_pkey',",
      "    'bridge_deliveries_mapping_company_fkey',",
      "    'lifecycle_deliveries_pkey',",
      "    'lifecycle_deliveries_company_delivery_key',",
      "    'lifecycle_deliveries_mapping_company_fkey'",
      "  )",
      "ORDER BY conname;",
    ].join("\n"),
  );
  for (const expected of [
    "bridge_mappings_pkey:PRIMARY KEY (company_id, correlation_id)",
    "bridge_deliveries_pkey:PRIMARY KEY (company_id, delivery_id)",
    "bridge_deliveries_mapping_company_fkey:FOREIGN KEY (company_id, mapping_correlation_id)",
    "lifecycle_deliveries_pkey:PRIMARY KEY (company_id, delivery_key)",
    "lifecycle_deliveries_company_delivery_key:UNIQUE (company_id, delivery_id)",
    "lifecycle_deliveries_mapping_company_fkey:FOREIGN KEY (company_id, correlation_id)",
  ]) {
    if (!constraints.includes(expected)) {
      throw new Error(`Legacy constraint readback omitted ${expected}`);
    }
  }

  psql(
    database,
    [
      "INSERT INTO plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries (",
      "  company_id, delivery_id, payload_hash, event_type, status, mapping_correlation_id",
      ") VALUES (",
      "  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cross-company-delivery',",
      "  repeat('d', 64), 'mck.dispatch', 'accepted', 'correlation-legacy'",
      ");",
    ].join("\n"),
    {
      allowFailure: true,
      expectFailure: true,
      expectedMessage: "bridge_deliveries_mapping_company_fkey",
      label: "Cross-company delivery foreign key",
    },
  );
}

function validateFailClosedLegacyRow({
  database,
  parentCompanyId,
  buildCompanyId,
  removeIssueLinks = false,
  label,
}) {
  createDatabase(database);
  applyMigrations(database, migrationFiles.slice(0, 4));
  seedLegacyMapping(database, { parentCompanyId, buildCompanyId });
  if (removeIssueLinks) {
    psql(
      database,
      [
        "UPDATE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings",
        "SET parent_issue_id = NULL, build_issue_id = NULL",
        "WHERE correlation_id = 'correlation-legacy';",
      ].join("\n"),
    );
  }
  psql(
    database,
    `BEGIN;\n${migrationSql([migrationFiles[4]])}\nCOMMIT;`,
    {
      allowFailure: true,
      expectFailure: true,
      expectedMessage: "contains null values",
      label,
    },
  );
}

function cleanupContainer() {
  const cleanupArgs = ["rm", "--force", "--volumes", containerName];
  let removalError = null;
  try {
    const removed = docker(
      cleanupArgs,
      { allowFailure: true, timeoutMs: 30_000 },
    );
    if (removed.status !== 0) {
      removalError = commandError(cleanupArgs, removed);
    }
  } catch (error) {
    removalError = error;
  }

  const inspectArgs = ["container", "inspect", containerName];
  let inspectResult;
  try {
    inspectResult = docker(
      inspectArgs,
      { allowFailure: true, timeoutMs: 30_000 },
    );
  } catch (error) {
    throw new AggregateError(
      [removalError, error].filter(Boolean),
      "Could not verify PostgreSQL migration container cleanup",
    );
  }

  if (inspectResult.status === 0) {
    throw new AggregateError(
      [removalError].filter(Boolean),
      "PostgreSQL migration container remains after forced cleanup",
    );
  }
  const inspectDetail = `${inspectResult.stdout}\n${inspectResult.stderr}`;
  if (!/No such (?:container|object)/i.test(inspectDetail)) {
    throw new AggregateError(
      [removalError, commandError(inspectArgs, inspectResult)].filter(Boolean),
      "Could not verify PostgreSQL migration container absence",
    );
  }
}

let primaryError = null;
let cleanupError = null;
let validationResult = null;
try {
  docker([
    "run",
    "--detach",
    "--rm",
    "--pull=missing",
    "--name",
    containerName,
    "--env",
    `POSTGRES_PASSWORD=${ephemeralPassword}`,
    POSTGRES_IMAGE,
  ]);
  waitForPostgres();
  validateEmptyInstall();
  validateLegacyBackfill();
  validateFailClosedLegacyRow({
    database: "unscoped_legacy",
    parentCompanyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    buildCompanyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    removeIssueLinks: true,
    label: "Unscoped legacy migration",
  });
  validateFailClosedLegacyRow({
    database: "cross_company_legacy",
    parentCompanyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    buildCompanyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    label: "Cross-company legacy migration",
  });
  validationResult = {
    schema: "mck.paperclip-bridge-migration-validation.v1",
    status: "passed",
    postgresImage: POSTGRES_IMAGE,
    scenarios: [
      "empty-install",
      "legacy-company-backfill-and-composite-constraints",
      "cross-company-child-row-rejected",
      "unscoped-legacy-row-fails-closed",
      "cross-company-legacy-row-fails-closed",
    ],
    durationMs: Date.now() - startedAt,
  };
} catch (error) {
  primaryError = error;
} finally {
  try {
    cleanupContainer();
  } catch (error) {
    cleanupError = error;
  }
}

if (primaryError && cleanupError) {
  throw new AggregateError(
    [primaryError, cleanupError],
    "Migration validation failed and container cleanup could not be verified",
  );
}
if (primaryError) {
  throw primaryError;
}
if (cleanupError) {
  throw cleanupError;
}
console.log(JSON.stringify(validationResult));
