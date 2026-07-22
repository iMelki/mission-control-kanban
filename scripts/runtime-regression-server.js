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
      start: { command: 'npm', args: ['run', 'dev:n8n'] },
    };
  }

  return {
    mode: normalizedMode,
    build: { command: 'npm', args: ['run', 'build'] },
    start: { command: 'npm', args: ['run', 'start', '--', '-H', host, '-p', String(port)] },
  };
}

module.exports = { getRuntimeRegressionServerPlan };
