const DEFAULT_SERVER_MODE = 'production';

function getRuntimeRegressionServerPlan({
  mode = process.env.MCK_REGRESSION_SERVER_MODE || DEFAULT_SERVER_MODE,
  host = '0.0.0.0',
  port = 3021,
} = {}) {
  const normalizedMode = mode === 'dev' ? 'dev' : DEFAULT_SERVER_MODE;

  if (normalizedMode === 'dev') {
    return {
      mode: normalizedMode,
      build: null,
      assets: [],
      start: { command: 'npm', args: ['run', 'dev:n8n'] },
    };
  }

  return {
    mode: normalizedMode,
    build: { command: 'npm', args: ['run', 'build'] },
    assets: [
      { source: 'public', destination: '.next/standalone/public' },
      { source: '.next/static', destination: '.next/standalone/.next/static' },
    ],
    start: {
      command: 'node',
      args: ['.next/standalone/server.js'],
      env: { HOSTNAME: host, PORT: String(port) },
    },
  };
}

module.exports = { getRuntimeRegressionServerPlan };
