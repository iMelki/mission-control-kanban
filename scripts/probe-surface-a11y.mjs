/**
 * Keyboard / focus-visible / contrast / axe measurement for every surface
 * docs/captured-surfaces.json marks `capture: "required"`, at every viewport
 * the manifest declares.
 *
 * Read-only against the app: it navigates, measures, and removes anything it
 * injects. It never mutates the app or the repo. The JSON record lands in
 * `artifacts/` (gitignored).
 *
 * Provenance (reuse-first)
 * -----------------------
 * Adapted from component-marketplace scripts/operator-primitives-visual-check.mjs
 * (blob ca4bcbf5028760ffb61b058331715740de7ff232), which produced this
 * programme's first measured keyboard/focus/contrast evidence.
 *
 * Ported with the algorithm intact:
 *   - verifyFocusIndicator: the focus/Tab/focus priming that makes Chromium
 *     apply :focus-visible to a programmatic focus, the three-ancestor
 *     outline/box-shadow candidate walk, and the elementFromPoint occlusion
 *     test. Reused because focus rings are frequently painted on a wrapper
 *     rather than on the focused node, and a naive check misses that.
 *   - runAxeScan: the WCAG tag set, dedup-by-rule-id, and the rule that
 *     critical/serious *incomplete* findings block rather than pass silently.
 *
 * Deliberately NOT ported, and why
 * --------------------------------
 * component-marketplace's runExplicitContrastAudit selects elements by the
 * hand-authored attributes [data-contrast-background]/[data-contrast-foreground].
 * This repo has ZERO such attributes (0 hits across src/). Porting that selector
 * verbatim would check 0 pairs and report `minimumRatio: null` -- a vacuous
 * zero, which is exactly the fail-open defect this programme keeps finding.
 * This harness instead derives both colors from COMPUTED STYLE on rendered text,
 * resolving the effective background by compositing ancestors until opaque. That
 * measures what is actually on screen instead of what someone remembered to
 * annotate.
 *
 * component-marketplace's exerciseKeyboardInteractions is bound to that app's
 * specific widgets (clipboard stub, action-review dialog, run search). Those
 * widgets do not exist here, so the keyboard pass is a generic reachability /
 * trap / indicator walk over each surface's real focusable set.
 *
 * Why document-level probing is not used
 * --------------------------------------
 * src/app/globals.css sets `max-width:100vw; overflow-x:hidden`. Document scroll
 * is therefore blind here -- the same reason scripts/probe-surface-clipping.mjs
 * measures element-level. Nothing in this harness decides anything from document
 * geometry.
 *
 * Self-proof
 * ----------
 * Before trusting any zero, the run injects a known-bad element for EACH
 * detector (2:1-ish contrast text, a control with its focus ring suppressed, an
 * unlabelled image) and requires every detector to move off baseline, then
 * removes the injection and requires each to return to baseline. A detector that
 * cannot report a violation is worthless; if any leg fails this exits 2 rather
 * than printing a reassuring row of zeroes.
 *
 * Usage:
 *   node scripts/probe-surface-a11y.mjs --self-proof   # prove the probe only
 *   node scripts/probe-surface-a11y.mjs                # measure all surfaces
 *   MCK_BASE_URL=http://127.0.0.1:3021 node scripts/probe-surface-a11y.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const base = (process.env.MCK_BASE_URL || 'http://127.0.0.1:3021').replace(/\/$/, '');
const AXE_PATH = path.join(repoRoot, 'node_modules', 'axe-core', 'axe.min.js');
const SELF_PROOF_ONLY = process.argv.includes('--self-proof');
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outDir = path.resolve(positional[0] || path.join(repoRoot, 'artifacts', 'surface-a11y'));

const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'docs', 'captured-surfaces.json'), 'utf8')
);
const viewports = manifest.viewports.map((v) => ({ w: v.width, h: v.height, label: v.label }));
// Drive the route list from the manifest so this can never drift from the gate.
const routes = manifest.surfaces
  .filter((s) => s.capture === 'required')
  .map((s) => ({
    url: s.route,
    name: s.route === '/' ? 'home' : s.route.replace(/^\//, '').replace(/\//g, '-'),
  }));
const control = routes.find((r) => r.url === '/') || routes[0];

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FOCUSABLE =
  'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
const MAX_FOCUS_CHECKS = Number(process.env.MCK_A11Y_MAX_FOCUS || '40');
const MAX_TAB_STEPS = Number(process.env.MCK_A11Y_MAX_TABS || '60');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Node-side twin of the page-side `opaque` check; see verifyFocusIndicators. */
function isOpaqueColor(color) {
  const m = /rgba?\(([^)]+)\)/.exec(color || '');
  if (!m) return false;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return parts.length < 4 ? true : parts[3] > 0.05;
}

