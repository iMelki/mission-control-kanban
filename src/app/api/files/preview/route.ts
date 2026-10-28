/**
 * File Preview API
 * Serves local files for preview (HTML only for security)
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { resolvePathWithinBases } from '@/lib/path-containment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function readPreviewFile(filePath: string) {
  const fs = await import('node:fs/promises');
  return fs.readFile(filePath, 'utf-8');
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  // Only allow HTML files
  if (!filePath.endsWith('.html') && !filePath.endsWith('.htm')) {
    return NextResponse.json({ error: 'Only HTML files can be previewed' }, { status: 400 });
  }

  // Expand tilde and normalize
  const expandedPath = filePath.replace(/^~/, process.env.HOME || '');
  const normalizedPath = path.normalize(expandedPath);

  // Security check - only allow paths from environment config
  const allowedPaths = [
    process.env.WORKSPACE_BASE_PATH?.replace(/^~/, process.env.HOME || ''),
    process.env.PROJECTS_PATH?.replace(/^~/, process.env.HOME || ''),
  ].filter(Boolean) as string[];

  try {
    // Containment is checked on real paths with `base + path.sep`, so sibling-prefix
    // paths and symlinks escaping the allowed directories are rejected.
    const contained = await resolvePathWithinBases(normalizedPath, allowedPaths);
    if (!contained.ok) {
      if (contained.reason === 'not-found') {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
    }

    const content = await readPreviewFile(contained.realPath);
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    console.error('[FILE] Error reading file:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
