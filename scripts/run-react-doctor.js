const { spawnSync } = require("child_process");
const path = require("path");

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MIN_SCORE = 95;
const repoRoot = path.resolve(__dirname, "..");

console.log("Running React Doctor for mission-control-kanban...");

const result = spawnSync(
  "npx",
  ["-y", "react-doctor@latest", ".", "--verbose", "--scope", "changed", "--blocking", "warning"],
  {
    cwd: repoRoot,
    maxBuffer: MAX_BUFFER_BYTES,
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
  }
);

if (result.error) {
  console.error("Failed to start React Doctor:", result.error);
  process.exit(1);
}

const stdout = result.stdout ? result.stdout.toString() : "";
const stderr = result.stderr ? result.stderr.toString() : "";
const output = [stdout, stderr].filter(Boolean).join("\n");
const normalizedOutput = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

process.stdout.write(stdout);
process.stderr.write(stderr);

if (/No source files found\.|No staged source files found\./i.test(normalizedOutput)) {
  console.log("\nReact Doctor skipped: no changed frontend source files.");
  process.exit(0);
}

if (/No issues found!/i.test(normalizedOutput)) {
  console.log("\nReact Doctor found no changed-scope issues.");
  process.exit(result.status ?? 0);
}

const scoreMatch = normalizedOutput.match(/(\d+)\s*\/\s*100/);
if (!scoreMatch) {
  if (/No issues found!/i.test(normalizedOutput)) {
    console.log("\nReact Doctor score unavailable, but no issues were found.");
    process.exit(result.status ?? 0);
  }

  if (result.status === 0) {
    console.log("\nReact Doctor score unavailable, but the CLI exited cleanly.");
    process.exit(0);
  }

  console.error("\nCould not determine React Doctor score from output.");
  process.exit(1);
}

const score = parseInt(scoreMatch[1], 10);
console.log(`\nReact Doctor Score: ${score}/100`);

if (score < MIN_SCORE) {
  console.error(`\nReact Doctor score is too low (${score} < ${MIN_SCORE}).`);
  console.error("Please fix the reported issues before committing.");
  process.exit(1);
}

if (result.status === null) {
  const reason = result.signal ? `signal ${result.signal}` : "unknown termination";
  console.error(`\nReact Doctor exited unexpectedly (${reason}).`);
  process.exit(1);
}

process.exit(result.status ?? 1);
