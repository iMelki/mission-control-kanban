import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// `next dev` rewrites AGENTS.md when it detects an AI coding agent and the
// managed agent-rules block is missing or differs from the one it would write.
// A rewritten tracked file makes the next governed start refuse with
// `tracked-source-changes` (#187), so the block is committed exactly as Next
// writes it. Ask the installed Next.js itself: a Next upgrade that changes the
// block text then fails here, in its own pull request, instead of dirtying the
// live checkout at its next start.
const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("AGENTS.md carries the agent-rules block that the installed next dev writes", () => {
  const { hasCurrentAgentRules } = require("next/dist/server/lib/generate-agent-files.js");
  assert.equal(typeof hasCurrentAgentRules, "function");
  assert.equal(
    hasCurrentAgentRules(repoRoot),
    true,
    "next dev would rewrite AGENTS.md: copy the block from " +
      "node_modules/next/dist/server/lib/generate-agent-files.js into AGENTS.md (#187)",
  );
});
