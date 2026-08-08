import { describe, expect, it } from "vitest";
import { assertExactTestedHostCommit } from "../src/host-compatibility.js";

describe("Paperclip host compatibility", () => {
  const testedCommit = "c5a4ba43368439f5e05c1c7f5cdf74758a2f8a53";

  it("requires the exact tested host commit even when file attestations exist", () => {
    expect(() => assertExactTestedHostCommit(testedCommit, testedCommit)).not.toThrow();
    expect(() => assertExactTestedHostCommit(testedCommit, "902118b6670642ba3111c20118949c9578d00ea4")).toThrow(
      /Paperclip host commit mismatch/,
    );
  });

  it("rejects missing or malformed host commit metadata", () => {
    expect(() => assertExactTestedHostCommit("", testedCommit)).toThrow(/one exact Paperclip host commit/);
    expect(() => assertExactTestedHostCommit("not-a-sha", testedCommit)).toThrow(/one exact Paperclip host commit/);
  });
});
