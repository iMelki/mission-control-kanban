/**
 * Process helpers for the design-drift launcher: spawn, run with a timeout, and
 * stop a process tree. Kept apart from scripts/design-drift.mjs so the timeout
 * path can be tested with a real hung process tree.
 */
import { spawn, spawnSync } from 'node:child_process';
import { armTimeout, killProcessGroup } from './design-drift.mjs';

const isWindows = process.platform === 'win32';

// Timed runs on POSIX lead their own process group, so the terminal's Ctrl-C no
// longer reaches them. Track those groups and stop them when the launcher exits
// or is signalled, otherwise a cancelled run leaves a hung Dembrandt behind.
const activeGroups = new Set();
const TIMEOUT_GRACE_MS = 5000;
let cleanupInstalled = false;

function groupGone(child) {
  try { process.kill(-child.pid, 0); return false; } catch { return true; }
}

/** Synchronous last resort (the 'exit' hook cannot wait): SIGKILL whatever is still tracked. */
export function terminateActiveGroups() {
  for (const child of activeGroups) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
  }
  activeGroups.clear();
}

/** Cancellation: SIGTERM every tracked group, give them `graceMs` to leave, then SIGKILL the survivors. */
export async function cancelActiveGroups({ graceMs = 2000 } = {}) {
  const groups = [...activeGroups];
  activeGroups.clear();
  for (const child of groups) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group already gone */ }
  }
  const deadline = Date.now() + graceMs;
  while (groups.some((child) => !groupGone(child)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const child of groups) {
    if (groupGone(child)) continue;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
  }
}

function installGroupCleanup() {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  process.on('exit', terminateActiveGroups);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => {
      cancelActiveGroups().finally(() => process.exit(code));
    });
  }
}

export function spawnCommand(command, commandArgs, options) {
  if (!isWindows) return spawn(command, commandArgs, { shell: false, ...options });
  const shim = command === 'npm' || command === 'npx' ? `${command}.cmd` : command;
  return spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', shim, ...commandArgs], {
    shell: false,
    windowsHide: true,
    ...options,
  });
}

export function run(command, commandArgs, { env = {}, capture = false, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    // A timed run leads its own process group on POSIX so the timeout can stop npx AND the Dembrandt it spawned.
    const child = spawnCommand(command, commandArgs, {
      stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
      env: { ...process.env, ...env },
      detached: timeoutMs > 0 && !isWindows,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    if (child.pid && timeoutMs > 0 && !isWindows) {
      activeGroups.add(child);
      installGroupCleanup();
    }
    const finish = (result) => {
      if (settled) return;
      settled = true;
      guard.clear();
      // After a timeout the group stays tracked until its SIGKILL escalation has run, so a cancel
      // or exit during that grace period still reaches a descendant that ignored SIGTERM.
      if (!timedOut) activeGroups.delete(child);
      resolve(result);
    };
    const guard = armTimeout(child, timeoutMs, (hung) => {
      if (isWindows) stopProcessTree(hung);
      else {
        timedOut = true;
        killProcessGroup(hung, { graceMs: TIMEOUT_GRACE_MS });
        // Untrack only once the SIGKILL escalation (graceMs) has fired.
        setTimeout(() => activeGroups.delete(child), TIMEOUT_GRACE_MS + 500).unref();
      }
      // Do not wait for `close`: a surviving descendant can keep the pipes open indefinitely.
      finish({ code: 1, stdout: '', stderr: `${stderr} timed out after ${timeoutMs / 1000}s`.trim() });
    });
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

export function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (isWindows) {
    spawnSync('C:\\Windows\\System32\\taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}