/**
 * The dev server injects its own overlay (the "Open Next.js Dev Tools" button and
 * its portal). It is framework chrome, not this app, and it does not exist in a
 * production build -- the first run of this harness attributed 16 of 16
 * focus-obscured failures to that single button. Measuring it would report a
 * defect the users of this app can never encounter, so every detector filters it
 * out and the report says so. Defined once per page as window.__isAppEl.
 */
async function defineAppElementFilter(page) {
  await page.evaluate(() => {
    window.__isAppEl = (el) => {
      if (!el || !el.tagName) return false;
      for (let n = el; n; n = n.parentElement) {
        const tag = n.tagName ? n.tagName.toLowerCase() : '';
        if (tag === 'nextjs-portal' || tag === 'nextjs-dev-tools') return false;
        if (n.id && /^(__)?next(js)?[-_]?dev/i.test(n.id)) return false;
        if (n.getAttribute && n.getAttribute('aria-label') === 'Open Next.js Dev Tools') return false;
        if (n.attributes) {
          for (const a of n.attributes) {
            if (/^data-nextjs/i.test(a.name)) return false;
          }
        }
      }
      return true;
    };
  });
}

if (!fs.existsSync(AXE_PATH)) {
  console.error('axe-core not found at ' + AXE_PATH + '. Run npm install.');
  process.exit(2);
}

/* ------------------------------------------------------------------ axe --- */
async function runAxeScan(page) {
  await page.addScriptTag({ path: AXE_PATH });
  const raw = await page.evaluate(
    async (tags) =>
      await window.axe.run(
        // Exclude the dev-server overlay; see defineAppElementFilter.
        { exclude: [['nextjs-portal'], ['[data-nextjs-dev-tools-button]'], ['#__next-dev-tools']] },
        { runOnly: { type: 'tag', values: tags } }
      ),
    AXE_TAGS
  );
  const shape = (f) => ({
    id: f.id,
    impact: f.impact,
    help: f.help,
    helpUrl: f.helpUrl,
    targets: f.nodes.flatMap((n) => n.target.map(String)).slice(0, 8),
    nodeCount: f.nodes.length,
    sample: f.nodes.slice(0, 3).map((n) => ({
      html: (n.html || '').slice(0, 200),
      target: n.target.map(String),
      failureSummary: n.failureSummary,
    })),
  });
  const violations = raw.violations.map(shape);
  const incomplete = raw.incomplete.map(shape);
  // Same rule as the sibling: critical/serious "incomplete" is NOT a pass.
  const blockingIncomplete = incomplete.filter((f) => ['critical', 'serious'].includes(f.impact));
  const byImpact = {};
  for (const v of violations) {
    const k = v.impact || 'unknown';
    byImpact[k] = (byImpact[k] || 0) + 1;
  }
  return {
    violations,
    incomplete,
    blockingIncomplete,
    metrics: {
      violations: violations.length,
      violationNodes: violations.reduce((n, v) => n + v.nodeCount, 0),
      byImpact,
      incomplete: incomplete.length,
      blockingIncomplete: blockingIncomplete.length,
      passes: raw.passes.length,
    },
  };
}

