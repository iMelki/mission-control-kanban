import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pin the standalone tracing root to this checkout. Next walks up every
// ancestor lockfile and picks the outermost, so a linked worktree nested
// under tools/mission-control-kanban/tmp/<name> would otherwise trace from
// the parent checkout (two package-lock.json files in its ancestor chain).
const worktreeRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: worktreeRoot,
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['better-sqlite3'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.js'],
    };
    return config;
  },
};

export default nextConfig;
