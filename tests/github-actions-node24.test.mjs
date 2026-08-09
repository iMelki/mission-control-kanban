import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/runtime-regression.yml",
  ".github/workflows/secret-scan.yml",
];

const expectedPins = new Map([
  ["actions/checkout", "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09"],
  ["actions/setup-node", "249970729cb0ef3589644e2896645e5dc5ba9c38"],
  ["actions/setup-python", "ece7cb06caefa5fff74198d8649806c4678c61a1"],
  ["actions/cache", "caa296126883cff596d87d8935842f9db880ef25"],
  ["actions/upload-artifact", "b7c566a772e6b6bfb58ed0dc250532a479d7789f"],
]);

test("workflow actions use immutable native-Node-24 pins", async () => {
  const sources = await Promise.all(
    workflows.map(async (path) => [path, await readFile(path, "utf8")]),
  );
  const seen = new Set();

  for (const [path, source] of sources) {
    assert.doesNotMatch(
      source,
      /pre-commit\/action@/,
      `${path} must not reintroduce the maintenance-only composite with its hidden cache@v4`,
    );

    for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)) {
      const spec = match[1];
      if (spec.startsWith("./")) continue;
      const separator = spec.lastIndexOf("@");
      assert.notEqual(separator, -1, `${path}: ${spec} must include an immutable ref`);
      const action = spec.slice(0, separator);
      const ref = spec.slice(separator + 1);
      assert.match(ref, /^[0-9a-f]{40}$/, `${path}: ${spec} must use a full commit SHA`);
      seen.add(action);

      if (expectedPins.has(action)) {
        assert.equal(ref, expectedPins.get(action), `${path}: unexpected ${action} release`);
      }
    }
  }

  assert.deepEqual(
    [...expectedPins.keys()].filter((action) => !seen.has(action)),
    [],
    "every reviewed native-Node-24 action pin must remain in use",
  );
});
