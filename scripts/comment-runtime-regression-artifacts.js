#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

function runGh(args, { allowFailure = false } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${['gh', ...args].join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function parseArgs(argv) {
  const options = {
    repo: process.env.GITHUB_REPOSITORY || 'iMelki/mission-control-kanban',
    workflow: 'Runtime Regression',
    branch: 'dev',
    issue: process.env.MCK_RUNTIME_ARTIFACT_ISSUE || '',
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') options.repo = argv[++index];
    else if (arg === '--workflow') options.workflow = argv[++index];
    else if (arg === '--branch') options.branch = argv[++index];
    else if (arg === '--issue') options.issue = argv[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function buildRunUrl(repo, runId) {
  return `https://github.com/${repo}/actions/runs/${runId}`;
}

function buildArtifactUrl(repo, runId, artifactName) {
  return `${buildRunUrl(repo, runId)}#artifacts` + (artifactName ? ` (${artifactName})` : '');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const runJson = runGh([
    'run', 'list',
    '--repo', options.repo,
    '--workflow', options.workflow,
    '--branch', options.branch,
    '--limit', '1',
    '--json', 'databaseId,displayTitle,conclusion,status,createdAt,headSha,url',
  ]);
  const [run] = JSON.parse(runJson || '[]');
  if (!run) {
    throw new Error(`No workflow run found for ${options.workflow} on ${options.repo}@${options.branch}`);
  }

  const artifactsJson = runGh([
    'api',
    `repos/${options.repo}/actions/runs/${run.databaseId}/artifacts`,
    '--jq', '.artifacts[] | {name, expired, size_in_bytes, created_at, expires_at}',
  ], { allowFailure: true });

  const artifacts = artifactsJson
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((artifact) => !artifact.expired);

  const artifactLines = artifacts.length
    ? artifacts.map((artifact) => `- ${artifact.name}: ${buildArtifactUrl(options.repo, run.databaseId, artifact.name)}; expires ${artifact.expires_at}`).join('\n')
    : '- No unexpired artifacts found for this run.';

  const body = [
    'Runtime regression artifact evidence:',
    '',
    `- Workflow: ${options.workflow}`,
    `- Run: ${run.url || buildRunUrl(options.repo, run.databaseId)}`,
    `- Status: ${run.status}; conclusion: ${run.conclusion || 'pending'}`,
    `- Commit: ${run.headSha}`,
    '- Artifacts:',
    artifactLines,
  ].join('\n');

  if (!options.issue || options.dryRun) {
    console.log(body);
    return;
  }

  runGh(['issue', 'comment', options.issue, '--repo', options.repo, '--body', body]);
  console.log(`Commented runtime regression artifacts on ${options.repo}#${options.issue}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