/* -------------------------------------------------------------- contrast --- */
/** Computed-style contrast over rendered text. See header for why not data-attrs. */
async function runComputedContrastAudit(page) {
  return await page.evaluate(() => {
    const toLinear = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = (rgb) => 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
    const parse = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s || '');
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (p.length < 3 || p.some(Number.isNaN)) return null;
      return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

    // Effective background: composite ancestors until fully opaque.
    function effectiveBg(el) {
      let cur = el;
      let acc = null;
      let imageBlocked = false;
      while (cur) {
        const cs = getComputedStyle(cur);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') imageBlocked = true;
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) {
          acc =
            acc === null
              ? { rgb: c.rgb.slice(), a: c.a }
              : { rgb: over(acc.rgb, c.rgb, acc.a), a: acc.a + c.a * (1 - acc.a) };
          if (acc.a >= 0.999) return { rgb: acc.rgb.map(Math.round), imageBlocked };
        }
        cur = cur.parentElement;
      }
      const white = [255, 255, 255];
      return {
        rgb: acc ? over(acc.rgb, white, acc.a).map(Math.round) : white,
        imageBlocked,
      };
    }

    const pairs = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!window.__isAppEl(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.split(/\s+/).indexOf('sr-only') !== -1) continue;
      // Only elements owning a direct, non-empty text node.
      const text = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(' ')
        .trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;

      const fgP = parse(cs.color);
      if (!fgP) continue;
      const bg = effectiveBg(el);
      const fg = fgP.a >= 0.999 ? fgP.rgb : over(fgP.rgb, bg.rgb, fgP.a);
      const L1 = lum(fg);
      const L2 = lum(bg.rgb);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);

      const px = Number.parseFloat(cs.fontSize);
      const weight = Number.parseInt(cs.fontWeight, 10) || 400;
      const large = px >= 24 || (px >= 18.66 && weight >= 700);
      const required = large ? 3.0 : 4.5;

      // Dedupe identical token pairs so the count reflects distinct color
      // decisions rather than how many times a component repeats on screen.
      const key = cs.color + '|' + bg.rgb.join(',') + '|' + Math.round(px) + '|' + weight;
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 80),
        text: text.replace(/\s+/g, ' ').slice(0, 50),
        fg: 'rgb(' + fg.map(Math.round).join(',') + ')',
        bg: 'rgb(' + bg.rgb.join(',') + ')',
        fontPx: px,
        weight,
        large,
        required,
        ratio: Math.round(ratio * 100) / 100,
        pass: ratio >= required,
        backgroundImagePresent: bg.imageBlocked,
      });
    }
    const failing = pairs.filter((p) => !p.pass);
    const ratios = pairs.map((p) => p.ratio);
    return {
      metrics: {
        checked: pairs.length,
        passed: pairs.length - failing.length,
        failed: failing.length,
        minimumRatio: ratios.length ? Math.min.apply(null, ratios) : null,
      },
      failing: failing.sort((a, b) => a.ratio - b.ratio).slice(0, 20),
      pairs,
    };
  });
}

