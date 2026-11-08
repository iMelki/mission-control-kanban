#!/usr/bin/env node
// Builds the static, backend-free demo into out-demo/ (see next.config.mjs).
// Cross-platform: sets NEXT_PUBLIC_DEMO_MODE=1 without a shell.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

rmSync(path.join(root, 'out-demo'), { recursive: true, force: true });

const result = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_DEMO_MODE: '1', NEXT_TELEMETRY_DISABLED: '1' },
});

process.exit(result.status ?? 1);
