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

test("workflow isolates PR and issue write permissions in no-checkout jobs", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/runtime-regression.yml"),
    "utf8",
  );

  const topPermissions = workflow.match(/permissions:[\s\S]*?(?=\n\non:)/)?.[0] ?? "";
  const prCommentJob = workflow.match(
    /\n  comment-runtime-artifacts-pr:[\s\S]*?(?=\n  comment-runtime-artifacts-issue:)/,
  )?.[0] ?? "";
  const issueCommentJob = workflow.match(
    /\n  comment-runtime-artifacts-issue:[\s\S]*$/,
  )?.[0] ?? "";

  assert.doesNotMatch(topPermissions, /issues:\s*write|pull-requests:\s*write/);
  assert.match(prCommentJob, /needs:\s*runtime-regression/);
  assert.match(prCommentJob, /permissions:[\s\S]*?actions:\s*read[\s\S]*?pull-requests:\s*write/);
  assert.doesNotMatch(prCommentJob, /issues:\s*write|actions\/checkout/);
  assert.match(
    prCommentJob,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  );
  assert.match(prCommentJob, /HEAD_SHA:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(prCommentJob, /REF_NAME:\s*\$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
  assert.match(issueCommentJob, /needs:\s*runtime-regression/);
  assert.match(issueCommentJob, /permissions:[\s\S]*?actions:\s*read[\s\S]*?issues:\s*write/);
  assert.doesNotMatch(issueCommentJob, /pull-requests:\s*write|actions\/checkout/);
  assert.match(issueCommentJob, /github\.event_name == 'workflow_dispatch'/);
  for (const commentJob of [prCommentJob, issueCommentJob]) {
    assert.match(commentJob, /gh api --method POST/);
    assert.match(commentJob, /gh api "repos\/\$\{GH_REPO\}\/issues\/comments\/\$\{comment_id\}"/);
    assert.doesNotMatch(
      commentJob,
      /issues\/\$\{COMMENT_TARGET\}\/comments\/\$\{comment_id\}/,
    );
    assert.match(
      commentJob,
      /jq -e --rawfile expected comment\.md '\.body == \$expected' comment-readback\.json/,
    );
  }
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
