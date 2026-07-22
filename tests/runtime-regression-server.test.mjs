import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getRuntimeRegressionServerPlan } = require('../scripts/runtime-regression-server.js');

test('Runtime Regression defaults to a fresh production build and server', () => {
  const plan = getRuntimeRegressionServerPlan({ port: 43121 });

  assert.deepEqual(plan, {
    mode: 'production',
    build: { command: 'npm', args: ['run', 'build'] },
    start: { command: 'npm', args: ['run', 'start', '--', '-H', '0.0.0.0', '-p', '43121'] },
  });
});

test('the development server is opt-in for local diagnosis only', () => {
  const plan = getRuntimeRegressionServerPlan({ mode: 'dev' });

  assert.deepEqual(plan, {
    mode: 'dev',
    build: null,
    start: { command: 'npm', args: ['run', 'dev:n8n'] },
  });
});
