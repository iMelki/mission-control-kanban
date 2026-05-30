import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextResponse } from 'next/server';

const execFileAsync = promisify(execFile);

function getGitHubTokenSource(): 'GH_GENERAL_TOKEN' | 'GITHUB_TOKEN' | null {
  if (process.env.GH_GENERAL_TOKEN?.trim()) {
    return 'GH_GENERAL_TOKEN';
  }
  if (process.env.GITHUB_TOKEN?.trim()) {
    return 'GITHUB_TOKEN';
  }
  return null;
}

function buildGitHubCliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const source = getGitHubTokenSource();
  const token = source ? process.env[source]?.trim() : undefined;
  if (token) {
    env.GH_TOKEN ??= token;
    env.GITHUB_TOKEN ??= token;
  }
  return env;
}

async function runGhJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync('gh', args, {
    env: buildGitHubCliEnv(),
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

export async function GET() {
  const tokenSource = getGitHubTokenSource();
  if (!tokenSource) {
    return NextResponse.json({
      status: 'missing_token',
      token_source: null,
      authenticated: false,
      project_read_available: false,
      message: 'Set GH_GENERAL_TOKEN or GITHUB_TOKEN before using GitHub import and Project-field reads.',
    });
  }

  try {
    const viewer = await runGhJson<{ login?: string }>(['api', 'user']);
    const projectProbe = await runGhJson<{
      data?: { viewer?: { projectsV2?: { totalCount?: number } } };
      errors?: Array<{ message?: string }>;
    }>([
      'api',
      'graphql',
      '--raw-field',
      'query=query { viewer { projectsV2(first: 1) { totalCount } } }',
    ]);
    const projectReadAvailable = !projectProbe.errors?.length;

    return NextResponse.json({
      status: projectReadAvailable ? 'ok' : 'limited',
      token_source: tokenSource,
      authenticated: true,
      viewer_login: viewer.login ?? 'unknown',
      project_read_available: projectReadAvailable,
      project_count_visible: projectProbe.data?.viewer?.projectsV2?.totalCount ?? null,
      message: projectReadAvailable
        ? 'GitHub issue and Project reads are available.'
        : 'GitHub auth works, but Project reads failed. Check read:project scope.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        token_source: tokenSource,
        authenticated: false,
        project_read_available: false,
        message: error instanceof Error ? error.message : 'GitHub diagnostics failed.',
      },
      { status: 500 },
    );
  }
}
