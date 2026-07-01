import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import * as path from 'path';

export const dynamic = 'force-dynamic';

const ARTIFACT_ROOT = path.join(process.cwd(), 'artifacts', 'runtime-ui-smoke');

function isSafeArtifactPath(value: string) {
  const prefix = 'artifacts/runtime-ui-smoke/';
  if (!value.startsWith(prefix)) return null;
  const relativeToArtifactRoot = path.normalize(value.slice(prefix.length));
  if (!relativeToArtifactRoot || relativeToArtifactRoot.startsWith('..') || path.isAbsolute(relativeToArtifactRoot)) {
    return null;
  }
  return path.join(ARTIFACT_ROOT, relativeToArtifactRoot);
}

function contentType(filePath: string) {
  if (/\.jpe?g$/i.test(filePath)) return 'image/jpeg';
  if (/\.webp$/i.test(filePath)) return 'image/webp';
  return 'image/png';
}

export async function GET(request: NextRequest) {
  const artifactPath = request.nextUrl.searchParams.get('path') || '';
  if (!/\.(png|jpe?g|webp)$/i.test(artifactPath)) {
    return NextResponse.json({ error: 'Unsupported screenshot path' }, { status: 400 });
  }
  const fullPath = isSafeArtifactPath(artifactPath);
  if (!fullPath) return NextResponse.json({ error: 'Invalid screenshot path' }, { status: 400 });
  try {
    const bytes = await readFile(fullPath);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': contentType(fullPath),
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 });
  }
}
