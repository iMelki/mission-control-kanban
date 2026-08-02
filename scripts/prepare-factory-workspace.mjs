import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = resolve(repositoryRoot, 'integrations', 'paperclip-bridge');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const processExecutable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : npmExecutable;

function runNpm(args, cwd) {
  const processArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', npmExecutable, ...args]
    : args;
  const result = spawnSync(processExecutable, processArgs, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Paperclip execution workspaces are intentionally disposable. Install from
// each checked-in lockfile before running validation, and keep lifecycle
// scripts disabled. better-sqlite3 is rebuilt explicitly because the host
// binary must match the current Node/OS runtime after a clean install.
const installArgs = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
runNpm(installArgs, repositoryRoot);
runNpm(['rebuild', 'better-sqlite3', '--no-audit', '--no-fund'], repositoryRoot);
runNpm(installArgs, pluginRoot);
