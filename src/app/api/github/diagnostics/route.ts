import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import {
  buildGitHubDiagnosticsError,
  buildGitHubDiagnosticsPayload,
  buildMissingTokenDiagnostics,
  formatGitHubProbeError,
} from '@/lib/github-diagnostics';

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
    return NextResponse.json(buildMissingTokenDiagnostics());
  }

  try {
    const viewer = await runGhJson<{ login?: string }>(['api', 'user']);
    let projectReadAvailable = false;
    let projectCountVisible: number | null = null;
    let projectProbeError: string | undefined;

    try {
      const projectProbe = await runGhJson<{
        data?: {
          viewer?: {
            projectsV2?: {
              totalCount?: number;
              nodes?: Array<{
                id?: string;
                title?: string;
                fields?: {
                  nodes?: Array<{
                    id?: string;
                    name?: string;
                  }>;
                };
              }>;
            };
          };
        };
        errors?: Array<{ message?: string }>;
      }>([
        'api',
        'graphql',
        '--raw-field',
        'query=query { viewer { projectsV2(first: 1) { totalCount nodes { id title fields(first: 1) { nodes { ... on ProjectV2FieldCommon { id name } } } } } } }',
      ]);

      projectCountVisible = projectProbe.data?.viewer?.projectsV2?.totalCount ?? null;
      projectReadAvailable = !projectProbe.errors?.length;
      if (projectProbe.errors?.length) {
        projectProbeError = projectProbe.errors.map((error) => error.message).filter(Boolean).join('; ');
      }
    } catch (error) {
      projectProbeError = formatGitHubProbeError(error);
    }

    return NextResponse.json(buildGitHubDiagnosticsPayload({
      tokenSource,
      viewerLogin: viewer.login,
      projectReadAvailable,
      projectCountVisible,
      projectProbeError,
    }));
  } catch (error) {
    return NextResponse.json(
      buildGitHubDiagnosticsError({
        tokenSource,
        message: error instanceof Error ? error.message : 'GitHub diagnostics failed.',
      }),
      { status: 500 },
    );
  }
}
