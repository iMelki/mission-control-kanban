import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import * as path from 'path';

interface RuntimeRegressionScreenshot {
  name: string;
  path: string;
  preview_url: string;
  size_bytes: number;
  updated_at: string;
}

interface RuntimeRegressionArtifact {
  name: string;
  path: string;
  updated_at: string;
  screenshot_count: number;
  screenshots: RuntimeRegressionScreenshot[];
  ci_run_url?: string;
}

const ARTIFACT_ROOT = path.join(process.cwd(), 'artifacts', 'runtime-ui-smoke');

async function listRuntimeArtifacts(): Promise<RuntimeRegressionArtifact[]> {
  try {
    const entries = await readdir(ARTIFACT_ROOT, { withFileTypes: true });
    const artifacts = [] as RuntimeRegressionArtifact[];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const artifactPath = path.join(ARTIFACT_ROOT, entry.name);
      const [artifactStat, files] = await Promise.all([
        stat(artifactPath),
        readdir(artifactPath).catch(() => [] as string[]),
      ]);
      const screenshotFiles = files.filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file));
      const screenshots = await Promise.all(screenshotFiles.map(async (file) => {
        const relativePath = `artifacts/runtime-ui-smoke/${entry.name}/${file}`;
        const fileStat = await stat(path.join(artifactPath, file));
        return {
          name: file,
          path: relativePath,
          preview_url: `/api/runtime/regression/screenshot?path=${encodeURIComponent(relativePath)}`,
          size_bytes: fileStat.size,
          updated_at: fileStat.mtime.toISOString(),
        };
      }));
      artifacts.push({
        name: entry.name,
        path: `artifacts/runtime-ui-smoke/${entry.name}`,
        updated_at: artifactStat.mtime.toISOString(),
        screenshot_count: screenshotFiles.length,
        screenshots,
        ci_run_url: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
          ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : undefined,
      });
    }

    return artifacts.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  } catch {
    return [];
  }
}

export async function GET() {
  const artifacts = await listRuntimeArtifacts();
  const latest = artifacts[0] ?? null;
  const latestAgeHours = latest ? (Date.now() - Date.parse(latest.updated_at)) / 3_600_000 : null;

  return NextResponse.json({
    ok: Boolean(latest),
    latest,
    recent: latestAgeHours !== null && latestAgeHours <= 24,
    latest_age_hours: latestAgeHours,
    artifact_root: 'artifacts/runtime-ui-smoke',
    local_command: 'npm run check:runtime-regressions',
    ci_workflow: '.github/workflows/runtime-regression.yml',
    artifacts: artifacts.slice(0, 5),
  });
}
