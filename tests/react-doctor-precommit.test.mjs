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
  resolveReactDoctorArtifact,
  selectFrontendFiles,
} = reactDoctorPrecommit;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pre-commit invokes React Doctor once and keeps line-ending checks read-only", () => {
  const config = fs.readFileSync(path.join(repoRoot, ".pre-commit-config.yaml"), "utf8");
  const markdownHook = config.match(/- id: markdown-link-check[\s\S]*?(?=\n\s*- id: react-doctor)/)?.[0];
  const reactDoctorHook = config.match(/- id: react-doctor[\s\S]*$/)?.[0];

  assert.match(markdownHook ?? "", /pass_filenames:\s*false/);
  assert.match(reactDoctorHook ?? "", /pass_filenames:\s*true/);
  assert.match(reactDoctorHook ?? "", /require_serial:\s*true/);
  assert.match(config, /- id: mixed-line-ending[\s\S]*?args:\s*\[--fix=no\]/);
});

test("CI installs the lockfile artifact and supplies its absolute path to the gate", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

  assert.match(workflow, /actions\/setup-node@[\w]+/);
  assert.match(workflow, /node-version: "24\.18\.0"/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /REACT_DOCTOR_ARTIFACT_PATH: \$\{\{ github\.workspace \}\}\/node_modules\/\.bin\/react-doctor/);
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

  assert.equal(args.some((arg) => arg.includes("@")), false);
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

test("accepts only an existing absolute Windows artifact", () => {
  const result = resolveReactDoctorArtifact({
    platform: "win32",
    artifactPath: "C:\\artifacts\\react-doctor.exe",
    existsSync: (candidate) => candidate === "C:\\artifacts\\react-doctor.exe",
  });

  assert.deepEqual(result, {
    ok: true,
    command: "C:\\artifacts\\react-doctor.exe",
    prefixArgs: [],
  });
});

test("runs a qualified Windows JavaScript CLI artifact through Node", () => {
  const result = resolveReactDoctorArtifact({
    platform: "win32",
    artifactPath: "C:\\repo\\node_modules\\react-doctor\\bin\\react-doctor.js",
    existsSync: () => true,
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
  });

  assert.deepEqual(result, {
    ok: true,
    command: "C:\\Program Files\\nodejs\\node.exe",
    prefixArgs: ["C:\\repo\\node_modules\\react-doctor\\bin\\react-doctor.js"],
  });
});

test("fails closed when an exact artifact is absent or relative", () => {
  const missing = resolveReactDoctorArtifact({
    platform: "win32",
    artifactPath: "C:\\artifacts\\react-doctor.exe",
    existsSync: () => false,
  });

  assert.equal(missing.ok, false);
  assert.match(missing.error, /artifact is missing/);

  const relative = resolveReactDoctorArtifact({
    platform: "win32",
    artifactPath: "tools/react-doctor.exe",
    existsSync: () => true,
  });
  assert.equal(relative.ok, false);
  assert.match(relative.error, /absolute REACT_DOCTOR_ARTIFACT_PATH/);
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
