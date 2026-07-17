const { spawnSync } = require("child_process");
const path = require("path");
const {
  buildReactDoctorArgs,
  classifyReactDoctorResult,
  readStagedFrontendFiles,
  selectFrontendFiles,
} = require("./react-doctor-precommit-core.cjs");

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const repoRoot = path.resolve(__dirname, "..");

const explicitFiles = process.argv.slice(2);
let stagedFiles;

if (explicitFiles.length > 0) {
  stagedFiles = selectFrontendFiles(explicitFiles);
} else {
  const stagedRead = readStagedFrontendFiles({ spawnSync, repoRoot });
  if (!stagedRead.ok) {
    console.error(`React Doctor pre-commit gate failed closed: ${stagedRead.error}`);
    process.exit(1);
  }
  stagedFiles = stagedRead.files;
}

if (stagedFiles.length === 0) {
  console.log("React Doctor skipped: no staged frontend source files.");
  process.exit(0);
}

console.log(`Running React Doctor for ${stagedFiles.length} staged frontend file(s)...`);

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  buildReactDoctorArgs(),
  {
    cwd: repoRoot,
    maxBuffer: MAX_BUFFER_BYTES,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  }
);

const stdout = result.stdout ? result.stdout.toString() : "";
const stderr = result.stderr ? result.stderr.toString() : "";
const output = [stdout, stderr].filter(Boolean).join("\n");
const normalizedOutput = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

process.stdout.write(stdout);
process.stderr.write(stderr);

const decision = classifyReactDoctorResult(result, normalizedOutput);
const log = decision.ok ? console.log : console.error;
log(`\n${decision.message}`);
process.exit(decision.ok ? 0 : 1);
