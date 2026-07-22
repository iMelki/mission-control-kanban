import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import reactDoctorPrecommit from "../scripts/react-doctor-precommit-core.cjs";

const {
  buildReactDoctorArgs,
  classifyReactDoctorResult,
  readStagedFrontendFiles,
  resolveNpxInvocation,
  selectFrontendFiles,
} = reactDoctorPrecommit;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pre-commit invokes React Doctor once and keeps line-ending checks read-only", () => {
  const config = fs.readFileSync(path.join(repoRoot, ".pre-commit-config.yaml"), "utf8");
  const markdownHook = config.match(/- id: markdown-link-check[\s\S]*?(?=\n\s*- id: react-doctor)/)?.[0];
  const reactDoctorHook = config.match(/- id: react-doctor[\s\S]*$/)?.[0];

  assert.match(markdownHook ?? "", /pass_filenames:\s*false/);
  assert.match(reactDoctorHook ?? "", /pass_filenames:\s*false/);
  assert.match(config, /- id: mixed-line-ending[\s\S]*?args:\s*\[--fix=no\]/);
});

test("selects only safe, staged-scope frontend paths", () => {
  assert.deepEqual(
    selectFrontendFiles([
      "src/clean.tsx",
      ".\\components\\button.jsx",
      "docs/unrelated.md",
      "src/clean.tsx",
      "../outside.tsx",
      "C:\\outside.tsx",
    ]),
    ["components/button.jsx", "src/clean.tsx"]
  );
});

test("builds a staged local gate without changed-branch or score API scope", () => {
  const args = buildReactDoctorArgs();

  assert.deepEqual(args.slice(args.indexOf("--scope"), args.indexOf("--scope") + 2), [
    "--scope",
    "files",
  ]);
  assert.ok(args.includes("--staged"));
  assert.ok(args.includes("--no-score"));
  assert.ok(args.includes("--no-color"));
  assert.equal(args.includes("changed"), false);
  assert.deepEqual(args.slice(args.indexOf("--blocking"), args.indexOf("--blocking") + 2), [
    "--blocking",
    "warning",
  ]);
});

test("launches npx through node on Windows instead of spawning a cmd shim", () => {
  const execPath = "C:\\node\\node.exe";
  const expectedCli = path.win32.join(
    path.win32.dirname(execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  const result = resolveNpxInvocation({
    platform: "win32",
    execPath,
    existsSync: (candidate) => candidate === expectedCli,
  });

  assert.deepEqual(result, {
    ok: true,
    command: execPath,
    prefixArgs: [expectedCli],
  });
  assert.equal(result.command.endsWith(".cmd"), false);
});

test("fails closed when the Windows npx JavaScript entrypoint is unavailable", () => {
  const result = resolveNpxInvocation({
    platform: "win32",
    execPath: "C:\\node\\node.exe",
    existsSync: () => false,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /npx-cli\.js/);
});

test("reads the staged Git index and excludes unrelated branch files", () => {
  const fakeSpawnSync = (_command, args) => {
    assert.deepEqual(args, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMR",
      "-z",
    ]);
    return {
      status: 0,
      stdout: "src/staged.tsx\0README.md\0hooks/use-staged.ts\0",
      stderr: "",
    };
  };

  assert.deepEqual(readStagedFrontendFiles({ spawnSync: fakeSpawnSync, repoRoot: "/repo" }), {
    ok: true,
    files: ["hooks/use-staged.ts", "src/staged.tsx"],
  });
});

test("reads staged frontend files from an isolated real Git fixture", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mck-react-doctor-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(fixtureRoot, "src"));
  fs.mkdirSync(path.join(fixtureRoot, "docs"));
  fs.writeFileSync(path.join(fixtureRoot, "src", "staged.tsx"), "export const staged = true;\n");
  fs.writeFileSync(path.join(fixtureRoot, "src", "unstaged.tsx"), "export const unstaged = true;\n");
  fs.writeFileSync(path.join(fixtureRoot, "docs", "staged.md"), "# Staged docs\n");

  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: fixtureRoot }).status, 0);
  assert.equal(
    spawnSync("git", ["add", "src/staged.tsx", "docs/staged.md"], {
      cwd: fixtureRoot,
    }).status,
    0
  );

  assert.deepEqual(readStagedFrontendFiles({ spawnSync, repoRoot: fixtureRoot }), {
    ok: true,
    files: ["src/staged.tsx"],
  });
});

test("fails closed when the staged index cannot be read", () => {
  const fakeSpawnSync = () => ({ status: 128, stdout: "", stderr: "bad index" });

  assert.deepEqual(readStagedFrontendFiles({ spawnSync: fakeSpawnSync, repoRoot: "/repo" }), {
    ok: false,
    error: "bad index",
  });
});

test("passes a clean local diagnostic result even if score service text is present", () => {
  const result = classifyReactDoctorResult(
    { status: 0, error: null, signal: null },
    "Score API unavailable; local scan completed"
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
});

test("fails when staged warnings make the local blocking gate nonzero", () => {
  const result = classifyReactDoctorResult(
    { status: 1, error: null, signal: null },
    "warning in src/staged.tsx"
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /blocking staged diagnostics/);
});

test("passes the CLI no-staged-source result as a skip", () => {
  const result = classifyReactDoctorResult(
    { status: 0, error: null, signal: null },
    "No staged source files found."
  );

  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    message: "No staged frontend source files found.",
  });
});

test("fails closed on spawn and signal failures", () => {
  assert.equal(
    classifyReactDoctorResult(
      { status: null, error: new Error("missing npx"), signal: null },
      ""
    ).ok,
    false
  );
  assert.equal(
    classifyReactDoctorResult({ status: null, error: null, signal: "SIGTERM" }, "").ok,
    false
  );
});