/* -------------------------------------------------------------- keyboard --- */
/** Inventory of the real focusable set on this surface. */
async function focusableInventory(page) {
  return await page.evaluate((sel) => {
    const all = Array.from(document.querySelectorAll(sel)).filter((el) => {
      if (!window.__isAppEl(el)) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (el.hasAttribute('disabled')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return {
      focusableCount: all.length,
      positiveTabIndexCount: all.filter((el) => Number(el.getAttribute('tabindex')) > 0).length,
    };
  }, FOCUSABLE);
}

/** Real Tab traversal driven by the browser, so the UA focus manager is exercised. */
async function tabWalk(page, maxTabs) {
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
  });
  const visited = [];
  let trapped = null;
  let prevKey = null;
  let repeats = 0;
  let devChromeStops = 0;
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // Dev-overlay chrome is a real tab stop in dev but does not ship; skip it.
      if (!window.__isAppEl(el)) return { devChrome: true };
      // Identity must be the ELEMENT, not a description of it. Two adjacent
      // inputs that share a class, a size and an empty label produce identical
      // descriptions, and a description-keyed trap check reports a keyboard
      // trap that is not there. Stamp a per-element sequence instead.
      if (!el.__probeId) {
        window.__probeSeq = (window.__probeSeq || 0) + 1;
        el.__probeId = window.__probeSeq;
      }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        probeId: el.__probeId,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        label: (el.getAttribute('aria-label') || el.textContent || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
        boxShadow: cs.boxShadow === 'none' || cs.boxShadow === '' ? 'none' : 'present',
        focusVisible: el.matches(':focus-visible'),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
    if (!info) {
      visited.push(null);
      prevKey = null;
      repeats = 0;
      continue;
    }
    if (info.devChrome) {
      devChromeStops += 1;
      prevKey = null;
      repeats = 0;
      continue;
    }
    const key = 'el#' + info.probeId;
    if (key === prevKey) {
      repeats += 1;
      // Three consecutive Tabs that never leave the same control is a trap.
      if (repeats >= 3 && !trapped) trapped = info;
    } else {
      repeats = 0;
    }
    prevKey = key;
    visited.push(info);
  }
  const stops = visited.filter(Boolean);
  const distinct = new Set(stops.map((s) => s.probeId));
  return {
    tabStops: stops.length,
    distinctStops: distinct.size,
    devChromeStopsExcluded: devChromeStops,
    focusLeftDocument: visited.filter((p) => p === null).length,
    keyboardTrap: trapped,
    focusVisibleOnTab: stops.filter((s) => s.focusVisible).length,
    noIndicatorOnTab: stops.filter(
      (s) =>
        !(
          (s.outlineStyle !== 'none' &&
            Number.parseFloat(s.outlineWidth) > 0 &&
            isOpaqueColor(s.outlineColor)) ||
          s.boxShadow === 'present'
        )
    ).length,
    sample: stops.slice(0, 12),
  };
}

/* ----------------------------------------------------------------- focus --- */
/** Ported from component-marketplace verifyFocusIndicator (blob ca4bcbf5). */
async function verifyFocusIndicators(page, limit) {
  const handles = await page.locator(FOCUSABLE).elementHandles();
  const evidence = [];
  const failures = [];
  let checked = 0;
  for (const h of handles) {
    if (checked >= limit) break;
    let usable = false;
    try {
      usable = await h.evaluate((el) => {
        if (!window.__isAppEl(el)) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (el.hasAttribute('disabled')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    } catch (e) {
      // A swallowed error here silently empties the focusable set and makes the
      // whole pass report a reassuring zero. Surface it instead.
      usable = false;
      failures.push('focus usability check threw: ' + String(e).slice(0, 160));
    }
    if (!usable) continue;
    checked += 1;
    try {
      await h.evaluate((el) =>
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
      );
      await delay(30);
      await h.focus();
      // focus/Tab/focus primes keyboard modality so Chromium applies
      // :focus-visible to the final programmatic focus used for measurement.
      await page.keyboard.press('Tab');
      await h.focus();
      const result = await h.evaluate((element) => {
        const candidates = [
          element,
          element.parentElement,
          element.parentElement ? element.parentElement.parentElement : null,
        ].filter(Boolean);
        const styles = candidates.map((c) => {
          const s = window.getComputedStyle(c);
          return {
            boxShadow: s.boxShadow,
            outlineStyle: s.outlineStyle,
            outlineWidth: s.outlineWidth,
            outlineColor: s.outlineColor,
            borderColor: s.borderColor,
          };
        });
        // Tailwind's `outline-none` compiles to `outline: 2px solid transparent`
        // (verified in this repo's generated CSS, tailwindcss 3.4.19). A width-and-
        // style-only check therefore scores an INVISIBLE outline as a visible focus
        // ring. Require a non-transparent color.
        const opaque = (color) => {
          const m = /rgba?\(([^)]+)\)/.exec(color || '');
          if (!m) return false;
          const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
          return parts.length < 4 ? true : parts[3] > 0.05;
        };
        const shadowVisible = (shadow) =>
          shadow !== 'none' && shadow !== '' && !/rgba\([^)]*,\s*0\s*\)/.test(shadow);
        const focusVisible = element.matches(':focus-visible');
        const rect = element.getBoundingClientRect();
        const cx = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
        const cy = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
        const top = document.elementFromPoint(cx, cy);
        const inViewport = rect.bottom > 0 && rect.top < window.innerHeight;
        const unobscured =
          inViewport &&
          Boolean(top) &&
          (element === top || element.contains(top) || top.contains(element));
        const visible =
          focusVisible &&
          styles.some(
            (s) =>
              (s.outlineStyle !== 'none' &&
                Number.parseFloat(s.outlineWidth) > 0 &&
                opaque(s.outlineColor)) ||
              shadowVisible(s.boxShadow)
          );
        // Recorded so "no indicator at all" is distinguishable from "the outline
        // was suppressed and only a border-colour change remains", which is a
        // human judgement call rather than an automatic failure.
        const transparentOutlineOnly =
          !visible &&
          styles.some(
            (s) =>
              s.outlineStyle !== 'none' &&
              Number.parseFloat(s.outlineWidth) > 0 &&
              !opaque(s.outlineColor)
          );
        return {
          label: (element.getAttribute('aria-label') || element.textContent || element.tagName)
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 50),
          tag: element.tagName.toLowerCase(),
          active: document.activeElement === element,
          // A roving-tabindex container (Radix TabsList, toolbars) legitimately
          // hands focus to its active child. That is delegation, not a lost
          // focus or a missing ring, and counting it as a defect overstated
          // this app's focus failures by 10 in the first run.
          delegated:
            document.activeElement !== element && element.contains(document.activeElement),
          delegatedTo:
            document.activeElement !== element && element.contains(document.activeElement)
              ? (document.activeElement.getAttribute('aria-label') ||
                  document.activeElement.textContent ||
                  document.activeElement.tagName)
                  .trim()
                  .replace(/\s+/g, ' ')
                  .slice(0, 40)
              : null,
          focusVisible,
          inViewport,
          unobscured,
          visible,
          transparentOutlineOnly,
          styles,
        };
      });
      evidence.push(result);
      if (result.delegated) {
        // Measured, recorded, and not scored: the child it delegates to is
        // itself in the focusable set and is checked on its own turn.
        continue;
      }
      if (!result.active) failures.push(result.label + ' did not retain keyboard focus.');
      if (!result.visible) {
        failures.push(
          result.label +
            (result.transparentOutlineOnly
              ? ' has only a TRANSPARENT outline when focused (outline-none); any indicator is border-colour only.'
              : ' has no visible keyboard focus indicator.')
        );
      }
      if (!result.unobscured) {
        failures.push(result.label + ' was obscured or outside the viewport when focused.');
      }
    } catch (e) {
      failures.push('focus check threw: ' + String(e).slice(0, 120));
    }
  }
  // Delegating containers are measured but not scored; the denominator is the
  // set of controls that actually own their own focus.
  const scored = evidence.filter((e) => !e.delegated);
  return {
    metrics: {
      checked: scored.length,
      attempted: checked,
      delegated: evidence.length - scored.length,
      visible: scored.filter((e) => e.visible).length,
      transparentOutlineOnly: scored.filter((e) => e.transparentOutlineOnly).length,
      unobscured: scored.filter((e) => e.unobscured).length,
      retainedFocus: scored.filter((e) => e.active).length,
    },
    failures,
    evidence,
  };
}

/* ------------------------------------------------------------ measure one --- */
async function measure(browser, route, vp) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  const url = base + route.url;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await delay(700);
  await defineAppElementFilter(page);

  const axe = await runAxeScan(page);
  const contrast = await runComputedContrastAudit(page);
  const inventory = await focusableInventory(page);
  const walk = await tabWalk(page, Math.min(MAX_TAB_STEPS, inventory.focusableCount + 3));
  const focus = await verifyFocusIndicators(page, MAX_FOCUS_CHECKS);

  await page.close();
  return {
    route: route.url,
    viewport: vp.label,
    viewportPx: vp.w + 'x' + vp.h,
    axe: axe.metrics,
    axeViolations: axe.violations,
    axeBlockingIncomplete: axe.blockingIncomplete,
    contrast: contrast.metrics,
    contrastFailing: contrast.failing,
    keyboard: Object.assign({}, inventory, walk),
    focus: focus.metrics,
    focusFailures: focus.failures,
    pageErrors,
  };
}

