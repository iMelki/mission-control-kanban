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

// Static demo build (`npm run build:demo`, which sets NEXT_PUBLIC_DEMO_MODE=1).
// Without that flag this block is inert and the export above is unchanged.
//
// - output 'export' writes plain HTML/CSS/JS to out-demo/ (no server).
// - pageExtensions drops `.ts`, so every route.ts handler (src/app/api/**,
//   src/app/metrics) is left out of the build, and lists `demo.tsx` first so
//   the `layout.demo.tsx` files take the place of their normal counterparts.
// - src/demo/instrumentation-client.ts runs before hydration and answers the
//   app's /api calls in the browser from fictional fixtures.
// - A few components that only talk to the operator's own services are
//   swapped for calm "Not available in the demo" stand-ins, and
//   scripts/demo/redact-loader.cjs swaps operator-specific example strings
//   for neutral placeholders.
const demoReplacements = {
  'src/components/LocalControlPanel.tsx': 'src/demo/replacements/LocalControlPanel.tsx',
  'src/components/GitHubReadinessCard.tsx': 'src/demo/replacements/GitHubReadinessCard.tsx',
  'src/components/GitHubConnectionStatus.tsx': 'src/demo/replacements/GitHubConnectionStatus.tsx',
  'src/components/RuntimeHealthBadges.tsx': 'src/demo/replacements/RuntimeHealthBadges.tsx',
  'src/lib/cockpit-load-state.ts': 'src/demo/replacements/cockpit-load-state.ts',
};

/** @type {import('next').NextConfig} */
const demoConfig = {
  output: 'export',
  distDir: 'out-demo',
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ['demo.tsx', 'tsx'],
  webpack: (config, context) => {
    nextConfig.webpack(config, context);
    if (!context.isServer) {
      config.resolve.alias['private-next-instrumentation-client-user'] = path.join(
        worktreeRoot,
        'src/demo/instrumentation-client.ts',
      );
    }
    const replacements = new Map(
      Object.entries(demoReplacements).map(([from, to]) => [
        path.join(worktreeRoot, from),
        path.join(worktreeRoot, to),
      ]),
    );
    const replacementFiles = new Set(replacements.values());
    config.module.rules.unshift({
      test: /\.[cm]?[jt]sx?$/,
      include: path.join(worktreeRoot, 'src'),
      enforce: 'pre',
      use: [{ loader: path.join(worktreeRoot, 'scripts/demo/redact-loader.cjs') }],
    });
    config.plugins.push(
      new context.webpack.NormalModuleReplacementPlugin(/.*/, (resource) => {
        const resolved = resource.createData?.resource;
        if (!resolved) return;
        const target = replacements.get(resolved.split('?')[0]);
        // The stand-in for cockpit-load-state re-exports the real module.
        if (!target || replacementFiles.has(resource.contextInfo?.issuer)) return;
        resource.createData.resource = target;
        resource.createData.context = path.dirname(target);
        resource.createData.userRequest = target;
        resource.createData.request = resource.createData.request.replace(resolved, target);
      }),
    );
    return config;
  },
};

export default process.env.NEXT_PUBLIC_DEMO_MODE === '1' ? demoConfig : nextConfig;
