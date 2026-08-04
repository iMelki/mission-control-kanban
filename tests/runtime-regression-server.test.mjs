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
    assets: [
      { source: 'public', destination: '.next/standalone/public' },
      { source: '.next/static', destination: '.next/standalone/.next/static' },
    ],
    start: {
      command: 'node',
      args: ['.next/standalone/server.js'],
      env: { HOSTNAME: '0.0.0.0', PORT: '43121' },
    },
  });
});

test('the development server is opt-in for local diagnosis only', () => {
  const plan = getRuntimeRegressionServerPlan({ mode: 'dev' });

  assert.deepEqual(plan, {
    mode: 'dev',
    build: null,
    assets: [],
    start: { command: 'npm', args: ['run', 'dev:n8n'] },
  });
});
