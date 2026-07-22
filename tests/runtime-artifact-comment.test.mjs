import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  classifyGhFailure,
  runGh,
} = require("../scripts/comment-runtime-regression-artifacts.js");

test("workflow grants PR comments only to same-repository pull requests", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/runtime-regression.yml"),
    "utf8",
  );

  assert.match(workflow, /pull-requests:\s*write/);
  assert.match(
    workflow,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  );
});

test("classifies a denied PR comment separately from runtime validation", () => {
  const result = {
    status: 1,
    stdout: "",
    stderr: "GraphQL: Resource not accessible by integration (addComment)",
  };

  assert.equal(classifyGhFailure(["issue", "comment", "42"], result), "comment-permission");
  assert.throws(
    () => runGh(["issue", "comment", "42"], {}, () => result),
    /comment-permission/,
  );
});
