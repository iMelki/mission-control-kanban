/**
 * File Reveal API
 * Opens a file's location in Finder (macOS) or Explorer (Windows)
 */

import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { resolvePathWithinBases } from '@/lib/path-containment';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const { filePath } = await request.json();

    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 });
    }

    // Expand tilde
    const expandedPath = filePath.replace(/^~/, process.env.HOME || '');

    // Security: Ensure path is within allowed directories (from env config)
    const allowedPaths = [
      process.env.WORKSPACE_BASE_PATH?.replace(/^~/, process.env.HOME || ''),
      process.env.PROJECTS_PATH?.replace(/^~/, process.env.HOME || ''),
    ].filter(Boolean) as string[];

    const normalizedPath = path.normalize(expandedPath);

    // Containment is checked on real paths with `base + path.sep`, so sibling-prefix
    // paths and symlinks escaping the allowed directories are rejected.
    const contained = await resolvePathWithinBases(normalizedPath, allowedPaths);

    if (!contained.ok && contained.reason === 'outside-base') {
      console.warn(`[FILE] Blocked access to: ${filePath}`);
      return NextResponse.json(
        { error: 'Path not in allowed directories' },
        { status: 403 }
      );
    }

    // Check if file/directory exists
    if (!contained.ok) {
      return NextResponse.json(
        { error: 'File or directory not found', path: normalizedPath },
        { status: 404 }
      );
    }

    // Open in Finder (macOS) - reveal the file
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = `open -R "${normalizedPath}"`;
    } else if (platform === 'win32') {
      command = `explorer /select,"${normalizedPath}"`;
    } else {
      // Linux - open containing folder
      command = `xdg-open "${path.dirname(normalizedPath)}"`;
    }

    await execAsync(command);

    console.log(`[FILE] Revealed: ${normalizedPath}`);
    return NextResponse.json({ success: true, path: normalizedPath });
  } catch (error) {
    console.error('[FILE] Error revealing file:', error);
    return NextResponse.json(
      { error: 'Failed to reveal file' },
      { status: 500 }
    );
  }
}
