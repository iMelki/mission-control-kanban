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

test("workflow isolates issue-write permission in a no-checkout comment job", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/runtime-regression.yml"),
    "utf8",
  );

  const topPermissions = workflow.match(/permissions:[\s\S]*?(?=\n\non:)/)?.[0] ?? "";
  const commentJob = workflow.match(/\n  comment-runtime-artifacts:[\s\S]*$/)?.[0] ?? "";

  assert.doesNotMatch(topPermissions, /issues:\s*write|pull-requests:\s*write/);
  assert.match(commentJob, /needs:\s*runtime-regression/);
  assert.match(commentJob, /permissions:[\s\S]*?actions:\s*read[\s\S]*?issues:\s*write/);
  assert.doesNotMatch(commentJob, /actions\/checkout/);
  assert.match(
    commentJob,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  );
  assert.match(commentJob, /gh api --method POST/);
  assert.match(commentJob, /gh api "repos\/\$\{GH_REPO\}\/issues\/\$\{COMMENT_TARGET\}\/comments\/\$\{comment_id\}"/);
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
