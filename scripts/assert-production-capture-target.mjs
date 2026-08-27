/**
 * Capture-target preflight for Mission Control Kanban (#164 / #139).
 *
 * next dev on the supervised LocalNext port (3021) dies under consecutive
 * on-demand compiles. A GET / on that port is itself the compile that starts
 * the death sequence, so this module refuses 3021 without fetching it.
 *
 * A leftover .next/BUILD_ID is not provenance on a next-dev listener (fleet
 * finding, 2026-08-13). Production evidence is a non-supervised target plus a
 * BUILD_ID that belongs to that serve. Gauntlet / UI scores must not be claimed
 * from next-dev or from a target this gate refuses.
 *
 * Usage:
 *   MCK_BASE_URL=http://127.0.0.1:3121 MCK_BUILD_ID=<id> \
 *     node scripts/assert-production-capture-target.mjs
 *   MCK_BASE_URL=... MCK_NEXT_DIR=<worktree>/.next node scripts/assert-production-capture-target.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPERVISED_DEV_PORT = 3021;
export const EXIT_REFUSED = 2;

const BUILD_ID_PATTERN = /^[A-Za-z0-9_-]{8,}$/;
const NEXT_DEV_HTML_MARKERS = [
  '/__nextjs_original-stack-frames',
  '__webpack_hmr',
  'webpack-hot-middleware',
  '/_next/static/chunks/react-refresh',
  'webpackHotUpdate',
  'data-nextjs-dev-overlay',
  'nextjs-portal',
];

function refused(code, detail, extra = {}) {
  return {
    ok: false,
    scoreable: false,
    serverMode: extra.serverMode || 'unknown',
    code,
    detail,
    buildId: extra.buildId || null,
    fetched: extra.fetched === true,
    ...extra,
  };
}

export function parseCaptureBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      ok: false,
      code: 'base_url_required',
      detail:
        'MCK_BASE_URL is required. Do not default to http://127.0.0.1:3021 — that is the ' +
        'supervised next-dev listener and #164 showed it dies under capture. Serve ' +
        '`next start` on another port. See docs/production-capture.md.',
    };
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return {
      ok: false,
      code: 'base_url_invalid',
      detail: `MCK_BASE_URL ${JSON.stringify(raw)} is not a URL.`,
    };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      code: 'base_url_invalid',
      detail: `MCK_BASE_URL must be http(s); got ${url.protocol}`,
    };
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80;
  return {
    ok: true,
    href: url.href.replace(/\/$/, ''),
    host: url.hostname.toLowerCase(),
    port,
  };
}

export function isSupervisedNextDevTarget(parsed) {
  if (!parsed || parsed.ok !== true) return false;
  const local =
    parsed.host === '127.0.0.1' ||
    parsed.host === 'localhost' ||
    parsed.host === '[::1]' ||
    parsed.host === '::1';
  return local && parsed.port === SUPERVISED_DEV_PORT;
}

export function detectNextDevHtml(html) {
  if (typeof html !== 'string' || html === '') {
    return { isNextDev: false, markers: [] };
  }
  const markers = NEXT_DEV_HTML_MARKERS.filter((marker) => html.includes(marker));
  return { isNextDev: markers.length > 0, markers };
}

export function extractBuildIdFromHtml(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/\/_next\/static\/([A-Za-z0-9_-]{8,})\//);
  if (!match) return null;
  const id = match[1];
  if (id === 'chunks' || id === 'css' || id === 'media' || id === 'webpack') {
    return null;
  }
  return BUILD_ID_PATTERN.test(id) ? id : null;
}

export function readBuildIdFile(nextDir) {
  if (typeof nextDir !== 'string' || nextDir.trim() === '') return null;
  try {
    const raw = fs.readFileSync(path.join(nextDir, 'BUILD_ID'), 'utf8').trim();
    return BUILD_ID_PATTERN.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function resolveBuildIdFromEnv({ env = process.env, repoRoot } = {}) {
  const fromEnv = typeof env.MCK_BUILD_ID === 'string' ? env.MCK_BUILD_ID.trim() : '';
  if (fromEnv) return fromEnv;
  const nextDir =
    typeof env.MCK_NEXT_DIR === 'string' && env.MCK_NEXT_DIR.trim()
      ? env.MCK_NEXT_DIR.trim()
      : repoRoot
        ? path.join(repoRoot, '.next')
        : null;
  return readBuildIdFile(nextDir);
}

export function classifyCaptureTarget({
  baseUrl,
  buildId,
  html,
  allowDevCapture = false,
} = {}) {
  const parsed = parseCaptureBaseUrl(baseUrl);
  if (!parsed.ok) {
    return refused(parsed.code, parsed.detail, { fetched: false });
  }

  if (isSupervisedNextDevTarget(parsed)) {
    return refused(
      'supervised_next_dev',
      `Refusing ${parsed.href}: port ${SUPERVISED_DEV_PORT} is the LocalNext ` +
        'next-dev listener. Hitting it compiles on demand and has killed the ' +
        'process (#164). Serve a production build on another port. ' +
        'See docs/production-capture.md. MCK_ALLOW_DEV_CAPTURE does not override this.',
      {
        serverMode: 'next-dev',
        buildId: buildId || null,
        fetched: false,
        allowDevCaptureIgnored: Boolean(allowDevCapture),
      }
    );
  }

  const htmlDetect = detectNextDevHtml(html || '');
  if (htmlDetect.isNextDev) {
    return refused(
      'next_dev_html',
      `Target HTML has next-dev markers (${htmlDetect.markers.join(', ')}). ` +
        'A leftover BUILD_ID is not provenance. This target is not scoreable.',
      {
        serverMode: 'next-dev',
        buildId: buildId || extractBuildIdFromHtml(html) || null,
        markers: htmlDetect.markers,
      }
    );
  }

  const htmlBuildId = extractBuildIdFromHtml(html || '');
  const resolved = typeof buildId === 'string' && buildId.trim() ? buildId.trim() : htmlBuildId;
  if (!resolved) {
    return refused(
      'build_id_required',
      'No production BUILD_ID. Set MCK_BUILD_ID or MCK_NEXT_DIR to the served ' +
        "worktree's .next, or capture HTML that contains /_next/static/<BUILD_ID>/. " +
        'A leftover .next/BUILD_ID next to next-dev is not provenance.',
      { fetched: Boolean(html) }
    );
  }
  if (!BUILD_ID_PATTERN.test(resolved)) {
    return refused(
      'build_id_invalid',
      `BUILD_ID ${JSON.stringify(resolved)} is not a Next.js production id.`,
      { buildId: resolved }
    );
  }
  if (htmlBuildId && htmlBuildId !== resolved) {
    return refused(
      'build_id_mismatch',
      `Served HTML BUILD_ID ${htmlBuildId} does not match ${resolved}.`,
      { buildId: resolved, htmlBuildId }
    );
  }

  return {
    ok: true,
    scoreable: true,
    serverMode: 'production',
    code: 'production_ok',
    detail: `Production capture target ${parsed.href} with BUILD_ID ${resolved}.`,
    buildId: resolved,
    href: parsed.href,
    fetched: Boolean(html),
  };
}

export async function inspectLiveHtml(baseHref, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const url = `${String(baseHref).replace(/\/$/, '')}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    const html = await response.text();
    return { ok: response.ok, status: response.status, html };
  } finally {
    clearTimeout(timer);
  }
}

export async function prepareProductionCaptureTarget({
  env = process.env,
  repoRoot,
  fetchHtml = inspectLiveHtml,
} = {}) {
  const parsed = parseCaptureBaseUrl(env.MCK_BASE_URL);
  const buildId = resolveBuildIdFromEnv({ env, repoRoot });
  if (!parsed.ok) {
    return refused(parsed.code, parsed.detail, { buildId, fetched: false });
  }

  const beforeFetch = classifyCaptureTarget({
    baseUrl: env.MCK_BASE_URL,
    buildId,
    allowDevCapture: env.MCK_ALLOW_DEV_CAPTURE === '1',
  });
  if (beforeFetch.code === 'supervised_next_dev' || beforeFetch.code === 'base_url_invalid') {
    return { ...beforeFetch, fetched: false };
  }

  let live;
  try {
    live = await fetchHtml(parsed.href);
  } catch (error) {
    return refused(
      'target_unreachable',
      `Could not GET ${parsed.href}/ (${error && error.message ? error.message : error}).`,
      { buildId, fetched: true }
    );
  }

  return {
    ...classifyCaptureTarget({
      baseUrl: env.MCK_BASE_URL,
      buildId,
      html: live.html,
      allowDevCapture: env.MCK_ALLOW_DEV_CAPTURE === '1',
    }),
    fetched: true,
    httpStatus: live.status,
  };
}

export function exitIfCaptureTargetUnscoreable(result, { stderr = console.error } = {}) {
  if (result && result.ok && result.scoreable) return result;
  const code = result && result.code ? result.code : 'unscoreable';
  const detail = result && result.detail ? result.detail : 'capture target refused';
  stderr(`CAPTURE TARGET REFUSED (${code}): ${detail}`);
  stderr('Gauntlet / UI scores must not be claimed from this target.');
  process.exit(EXIT_REFUSED);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
  const result = await prepareProductionCaptureTarget({ repoRoot });
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    const stream = result.ok && result.scoreable ? console.log : console.error;
    stream(`${result.code}: ${result.detail}`);
  }
  if (!result.ok || !result.scoreable) process.exit(EXIT_REFUSED);
}
