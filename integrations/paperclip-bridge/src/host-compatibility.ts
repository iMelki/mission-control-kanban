export function assertExactTestedHostCommit(
  expectedCommit: string,
  actualCommit: string,
): void {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
    throw new Error("Plugin package must declare one exact Paperclip host commit");
  }
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `Paperclip host commit mismatch: expected ${expectedCommit}, got ${actualCommit}`,
    );
  }
}
