import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import * as path from 'path';

interface RuntimeRegressionArtifact {
  name: string;
  path: string;
  updated_at: string;
  screenshot_count: number;
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
      const screenshotCount = files.filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file)).length;
      artifacts.push({
        name: entry.name,
        path: `artifacts/runtime-ui-smoke/${entry.name}`,
        updated_at: artifactStat.mtime.toISOString(),
        screenshot_count: screenshotCount,
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
