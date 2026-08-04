const { spawn, spawnSync } = require('node:child_process');
const { cpSync, existsSync, rmSync } = require('node:fs');
const net = require('node:net');
const { getRuntimeRegressionServerPlan } = require('./runtime-regression-server');

const port = Number(process.env.MCK_REGRESSION_PORT || 3021);
const host = '127.0.0.1';
const baseUrl = process.env.MCK_SMOKE_URL || `http://${host}:${port}`;
const isWindows = process.platform === 'win32';

function commandForPlatform(command) {
  if (!isWindows) return command;
  if (command === 'npm' || command === 'npx') return `${command}.cmd`;
  return command;
}

function windowsCommandArgs(command, args) {
  return ['/d', '/s', '/c', commandForPlatform(command), ...args];
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = isWindows
      ? spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', windowsCommandArgs(command, args), {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
        env: { ...process.env, ...(options.env || {}) },
      })
      : spawn(command, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
        env: { ...process.env, ...(options.env || {}) },
      });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); process.stderr.write(chunk); });
    child.on('error', (error) => {
      stderr += error.message;
      console.error(error);
      resolve({ code: 1, stdout, stderr });
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}


function taskkillPid(pid) {
  const taskkillPath = 'C:\\Windows\\System32\\taskkill.exe';
  const result = spawnSync(taskkillPath, ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit' });
  if (result.error) {
    console.warn(`Failed to taskkill PID ${pid}: ${result.error.message}`);
  }
}

function killPortListeners() {
  if (!isWindows) return;
  const result = spawnSync('netstat.exe', ['-ano'], { encoding: 'utf8' });
  if (result.error || !result.stdout) return;
  const pids = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.includes(`:${port}`) && line.includes('LISTENING')) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
  }
  for (const pid of pids) taskkillPid(pid);
}

function killProcessTree(child) {
  if (!child?.pid) return;
  if (isWindows) {
    taskkillPid(child.pid);
    return;
  }
  child.kill('SIGTERM');
}

function stageRuntimeAssets(assets) {
  for (const asset of assets) {
    if (!existsSync(asset.source)) {
      throw new Error(`Runtime Regression asset is missing after build: ${asset.source}`);
    }
    rmSync(asset.destination, { recursive: true, force: true });
    cpSync(asset.source, asset.destination, { recursive: true });
  }
}

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

async function waitForServer(timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isPortOpen()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  const startedAt = new Date().toISOString();
  const checks = [];
  const serverPlan = getRuntimeRegressionServerPlan({ port });

  const reactDoctor = await run('node', ['scripts/run-react-doctor.js']);
  checks.push({ name: 'React Doctor changed-file gate', ok: reactDoctor.code === 0 });

  let server;
  const alreadyRunning = await isPortOpen();
  if (alreadyRunning && serverPlan.mode === 'production') {
    throw new Error(`Runtime Regression requires an isolated production server; ${baseUrl} is already in use.`);
  }

  if (!alreadyRunning) {
    if (serverPlan.build) {
      const build = await run(serverPlan.build.command, serverPlan.build.args);
      if (build.code !== 0) {
        throw new Error(`Runtime Regression production build failed with exit code ${build.code}.`);
      }
      stageRuntimeAssets(serverPlan.assets);
    }

    server = isWindows
      ? spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', windowsCommandArgs(serverPlan.start.command, serverPlan.start.args), {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...(serverPlan.start.env || {}) },
      })
      : spawn(serverPlan.start.command, serverPlan.start.args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...(serverPlan.start.env || {}) },
      });
    server.stdout.on('data', (chunk) => process.stdout.write(chunk));
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
    if (!await waitForServer()) {
      killProcessTree(server);
      throw new Error(`MCK ${serverPlan.mode} server did not become ready on ${baseUrl}`);
    }
  }

  try {
    const smoke = await run('npm', ['run', 'smoke:runtime-ui'], { env: { MCK_SMOKE_URL: baseUrl } });
    checks.push({ name: 'runtime UI responsive smoke', ok: smoke.code === 0 });
  } finally {
    if (server) {
      killProcessTree(server);
      killPortListeners();
    }
  }

  const ok = checks.every((check) => check.ok);
  const report = { ok, started_at: startedAt, finished_at: new Date().toISOString(), baseUrl, checks };
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
