/**
 * File Download API
 * Returns file content over HTTP from the server filesystem.
 * This enables remote agents to read files from
 * the Mission Control server.
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Base directory for all project files - must match upload endpoint
// Set via PROJECTS_PATH env var (e.g., ~/projects or /var/www/projects)
const PROJECTS_BASE = (process.env.PROJECTS_PATH || '~/projects').replace(/^~/, process.env.HOME || '');

// MIME types for common file extensions
async function readProjectFile(filePath: string) {
  const fs = await import('node:fs/promises');
  return fs.readFile(filePath);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

/**
 * GET /api/files/download?path=...
 * Download a file from the projects directory
 *
 * Query params:
 *   - path: Full path (must be under PROJECTS_BASE)
 *   - relativePath: Path relative to PROJECTS_BASE (alternative to path)
 *   - raw: If 'true', returns raw file content; otherwise returns JSON wrapper
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fullPathParam = searchParams.get('path');
    const relativePathParam = searchParams.get('relativePath');
    const raw = searchParams.get('raw') === 'true';

    // Determine the target path
    let targetPath: string;

    if (fullPathParam) {
      // Full path provided - validate it's under PROJECTS_BASE
      const normalizedPath = path.normalize(fullPathParam);
      if (!normalizedPath.startsWith(PROJECTS_BASE)) {
        return NextResponse.json(
          { error: 'Access denied: path must be within projects directory' },
          { status: 403 }
        );
      }
      targetPath = normalizedPath;
    } else if (relativePathParam) {
      // Relative path provided
      const normalizedRelative = path.normalize(relativePathParam);
      if (normalizedRelative.startsWith('..') || normalizedRelative.startsWith('/')) {
        return NextResponse.json(
          { error: 'Invalid path: must be relative and cannot traverse upward' },
          { status: 400 }
        );
      }
      targetPath = path.join(PROJECTS_BASE, normalizedRelative);
    } else {
      return NextResponse.json(
        { error: 'Either path or relativePath query parameter is required' },
        { status: 400 }
      );
    }

    // Determine content type
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isText = contentType.startsWith('text/') ||
                   contentType === 'application/json' ||
                   contentType === 'application/javascript' ||
                   contentType === 'application/xml';

    // Read file
    const fileBuffer = await readProjectFile(targetPath);
    const textContent = isText ? fileBuffer.toString('utf-8') : null;

    console.log(`[FILE DOWNLOAD] Read: ${targetPath} (${fileBuffer.byteLength} bytes)`);

    // Return raw content or JSON wrapper
    if (raw) {
      return new NextResponse(textContent ?? new Uint8Array(fileBuffer), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileBuffer.byteLength),
        },
      });
    }

    // JSON response with metadata
    return NextResponse.json({
      success: true,
      path: targetPath,
      relativePath: path.relative(PROJECTS_BASE, targetPath),
      size: fileBuffer.byteLength,
      contentType,
      content: textContent ?? fileBuffer.toString('base64'),
      encoding: isText ? 'utf-8' : 'base64',
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (code === 'EISDIR') {
      return NextResponse.json({ error: 'Path is a directory, not a file' }, { status: 400 });
    }

    console.error('Error downloading file:', error);
    return NextResponse.json(
      { error: 'Failed to download file', details: String(error) },
      { status: 500 }
    );
  }
}