/* ------------------------------------------------------------- self-proof --- */
const BAD_MARKUP =
  '<div id="__a11y_selfproof" style="position:relative;z-index:2147483000;background:#ffffff;padding:8px">' +
  '<p id="__sp_contrast" style="color:#bbbbbb;background:#ffffff;font-size:14px;font-weight:400">' +
  'selfproof low contrast sample text</p>' +
  '<button id="__sp_focus" style="outline:none !important;box-shadow:none !important;border:0;' +
  'background:#ffffff;color:#000000">selfproof no focus ring</button>' +
  // The Tailwind `outline-none` shape: present, 2px, solid -- and invisible.
  '<button id="__sp_transparent" style="outline:2px solid transparent !important;' +
  'box-shadow:none !important;border:0;background:#ffffff;color:#000000">' +
  'selfproof transparent outline</button>' +
  '<img id="__sp_img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"' +
  ' style="width:24px;height:24px">' +
  '</div>';

async function selfProof(browser) {
  const vp = viewports[viewports.length - 1];
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  try {
    await page.goto(base + control.url, { waitUntil: 'networkidle', timeout: 60000 });
  } catch {
    await page.goto(base + control.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await delay(600);
  await defineAppElementFilter(page);

  const baselineAxe = await runAxeScan(page);
  const baselineContrast = await runComputedContrastAudit(page);
  const baselineFocus = await verifyFocusIndicators(page, MAX_FOCUS_CHECKS);

  await page.evaluate((html) => {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    document.body.prepend(holder.firstElementChild);
  }, BAD_MARKUP);
  await delay(250);

  const injectedAxe = await runAxeScan(page);
  const injectedContrast = await runComputedContrastAudit(page);
  const injectedFocusRaw = await page.evaluate(() => {
    const el = document.getElementById('__sp_focus');
    el.focus();
    const cs = getComputedStyle(el);
    return {
      active: document.activeElement === el,
      hasOutline: cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0,
      hasShadow: cs.boxShadow !== 'none' && cs.boxShadow !== '',
    };
  });

  // Prove the transparent-outline detector on the injected control before removal.
  const injectedFocusPass = await verifyFocusIndicators(page, MAX_FOCUS_CHECKS);
  const spTransparent = injectedFocusPass.evidence.find((e) =>
    /selfproof transparent outline/.test(e.label)
  );

  await page.evaluate(() => {
    const n = document.getElementById('__a11y_selfproof');
    if (n) n.remove();
  });
  await delay(250);
  const restoredAxe = await runAxeScan(page);
  const restoredContrast = await runComputedContrastAudit(page);
  const restoredFocus = await verifyFocusIndicators(page, MAX_FOCUS_CHECKS);
  await page.close();

  const spContrast = injectedContrast.pairs.find((p) => /selfproof low contrast/.test(p.text));
  const idSet = (r) => new Set(r.violations.map((v) => v.id));
  const baseIds = idSet(baselineAxe);
  const newAxeIds = Array.from(idSet(injectedAxe)).filter((id) => !baseIds.has(id));

  const legs = [
    {
      leg: 'contrast detector flags the injected low-contrast text',
      detected: Boolean(spContrast) && spContrast.pass === false,
      detail: spContrast
        ? 'measured ' + spContrast.ratio + ':1 (required ' + spContrast.required + ') -> pass=' + spContrast.pass
        : 'injected sample was never measured at all',
    },
    {
      leg: 'contrast failing-count rises above baseline',
      detected: injectedContrast.metrics.failed > baselineContrast.metrics.failed,
      detail: 'failed ' + baselineContrast.metrics.failed + ' -> ' + injectedContrast.metrics.failed,
    },
    {
      leg: 'axe reports at least one NEW violation id',
      detected: newAxeIds.length > 0,
      detail:
        'violations ' +
        baselineAxe.metrics.violations +
        ' -> ' +
        injectedAxe.metrics.violations +
        '; new ids: ' +
        (newAxeIds.join(', ') || '(none)'),
    },
    {
      leg: 'focus detector sees the suppressed indicator',
      detected: injectedFocusRaw.active && !injectedFocusRaw.hasOutline && !injectedFocusRaw.hasShadow,
      detail:
        'active=' +
        injectedFocusRaw.active +
        ' outline=' +
        injectedFocusRaw.hasOutline +
        ' shadow=' +
        injectedFocusRaw.hasShadow,
    },
    {
      leg: 'a TRANSPARENT 2px outline is NOT scored as a visible focus ring',
      detected: Boolean(spTransparent) && spTransparent.visible === false && spTransparent.transparentOutlineOnly === true,
      detail: spTransparent
        ? 'visible=' + spTransparent.visible + ' transparentOutlineOnly=' + spTransparent.transparentOutlineOnly +
          ' outlineColor=' + (spTransparent.styles[0] ? spTransparent.styles[0].outlineColor : '?')
        : 'injected transparent-outline control was never measured',
    },
    {
      leg: 'contrast returns to baseline after removal',
      detected: restoredContrast.metrics.failed === baselineContrast.metrics.failed,
      detail:
        injectedContrast.metrics.failed +
        ' -> ' +
        restoredContrast.metrics.failed +
        ' (baseline ' +
        baselineContrast.metrics.failed +
        ')',
    },
    {
      leg: 'axe returns to baseline after removal',
      detected: restoredAxe.metrics.violations === baselineAxe.metrics.violations,
      detail:
        injectedAxe.metrics.violations +
        ' -> ' +
        restoredAxe.metrics.violations +
        ' (baseline ' +
        baselineAxe.metrics.violations +
        ')',
    },
    {
      leg: 'focusable population returns to baseline after removal',
      detected: restoredFocus.metrics.checked === baselineFocus.metrics.checked,
      detail:
        'baseline ' + baselineFocus.metrics.checked + ' -> restored ' + restoredFocus.metrics.checked,
    },
  ];
  return {
    route: control.url,
    viewport: vp.label,
    baseline: {
      axeViolations: baselineAxe.metrics.violations,
      contrastChecked: baselineContrast.metrics.checked,
      contrastFailed: baselineContrast.metrics.failed,
      contrastMinimumRatio: baselineContrast.metrics.minimumRatio,
      focusChecked: baselineFocus.metrics.checked,
    },
    legs,
    alive: legs.every((l) => l.detected),
  };
}

/* ------------------------------------------------------------------ main --- */
async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--disable-extensions'] });
  const started = new Date().toISOString();
  try {
    console.log(
      'base=' + base + '  routes=' + routes.length + '  viewports=' + viewports.map((v) => v.label).join(',')
    );
    console.log('--- self-proof (inject known-bad, then remove; both directions) ---');
    const proof = await selfProof(browser);
    for (const leg of proof.legs) {
      console.log('  ' + (leg.detected ? 'PASS' : 'DEAD') + '  ' + leg.leg + '  [' + leg.detail + ']');
    }
    if (!proof.alive) {
      fs.writeFileSync(path.join(outDir, 'self-proof.json'), JSON.stringify(proof, null, 2));
      console.error(
        '\nPROBE IS DEAD: a detector failed to report an injected known-bad. Refusing to report zeroes.'
      );
      process.exit(2);
    }
    console.log('  probe is alive.\n');
    if (SELF_PROOF_ONLY) {
      fs.writeFileSync(path.join(outDir, 'self-proof.json'), JSON.stringify(proof, null, 2));
      console.log('self-proof record: ' + path.join(outDir, 'self-proof.json'));
      return;
    }

    const results = [];
    for (const route of routes) {
      for (const vp of viewports) {
        const r = await measure(browser, route, vp);
        results.push(r);
        console.log(
          r.route.padEnd(28) +
            ' ' +
            r.viewport.padEnd(8) +
            ' axe=' + r.axe.violations + 'v/' + r.axe.blockingIncomplete + 'bi' +
            ' contrast=' + r.contrast.passed + '/' + r.contrast.checked + ' min=' + r.contrast.minimumRatio +
            ' focus=' + r.focus.visible + '/' + r.focus.checked + 'vis ' +
            r.focus.unobscured + '/' + r.focus.checked + 'unobs' +
            ' tabstops=' + r.keyboard.tabStops +
            ' trap=' + (r.keyboard.keyboardTrap ? 'YES' : 'no')
        );
      }
    }

    const totals = results.reduce(
      (a, r) => ({
        axeViolations: a.axeViolations + r.axe.violations,
        axeBlockingIncomplete: a.axeBlockingIncomplete + r.axe.blockingIncomplete,
        contrastChecked: a.contrastChecked + r.contrast.checked,
        contrastFailed: a.contrastFailed + r.contrast.failed,
        focusChecked: a.focusChecked + r.focus.checked,
        focusVisible: a.focusVisible + r.focus.visible,
        focusUnobscured: a.focusUnobscured + r.focus.unobscured,
        keyboardChecks: a.keyboardChecks + r.keyboard.tabStops,
        traps: a.traps + (r.keyboard.keyboardTrap ? 1 : 0),
      }),
      {
        axeViolations: 0,
        axeBlockingIncomplete: 0,
        contrastChecked: 0,
        contrastFailed: 0,
        focusChecked: 0,
        focusVisible: 0,
        focusUnobscured: 0,
        keyboardChecks: 0,
        traps: 0,
      }
    );
    const mins = results.map((r) => r.contrast.minimumRatio).filter((n) => typeof n === 'number');
    totals.contrastMinimumRatio = mins.length ? Math.min.apply(null, mins) : null;

    const record = { started, finished: new Date().toISOString(), base, selfProof: proof, totals, results };
    const file = path.join(outDir, 'a11y-report.json');
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    console.log('\nTOTALS ' + JSON.stringify(totals, null, 2));
    console.log('\nrecord: ' + file);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('harness error:', e);
  process.exit(2);
});
