/**
 * First production Frontend SOTA Gauntlet capture for mission-control-kanban.
 * Host: 127.0.0.1:3121 next start. Never hits :3021. Never networkidle.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MCK_BASE_URL || "http://127.0.0.1:3121";
const EXPECT_BUILD = process.env.MCK_BUILD_ID || "S8HgxCEJWRAGRBloUGmn1";
const EXPECT_SHA = process.env.MCK_CAPTURE_COMMIT || "74f671740019e26a540405bcfe52f1e6a83d900e";
const OUT = __dirname;
const SHOTS = path.join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

if (/:(3021)(\/|$)/.test(BASE)) {
  throw new Error("Refusing supervised :3021. This capture is production-only.");
}

const ROUTES = [
  { id: "home", path: "/", ready: /workspace|Loading workspaces|Mission Control/i },
  { id: "assistants", path: "/workspace/assistants", ready: /assistants|Showing|No token|Checking|lane/i },
  { id: "settings", path: "/settings", ready: /settings|runtime|token/i },
];

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844 },
];

function extractBuildId(html) {
  const flight = html.match(/"b":"([A-Za-z0-9_-]{8,})"/);
  if (flight) return flight[1];
  const staticId = html.match(/\/_next\/static\/([A-Za-z0-9_-]{8,})\//);
  if (staticId && !["chunks", "css", "media", "webpack"].includes(staticId[1])) {
    return staticId[1];
  }
  return null;
}

async function settleText(page, timeoutMs = 14000) {
  const started = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - started < timeoutMs) {
    const len = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (len === last && len > 0) {
      stable += 1;
      if (stable >= 3) {
        return { settled: true, ms: Date.now() - started, textLength: len, mode: "signature-stable" };
      }
    } else {
      stable = 0;
      last = len;
    }
    await page.waitForTimeout(400);
  }
  const textLength = await page.evaluate(() => document.body?.innerText?.length || 0);
  return { settled: false, ms: Date.now() - started, textLength, mode: "timeout" };
}

async function audit(page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const probe = document.createElement("div");
    probe.id = "__gauntlet-overflow-ctl";
    probe.style.cssText = "position:absolute;left:0;top:0;width:2200px;height:1px;pointer-events:none;";
    document.body.appendChild(probe);
    const overflowWithControl = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    probe.remove();
    const overflowAfter = document.documentElement.scrollWidth - document.documentElement.clientWidth;

    const controls = [...document.querySelectorAll("a,button,[role='button'],[role='tab'],input,select,textarea")];
    const sizes = controls
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || cs.visibility === "hidden" || cs.display === "none") return null;
        return { w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName, text: (el.innerText || el.getAttribute("aria-label") || "").slice(0, 60) };
      })
      .filter(Boolean);
    const under24 = sizes.filter((s) => s.w < 24 || s.h < 24);
    const under44 = sizes.filter((s) => s.w < 44 || s.h < 44);

    const anims = document.getAnimations({ subtree: true }).filter((a) => a.playState === "running");
    const h1 = [...document.querySelectorAll("h1")].map((el) => (el.innerText || "").trim()).filter(Boolean);
    const ready = document.querySelector("[data-workspace-ready]")?.getAttribute("data-workspace-ready") ?? null;
    const text = document.body.innerText || "";
    return {
      overflow,
      overflowWithControl,
      overflowAfter,
      overflowControlProven: overflowWithControl > overflow,
      visibleControls: sizes.length,
      under24: under24.length,
      under44: under44.length,
      under24Samples: under24.slice(0, 6),
      runningAnimations: anims.length,
      animationNames: anims.slice(0, 8).map((a) => a.animationName || a.transitionProperty || a.constructor.name),
      h1,
      readyAttr: ready,
      textLength: text.length,
      textHead: text.replace(/\s+/g, " ").trim().slice(0, 280),
      title: document.title,
    };
  });
}

const receipt = {
  app: "mission-control-kanban",
  round: "first production frontend-sota-gauntlet 2026-09-01",
  base: BASE,
  expectedBuildId: EXPECT_BUILD,
  expectedSha: EXPECT_SHA,
  capturedAt: new Date().toISOString(),
  waitUntil: "domcontentloaded",
  networkidle: false,
  units: [],
  consoleErrors: [],
  pageErrors: [],
};

const browser = await chromium.launch({ headless: true });

async function captureUnit({ viewport, route, reducedMotion = false }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "dark",
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  const response = await page.goto(`${BASE}${route.path}`, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  const rawHtml = response ? await response.text() : "";
  const html = rawHtml || (await page.content());
  const buildId = extractBuildId(html);
  const nextDevMarkers = [
    "/__nextjs_original-stack-frames",
    "__webpack_hmr",
    "webpack-hot-middleware",
    "data-nextjs-dev-overlay",
  ].filter((m) => html.includes(m));
  await page.getByText(route.ready).first().waitFor({ timeout: 12000 }).catch(() => {});
  const settle = await settleText(page);
  const metrics = await audit(page);
  const shotName = `${route.id}-${viewport.name}${reducedMotion ? "-rm" : ""}.png`;
  await page.screenshot({ path: path.join(SHOTS, shotName), fullPage: false });

  const unit = {
    route: route.path,
    id: route.id,
    viewport: viewport.name,
    reducedMotion,
    httpStatus: response ? response.status() : null,
    finalUrl: page.url(),
    buildId,
    nextDevMarkers,
    settle,
    ...metrics,
    screenshot: `shots/${shotName}`,
    consoleErrors,
    pageErrors,
  };
  receipt.units.push(unit);
  receipt.consoleErrors.push(...consoleErrors.map((t) => ({ route: route.path, viewport: viewport.name, t })));
  receipt.pageErrors.push(...pageErrors.map((t) => ({ route: route.path, viewport: viewport.name, t })));
  await context.close();
  return unit;
}

try {
  for (const route of ROUTES) {
    for (const viewport of VIEWPORTS) {
      await captureUnit({ viewport, route, reducedMotion: false });
    }
  }
  await captureUnit({
    viewport: VIEWPORTS[0],
    route: ROUTES[1],
    reducedMotion: true,
  });
} finally {
  await browser.close();
}

const servedIds = [...new Set(receipt.units.map((u) => u.buildId).filter(Boolean))];
receipt.servedBuildId = servedIds[0] || null;
receipt.buildIdMatch = receipt.servedBuildId === EXPECT_BUILD;
receipt.serverMode = receipt.units.every((u) => u.nextDevMarkers.length === 0) ? "production" : "next-dev-or-mixed";
receipt.overflowMax = Math.max(...receipt.units.map((u) => u.overflow));
receipt.summary = {
  unitCount: receipt.units.length,
  http200: receipt.units.filter((u) => u.httpStatus === 200).length,
  overflowZero: receipt.units.filter((u) => u.overflow === 0).length,
  consoleErrorCount: receipt.consoleErrors.length,
  pageErrorCount: receipt.pageErrors.length,
};

writeFileSync(path.join(OUT, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  ok: receipt.buildIdMatch && receipt.serverMode === "production",
  servedBuildId: receipt.servedBuildId,
  expectedBuildId: EXPECT_BUILD,
  expectedSha: EXPECT_SHA,
  serverMode: receipt.serverMode,
  summary: receipt.summary,
}, null, 2));
if (!receipt.buildIdMatch || receipt.serverMode !== "production") process.exit(2);
