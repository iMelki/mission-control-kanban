import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// 3021 is the canonical MCK port (agent-settings shared/memory/port-registry.md).
// 3002 is legacy manual-fallback evidence only; .env.example must not steer
// a fresh checkout back onto it.
const CANONICAL_PORT = "3021";

test(".env.example uses the canonical MCK port", async () => {
  const env = await readFile(".env.example", "utf8");
  const ports = [...env.matchAll(/^PORT=(\S*)$/gm)].map((match) => match[1]);
  assert.deepEqual(ports, [CANONICAL_PORT]);
  assert.doesNotMatch(env, /:3002\b/);
  for (const [, port] of env.matchAll(/localhost:(\d+)/g)) {
    assert.equal(port, CANONICAL_PORT);
  }
});

test("canonical port agrees with dev:n8n and the factory base URL", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(pkg.scripts["dev:n8n"], new RegExp(`-p ${CANONICAL_PORT}\\b`));
  const contracts = await readFile("integrations/paperclip-bridge/src/contracts.ts", "utf8");
  assert.match(contracts, new RegExp(`FACTORY_MCK_BASE_URL = "http://127\\.0\\.0\\.1:${CANONICAL_PORT}"`));
});
