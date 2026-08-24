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
 * Two structural repairs, 2026-08-24:
 *
 *  1. It ran on '/' -- the one required surface whose focusable population is
 *     small and static, i.e. the single route where the sample cannot collapse.
 *     A self-test that cannot fail on the thing it guards is worthless. It now
 *     defaults to the first NESTED required surface, and the last leg fails if
 *     the chosen route turns out to be structurally incapable of collapsing.
 *
 *  2. Legs that compared whole-page COUNTS or rule-ID SETS were replaced with
 *     legs that name the injected node. "at least one NEW violation id" is
 *     dead on any surface that already reports the same rule: measured on
 *     /workspace/frontend-revenue it read "violations 4 -> 5; new ids:
 *     image-alt", so the color-contrast half of the injection was already
 *     testing nothing, and on a surface with a pre-existing alt-less image the
 *     leg goes fully dead and the harness refuses to run. The sibling
 *     mission-control harness hit the same trap and solved it by asserting on
 *     the injected selector inside that rule's targets
 *     (tests/e2e/accessibility-contract.spec.ts, controls A and B); the same
 *     approach is used here, plus per-rule NODE COUNTS.
 *
 * The self-proof also carries its own authored control content for the coverage
 * reporter: a sample that provably destroys itself (must read PARTIAL and name
 * the destroyer), an identical stable sample (must read FULL at 100%), and a
 * roving tabindex="-1" destroyer (must be left unfocused, sample intact).
 *
 * Coverage contract (added 2026-08-24)
 * ------------------------------------
 * The focus/keyboard pass used to enumerate a surface's focusable controls,
 * focus them one at a time, and `continue` past anything that failed its
 * usability gate. An unmounted node does not throw when you evaluate against
 * it -- getComputedStyle returns empty strings and getBoundingClientRect
 * returns 0x0 -- so a control that the pass had itself just destroyed left the
 * run silently. Measured on the 2026-08-24 sweep: 206 of 1816 enumerated
 * controls were measured (11.3%), with zero errors and zero failure entries in
 * the report.
 *
 * The dominant cause was the probe focusing controls a Tab user cannot reach.
 * Roving-tabindex widgets park `tabindex="-1"` on their unselected children,
 * and those still match `button` in FOCUSABLE. On an AUTOMATIC-ACTIVATION
 * tablist, focus alone selects the tab: measured on /workspace/frontend-revenue,
 * focusing the role="tab" tabindex="-1" control labelled "Agents" -- focus
 * only, no click -- flipped aria-selected to true and dropped the focusable
 * population from 490 to 19 in a single step, detaching 479 of the 490 handles
 * the pass was holding.
 *
 * Now:
 *   - only Tab-reachable controls (tabIndex >= 0) are focused;
 *   - every enumerated control ends in exactly one NAMED bucket, and
 *     `focusCoverage.unaccounted` must be 0;
 *   - a population drop right after a focus is detected, named, and reported
 *     as `sampleDestroyed` with the control it happened at;
 *   - `status`, `coverage` are the FIRST keys of the report, so no focus number
 *     can be read without the coverage it was measured at;
 *   - the focus budget is wall-clock, not a silent count cap. The old
 *     MCK_A11Y_MAX_FOCUS=40 capped the largest surface at 8% before anything
 *     else went wrong, and nothing in the report said so.
 *
 * Exit codes
 * ----------
 *   0  every surface measured at full coverage
 *   2  the self-proof failed: a detector could not report an injected
 *      known-bad, or the harness itself errored. No report is written.
 *   3  the sweep ran, but at least one surface was measured at PARTIAL
 *      coverage. The report IS written and says so; the exit code exists so a
 *      partial sweep cannot be scripted as a complete one.
 *
 * This sweep is UNENFORCED BY DESIGN and must stay that way: it needs a running
 * server, and a gate that skipped itself when the server was absent would be
 * the same fail-open in a different costume. Exit 3 is information for whoever
 * runs it, not a gate.
 *
 * Usage:
 *   node scripts/probe-surface-a11y.mjs --self-proof   # prove the probe only
 *   node scripts/probe-surface-a11y.mjs                # measure all surfaces
 *   MCK_BASE_URL=http://127.0.0.1:3021 node scripts/probe-surface-a11y.mjs
 *
 * Env knobs:
 *   MCK_A11Y_SELFPROOF_ROUTE   pin the self-proof to a named surface
 *   MCK_A11Y_MAX_FOCUS         focus-check cap (0 = unbounded, the default)
 *   MCK_A11Y_FOCUS_BUDGET_MS   wall-clock budget per surface (default 240000)
 *   MCK_A11Y_FOCUS_ROUNDS      re-enumeration rounds after a destroyed sample
 *   MCK_A11Y_MAX_TABS          tab-walk step cap (default 60)
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
// DEFECT: the self-proof used to be pinned to '/', the one required surface
// whose focusable population is small and static -- so the legs that guard the
// coverage reporter ran on the single route where the failure mode cannot
// occur. Default to a NESTED surface (where dynamic panels and roving tablists
// live) and prove the choice: the last leg fails if the chosen route turns out
// to be structurally incapable of collapsing.
const SELF_PROOF_ROUTE_ENV = process.env.MCK_A11Y_SELFPROOF_ROUTE;
const nestedRoutes = routes.filter((r) => r.url !== '/' && r.url.split('/').length > 2);
const control =
  (SELF_PROOF_ROUTE_ENV && routes.find((r) => r.url === SELF_PROOF_ROUTE_ENV)) ||
  nestedRoutes[0] ||
  routes.find((r) => r.url === '/') ||
  routes[0];
const SELF_PROOF_ROUTE_REASON = SELF_PROOF_ROUTE_ENV
  ? 'MCK_A11Y_SELFPROOF_ROUTE=' + SELF_PROOF_ROUTE_ENV
  : nestedRoutes[0]
    ? 'first nested required surface (a static root cannot exhibit sample collapse)'
    : 'no nested required surface in the manifest -- falling back to the root';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FOCUSABLE =
  'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
// A control is only Tab-reachable if its resolved tabIndex is >= 0. Roving-
// tabindex widgets (Radix TabsList) park tabindex="-1" on their unselected
// children; those still match `button` in FOCUSABLE. Programmatically focusing
// one is not something a Tab user can do, and on an AUTOMATIC-ACTIVATION
// tablist it SELECTS the tab -- which unmounts the panel holding the rest of
// the sample. Measured on /workspace/frontend-revenue: focusing the
// role="tab" aria-selected="false" tabindex="-1" control labelled "Agents"
// (focus only, no click) flipped aria-selected to true and dropped the
// focusable population from 490 to 19 in one step.
const TAB_REACHABLE_NOTE =
  'tabIndex < 0 => reachable by arrow keys inside a roving widget, not by Tab';
// 0 = unbounded. The previous default of 40 capped coverage at 8% of the
// largest surface before any other loss, and nothing in the report said so.
// The pass is bounded by a wall-clock budget instead, and exhausting THAT is
// reported as an explicit coverage shortfall.
const MAX_FOCUS_CHECKS = Number(process.env.MCK_A11Y_MAX_FOCUS || '0');
// Wall-clock bound per surface; 0 = unbounded. These surfaces carry ~1054
// Tab-reachable controls each and the pass measures ~5/s, so a genuinely
// complete sweep is ~35 minutes. The default bounds a routine run and the
// shortfall is REPORTED as budgetExhausted rather than absorbed.
const FOCUS_BUDGET_MS = Number(process.env.MCK_A11Y_FOCUS_BUDGET_MS || '120000');
const POPULATION_SETTLE_MS = Number(process.env.MCK_A11Y_SETTLE_MS || '600');
const POPULATION_SETTLE_TRIES = Number(process.env.MCK_A11Y_SETTLE_TRIES || '8');
const MAX_FOCUS_ROUNDS = Number(process.env.MCK_A11Y_FOCUS_ROUNDS || '3');
// A population drop this large right after a focus is treated as the sample
// destroying itself, and triggers an exact census of what went stale.
const DESTRUCTION_DROP_MIN = 5;
const DESTRUCTION_DROP_FRACTION = 0.2;
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
    // Deliberately generous, matching the sibling harness: the self-proof proves
    // itself by finding its OWN injected selector in this list, so truncating to
    // a handful makes that control pass or fail on node ordering alone.
    targets: f.nodes.flatMap((n) => n.target.map(String)).slice(0, 60),
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
async function focusableInventory(page, selector) {
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
      // The denominator a keyboard-focus audit is actually about.
      tabReachableCount: all.filter((el) => el.tabIndex >= 0).length,
      positiveTabIndexCount: all.filter((el) => Number(el.getAttribute('tabindex')) > 0).length,
    };
  }, selector || FOCUSABLE);
}

/**
 * Waits for the Tab-reachable population to stop moving before it is used as a
 * denominator. Measured on /workspace/assistants: 19 controls at t+700ms and
 * 1054 from t+2s onward, at BOTH viewports, with no further growth after eight
 * scroll-to-bottom passes. Sampling the denominator before that settles is how
 * the original report came to quote `focusableCount: 24` for a surface that
 * actually has 1054 -- which made even its 11.3% coverage an over-statement.
 */
async function settlePopulation(page, selector) {
  let previous = -1;
  let current = await tabReachablePopulation(page, selector);
  for (let i = 0; i < POPULATION_SETTLE_TRIES && current !== previous; i += 1) {
    await delay(POPULATION_SETTLE_MS);
    previous = current;
    current = await tabReachablePopulation(page, selector);
  }
  return { population: current, settled: current === previous };
}

/** Live count only -- cheap enough to call after every single focus. */
async function tabReachablePopulation(page, selector) {
  return await page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll(sel)).filter((el) => {
        if (!window.__isAppEl(el)) return false;
        if (el.tabIndex < 0) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (el.hasAttribute('disabled')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length,
    selector || FOCUSABLE
  );
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
/** In-page focus evidence collector. Hoisted so the coverage-accounting loop
 *  and the self-proof's control content run the IDENTICAL measurement. */
const FOCUS_EVIDENCE = (element) => {
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
          role: element.getAttribute('role'),
          tabIndex: element.tabIndex,
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
      };

/**
 * Ported from component-marketplace verifyFocusIndicator (blob ca4bcbf5).
 *
 * COVERAGE ACCOUNTING (added after the sample was measured collapsing to 11.3%)
 * ---------------------------------------------------------------------------
 * The original loop snapshotted element handles once and, for anything that
 * failed its usability gate, ran a bare `continue`. A handle whose node has
 * been unmounted does not throw: getComputedStyle returns empty strings and
 * getBoundingClientRect returns 0x0, so the gate returns false and the element
 * vanishes from the run with no error and no failure entry. On this app that
 * silently discarded 1600 of 1816 enumerated controls across the sweep and the
 * report still printed a confident row of zeroes.
 *
 * Every enumerated control now ends in exactly one accounted-for bucket, the
 * coverage figure is computed and reported, and a self-destroying sample is
 * detected and named rather than absorbed.
 */
async function verifyFocusIndicators(page, limit, options = {}) {
  const selector = options.selector || FOCUSABLE;
  const rounds = Math.max(1, options.rounds ?? MAX_FOCUS_ROUNDS);
  const budgetMs = options.budgetMs ?? FOCUS_BUDGET_MS;
  const deadline = budgetMs && budgetMs > 0 ? Date.now() + budgetMs : Infinity;
  const cap = limit && limit > 0 ? limit : Infinity;

  // Population at sample time: the honest denominator for this pass. Settled
  // first, because this app's surfaces are still mounting controls for ~2s.
  const settle = await settlePopulation(page, selector);
  const populationAtStart = settle.population;

  const evidence = [];
  const failures = [];
  // Every enumerated node lands in exactly one of these.
  const outcome = {
    measured: 0,
    notTabReachable: 0,
    staleAfterSampleDestroyed: 0,
    hiddenAtCheckTime: 0,
    zeroSizeAtCheckTime: 0,
    disabledAtCheckTime: 0,
    outsideApp: 0,
    threw: 0,
    budgetExhausted: 0,
    capExhausted: 0,
    neverSampled: 0,
  };
  const destructionEvents = [];
  const measuredIds = new Set();
  const initialSampleIds = new Set();
  const seenIds = new Set();
  let checked = 0;
  let population = populationAtStart;
  let stopped = null;

  // Stamps a stable per-node identity and reports why a node is or is not
  // measurable RIGHT NOW. `isConnected` is checked first so an unmounted node
  // is named as unmounted instead of being mistaken for a zero-size control.
  const classify = (el) => {
    if (!el.isConnected) return { state: 'staleAfterSampleDestroyed' };
    if (!window.__isAppEl(el)) return { state: 'outsideApp' };
    if (!el.__a11yId) {
      window.__a11ySeq = (window.__a11ySeq || 0) + 1;
      el.__a11yId = window.__a11ySeq;
    }
    const id = el.__a11yId;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return { state: 'hiddenAtCheckTime', id };
    if (el.hasAttribute('disabled')) return { state: 'disabledAtCheckTime', id };
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return { state: 'zeroSizeAtCheckTime', id };
    // Not reachable by Tab. Focusing it anyway is what destroyed the sample.
    if (el.tabIndex < 0) return { state: 'notTabReachable', id };
    return { state: 'ok', id };
  };

  for (let round = 0; round < rounds; round += 1) {
    if (stopped) break;
    const handles = await page.locator(selector).elementHandles();
    let measuredThisRound = 0;

    for (let i = 0; i < handles.length; i += 1) {
      if (Date.now() > deadline) {
        stopped = 'budget';
        // Everything not yet reached in this round is unmeasured, and says so.
        outcome.budgetExhausted += handles.length - i;
        break;
      }
      if (checked >= cap) {
        stopped = 'cap';
        outcome.capExhausted += handles.length - i;
        break;
      }
      const h = handles[i];
      let verdict;
      try {
        verdict = await h.evaluate(classify);
      } catch (e) {
        // A swallowed error here silently empties the focusable set and makes
        // the whole pass report a reassuring zero. Surface it instead.
        outcome.threw += 1;
        failures.push('focus usability check threw: ' + String(e).slice(0, 160));
        continue;
      }
      if (verdict.id) {
        if (round === 0) initialSampleIds.add(verdict.id);
        // A node already accounted for in an earlier round is not re-counted.
        if (measuredIds.has(verdict.id)) continue;
        if (verdict.state !== 'ok' && seenIds.has(verdict.id)) continue;
        seenIds.add(verdict.id);
      }
      if (verdict.state !== 'ok') {
        outcome[verdict.state] += 1;
        continue;
      }

      checked += 1;
      measuredThisRound += 1;
      let result = null;
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
        result = await h.evaluate(FOCUS_EVIDENCE);
      } catch (e) {
        outcome.threw += 1;
        checked -= 1;
        measuredThisRound -= 1;
        failures.push('focus check threw: ' + String(e).slice(0, 120));
        continue;
      }

      outcome.measured += 1;
      measuredIds.add(verdict.id);
      result.a11yId = verdict.id;
      result.fromInitialSample = initialSampleIds.has(verdict.id);
      evidence.push(result);

      // Did focusing this control just destroy the rest of the sample?
      const after = await tabReachablePopulation(page, selector);
      const drop = population - after;
      if (drop >= DESTRUCTION_DROP_MIN && drop >= population * DESTRUCTION_DROP_FRACTION) {
        // One exact census of what is left, only when a drop is detected.
        let stale = 0;
        for (let j = i + 1; j < handles.length; j += 1) {
          const connected = await handles[j]
            .evaluate((el) => el.isConnected)
            .catch(() => false);
          if (!connected) stale += 1;
        }
        // The measured control is not always the trigger. This pass primes
        // keyboard modality with focus -> Tab -> focus, and that Tab lands on
        // the NEXT tab stop; on an automatic-activation widget, arriving there
        // is enough to switch panels. Name both so the operator is not sent
        // after the wrong control.
        const nextLabel = await handles
          .slice(i + 1)
          .find(Boolean)
          ?.evaluate((el) =>
            (el.getAttribute('aria-label') || el.textContent || el.tagName)
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 50)
          )
          .catch(() => null);
        destructionEvents.push({
          afterFocusing: result.label,
          tag: result.tag,
          role: result.role,
          nextControlInSample: nextLabel || null,
          note:
            'the drop was observed while measuring ' + JSON.stringify(result.label) +
            '; the priming Tab moves focus to the next tab stop, so ' +
            JSON.stringify(nextLabel || '(end of sample)') + ' is an equally likely trigger',
          populationBefore: population,
          populationAfter: after,
          lost: drop,
          handlesLeftInSampleNowStale: stale,
        });
        failures.push(
          'SAMPLE DESTROYED: focusing ' +
            JSON.stringify(result.label) +
            ' dropped the Tab-reachable population from ' +
            population +
            ' to ' +
            after +
            ' and left ' +
            stale +
            ' of the remaining sampled controls unmounted.'
        );
      }
      population = after;

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
    }

    // Re-enumerating only helps if the DOM changed under us; if a full round
    // measured nothing new there is nothing left to recover.
    if (measuredThisRound === 0) break;
    if (destructionEvents.length === 0) break;
  }

  // Delegating containers are measured but not scored; the denominator is the
  // set of controls that actually own their own focus.
  const scored = evidence.filter((e) => !e.delegated);
  const fromInitial = evidence.filter((e) => e.fromInitialSample).length;
  const populationAtEnd = await tabReachablePopulation(page, selector);
  // The largest Tab-reachable population this surface was ever observed to
  // hold during the pass. Taking anything smaller would flatter the coverage.
  const denominator = Math.max(populationAtStart, populationAtEnd, fromInitial);
  const coveragePct = denominator === 0 ? 100 : Math.round((fromInitial / denominator) * 1000) / 10;
  // Reconciliation: population = measured + every named reason for not
  // measuring. `outcome.measured` is excluded because `fromInitial` already
  // carries it, and `notTabReachable` is excluded because the population is
  // defined as Tab-reachable controls and never contained those in the first
  // place. A non-zero value here means a control left the run through a path
  // with no name -- exactly the defect this block exists to make impossible.
  // Controls that existed at some point during the pass but were never part of
  // a sample we walked -- the residue of a population that moved under us.
  outcome.neverSampled = Math.max(
    0,
    denominator -
      fromInitial -
      (outcome.staleAfterSampleDestroyed +
        outcome.hiddenAtCheckTime +
        outcome.zeroSizeAtCheckTime +
        outcome.disabledAtCheckTime +
        outcome.outsideApp +
        outcome.threw +
        outcome.budgetExhausted +
        outcome.capExhausted)
  );
  const unaccounted =
    denominator -
    fromInitial -
    (outcome.neverSampled +
      outcome.staleAfterSampleDestroyed +
      outcome.hiddenAtCheckTime +
      outcome.zeroSizeAtCheckTime +
      outcome.disabledAtCheckTime +
      outcome.outsideApp +
      outcome.threw +
      outcome.budgetExhausted +
      outcome.capExhausted);

  const coverage = {
    // Tab-reachable controls present when the sample was taken.
    population: denominator,
    populationAtStart,
    populationAtEnd,
    populationSettled: settle.settled,
    // Distinct controls FROM THAT POPULATION that were actually focused+scored.
    measuredFromPopulation: fromInitial,
    // Controls measured that only appeared after the sample was destroyed and
    // a new panel mounted. Real work, deliberately NOT laundered into the
    // coverage percentage above.
    measuredAfterRemount: evidence.length - fromInitial,
    coveragePct,
    status: coveragePct >= 99.5 && outcome.staleAfterSampleDestroyed === 0 ? 'full' : 'partial',
    sampleDestroyed: destructionEvents.length > 0,
    destroyedBy: destructionEvents.length ? destructionEvents[0].afterFocusing : null,
    destructionEvents,
    stoppedBy: stopped,
    roundsUsed: destructionEvents.length ? Math.min(rounds, 1 + destructionEvents.length) : 1,
    skipped: outcome,
    unaccounted,
  };

  return {
    metrics: {
      checked: scored.length,
      attempted: checked,
      delegated: evidence.length - scored.length,
      visible: scored.filter((e) => e.visible).length,
      transparentOutlineOnly: scored.filter((e) => e.transparentOutlineOnly).length,
      unobscured: scored.filter((e) => e.unobscured).length,
      retainedFocus: scored.filter((e) => e.active).length,
      coverage,
    },
    coverage,
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
  // Re-taken because this population is NOT stable: on the workspace surfaces
  // it climbs from ~25 to ~490 in the first 1.5s as the board renders. Quoting
  // an inventory from before the focus pass as that pass's denominator would
  // silently mis-state coverage in either direction.
  const inventoryAtFocusPass = await focusableInventory(page);
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
    keyboard: Object.assign({}, inventory, walk, {
      // Both of these are taken BEFORE the population settles, so they read
      // LOWER than focusCoverage.population. Kept for comparison with the
      // pre-2026-08-24 reports, which quoted exactly this too-early number as
      // if it were the surface's control count.
      focusableCountBeforeSettle: inventoryAtFocusPass.focusableCount,
      tabReachableCountBeforeSettle: inventoryAtFocusPass.tabReachableCount,
    }),
    focus: focus.metrics,
    focusCoverage: focus.coverage,
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

/**
 * Authored control content for the coverage reporter. Deterministic and owned
 * by this harness, so the reporter is proven in BOTH directions on every run
 * instead of depending on whichever app surface happens to misbehave today.
 *
 * `destroyer` is emitted FIRST so the focus pass reaches it before the victims
 * it removes -- that is the shape of the real defect: focusing one control
 * unmounts the panel holding the rest of the sample.
 */
async function injectFocusSample(page, spec) {
  return await page.evaluate((s) => {
    const wrap = document.createElement('div');
    wrap.id = s.id;
    wrap.setAttribute(
      'style',
      'position:relative;z-index:2147483000;background:#ffffff;padding:8px'
    );
    const mk = (bid, text, attrs) => {
      const b = document.createElement('button');
      b.id = bid;
      b.textContent = text;
      b.setAttribute(
        'style',
        'display:inline-block;width:120px;height:24px;background:#ffffff;color:#000000;' +
          'border:1px solid #000000;outline:2px solid #0000ff'
      );
      if (attrs) Object.keys(attrs).forEach((k) => b.setAttribute(k, attrs[k]));
      return b;
    };
    const victimBox = document.createElement('div');
    victimBox.id = s.id + '_victims';
    for (let i = 0; i < s.victims; i += 1) {
      victimBox.appendChild(mk(s.id + '_v' + i, 'sample victim ' + i));
    }
    const d = mk(s.id + '_destroyer', 'sample destroyer', s.destroyerAttrs || null);
    if (s.destructive) {
      d.addEventListener('focus', () => {
        const v = document.getElementById(s.id + '_victims');
        if (v) v.remove();
      });
    }
    wrap.appendChild(d);
    wrap.appendChild(victimBox);
    document.body.prepend(wrap);
    return {
      injected: s.victims + 1,
      tabReachable: Array.from(wrap.querySelectorAll('button')).filter((b) => b.tabIndex >= 0)
        .length,
    };
  }, spec);
}

const removeById = (page, id) =>
  page.evaluate((x) => {
    const n = document.getElementById(x);
    if (n) n.remove();
  }, id);

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

  // Is this surface even CAPABLE of the failure mode the coverage reporter
  // guards? A self-proof pinned to a small static route can never observe it.
  const populationEarly = await tabReachablePopulation(page);
  const baselineAxe = await runAxeScan(page);
  const baselineContrast = await runComputedContrastAudit(page);
  const populationLate = await tabReachablePopulation(page);
  const routeShape = await page.evaluate(() => ({
    autoActivationTabs: document.querySelectorAll(
      '[role="tab"][tabindex="-1"],[role="tab"][aria-selected="false"]'
    ).length,
    rovingFocusables: Array.from(
      document.querySelectorAll('a[href],button,input,select,textarea,summary')
    ).filter((el) => el.tabIndex < 0).length,
  }));
  const baselineScoped = await verifyFocusIndicators(page, 0, {
    selector: '#__a11y_selfproof button',
    rounds: 1,
  });

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
  // Scoped to the injected container so this leg measures the CONTROL CONTENT and
  // not whatever the app's own population happens to be doing.
  const injectedFocusPass = await verifyFocusIndicators(page, 0, {
    selector: '#__a11y_selfproof button',
    rounds: 1,
  });
  const spTransparent = injectedFocusPass.evidence.find((e) =>
    /selfproof transparent outline/.test(e.label)
  );

  await removeById(page, '__a11y_selfproof');
  await delay(250);
  const restoredAxe = await runAxeScan(page);
  const restoredContrast = await runComputedContrastAudit(page);
  const restoredScoped = await verifyFocusIndicators(page, 0, {
    selector: '#__a11y_selfproof button',
    rounds: 1,
  });

  /* --- authored control content for the COVERAGE reporter, both directions --- */
  // C1: a sample that provably destroys itself. The destroyer is Tab-reachable,
  //     so the pass really does focus it and really does lose the victims.
  await injectFocusSample(page, {
    id: '__a11y_collapse',
    victims: 12,
    destructive: true,
    destroyerAttrs: { tabindex: '0' },
  });
  await delay(120);
  const collapsePass = await verifyFocusIndicators(page, 0, {
    selector: '#__a11y_collapse button',
    rounds: 2,
  });
  await removeById(page, '__a11y_collapse');

  // C2: the SAME shape and size with nothing destructive about it. If this does
  //     not read 100% then "partial" carries no information.
  await injectFocusSample(page, {
    id: '__a11y_stable',
    victims: 12,
    destructive: false,
    destroyerAttrs: { tabindex: '0' },
  });
  await delay(120);
  const stablePass = await verifyFocusIndicators(page, 0, {
    selector: '#__a11y_stable button',
    rounds: 2,
  });
  await removeById(page, '__a11y_stable');

  // C3: the same destructive control, parked at tabindex="-1" the way a roving
  //     tablist parks its unselected tabs. A Tab user cannot reach it, so the
  //     pass must not focus it, and the sample must survive intact.
  await injectFocusSample(page, {
    id: '__a11y_roving',
    victims: 12,
    destructive: true,
    destroyerAttrs: { tabindex: '-1', role: 'tab', 'aria-selected': 'false' },
  });
  await delay(120);
  const rovingPass = await verifyFocusIndicators(page, 0, {
    selector: '#__a11y_roving button',
    rounds: 2,
  });
  await removeById(page, '__a11y_roving');

  await page.close();

  const spContrast = injectedContrast.pairs.find((p) => /selfproof low contrast/.test(p.text));
  const targetsFor = (scan, rule) =>
    scan.violations.filter((v) => v.id === rule).flatMap((v) => v.targets);
  const nodesFor = (scan, rule) =>
    scan.violations.filter((v) => v.id === rule).reduce((n, v) => n + v.nodeCount, 0);
  const names = (scan, rule, sel) => targetsFor(scan, rule).some((t) => String(t).includes(sel));

  const legs = [
    {
      leg: 'contrast detector flags the injected low-contrast text',
      detected: Boolean(spContrast) && spContrast.pass === false,
      detail: spContrast
        ? 'measured ' + spContrast.ratio + ':1 (required ' + spContrast.required + ') -> pass=' + spContrast.pass
        : 'injected sample was never measured at all',
    },
    {
      // Was a bare count comparison. The app's own failing-pair count is not
      // stable between scans on a dynamic surface (measured 1 -> 3 -> 2 on
      // /workspace/assistants with a single injected pair), so a count-only leg
      // false-alarms. Identify the injected run itself, the way the sibling
      // harness does, and keep the count as detail only.
      leg: 'the injected run is present BY NAME in the failing set',
      detected: injectedContrast.failing.some((f) => /selfproof low contrast/.test(f.text)),
      detail:
        'failed ' + baselineContrast.metrics.failed + ' -> ' + injectedContrast.metrics.failed +
        '; injected run in failing list=' +
        injectedContrast.failing.some((f) => /selfproof low contrast/.test(f.text)),
    },
    {
      // Was: "axe reports at least one NEW violation id". That compares rule-ID
      // SETS, so on any surface that ALREADY reports color-contrast the injected
      // low-contrast text contributes nothing and the leg silently stops testing
      // it; on a surface that already reports image-alt too the leg goes fully
      // dead and the harness refuses to run at all. Measured on
      // /workspace/frontend-revenue: "violations 4 -> 5; new ids: image-alt" --
      // the color-contrast half was already inert.
      // The sibling mission-control harness hit the same trap and solved it by
      // asserting on the INJECTED SELECTOR inside that rule's targets
      // (tests/e2e/accessibility-contract.spec.ts, controls A and B). Same
      // approach here, plus per-rule NODE COUNTS rather than id presence.
      leg: 'axe NAMES each injected node under its own rule (not just a new rule id)',
      detected:
        names(injectedAxe, 'color-contrast', '__sp_contrast') &&
        names(injectedAxe, 'image-alt', '__sp_img') &&
        nodesFor(injectedAxe, 'color-contrast') > nodesFor(baselineAxe, 'color-contrast') &&
        nodesFor(injectedAxe, 'image-alt') > nodesFor(baselineAxe, 'image-alt'),
      detail:
        'color-contrast nodes ' +
        nodesFor(baselineAxe, 'color-contrast') + ' -> ' + nodesFor(injectedAxe, 'color-contrast') +
        ' names #__sp_contrast=' + names(injectedAxe, 'color-contrast', '__sp_contrast') +
        '; image-alt nodes ' +
        nodesFor(baselineAxe, 'image-alt') + ' -> ' + nodesFor(injectedAxe, 'image-alt') +
        ' names #__sp_img=' + names(injectedAxe, 'image-alt', '__sp_img'),
    },
    {
      leg: 'focus detector sees the suppressed indicator',
      detected: injectedFocusRaw.active && !injectedFocusRaw.hasOutline && !injectedFocusRaw.hasShadow,
      detail:
        'active=' + injectedFocusRaw.active +
        ' outline=' + injectedFocusRaw.hasOutline +
        ' shadow=' + injectedFocusRaw.hasShadow,
    },
    {
      leg: 'a TRANSPARENT 2px outline is NOT scored as a visible focus ring',
      detected:
        Boolean(spTransparent) &&
        spTransparent.visible === false &&
        spTransparent.transparentOutlineOnly === true,
      detail: spTransparent
        ? 'visible=' + spTransparent.visible + ' transparentOutlineOnly=' + spTransparent.transparentOutlineOnly +
          ' outlineColor=' + (spTransparent.styles[0] ? spTransparent.styles[0].outlineColor : '?')
        : 'injected transparent-outline control was never measured',
    },
    {
      // Same reason as the leg above: assert the injected run is GONE by name.
      // Comparing whole-page failed counts read "3 -> 2 (baseline 1)" on a
      // surface whose own content changed mid-proof, and killed a healthy run.
      leg: 'the injected run is GONE BY NAME after removal',
      detected:
        !restoredContrast.pairs.some((f) => /selfproof low contrast/.test(f.text)) &&
        !restoredContrast.failing.some((f) => /selfproof low contrast/.test(f.text)),
      detail:
        'failed ' + injectedContrast.metrics.failed + ' -> ' + restoredContrast.metrics.failed +
        ' (baseline ' + baselineContrast.metrics.failed +
        '); injected run still present=' +
        restoredContrast.pairs.some((f) => /selfproof low contrast/.test(f.text)),
    },
    {
      // Per-rule node counts, and the injected selectors must be GONE by name.
      leg: 'axe returns to baseline after removal (per-rule node counts, by name)',
      detected:
        nodesFor(restoredAxe, 'color-contrast') === nodesFor(baselineAxe, 'color-contrast') &&
        nodesFor(restoredAxe, 'image-alt') === nodesFor(baselineAxe, 'image-alt') &&
        !names(restoredAxe, 'color-contrast', '__sp_contrast') &&
        !names(restoredAxe, 'image-alt', '__sp_img'),
      detail:
        'color-contrast nodes ' + nodesFor(injectedAxe, 'color-contrast') + ' -> ' +
        nodesFor(restoredAxe, 'color-contrast') + ' (baseline ' + nodesFor(baselineAxe, 'color-contrast') + ')' +
        '; image-alt nodes ' + nodesFor(injectedAxe, 'image-alt') + ' -> ' +
        nodesFor(restoredAxe, 'image-alt') + ' (baseline ' + nodesFor(baselineAxe, 'image-alt') + ')',
    },
    {
      // Was: "focusable population returns to baseline after removal", comparing
      // focus.checked over the WHOLE page. That number is unstable on any dynamic
      // surface -- it read "baseline 7 -> restored 9" on /workspace/frontend-revenue
      // and killed the run for a defect that was not there. Scoped to the harness's
      // own injected container, where the expected values are 2 and 0 exactly.
      leg: 'the injected controls are measured while present and absent after removal',
      detected:
        baselineScoped.coverage.population === 0 &&
        injectedFocusPass.coverage.measuredFromPopulation === 2 &&
        restoredScoped.coverage.population === 0 &&
        restoredScoped.coverage.measuredFromPopulation === 0,
      detail:
        'before ' + baselineScoped.coverage.population +
        ' -> present ' + injectedFocusPass.coverage.measuredFromPopulation +
        '/' + injectedFocusPass.coverage.population +
        ' -> after removal ' + restoredScoped.coverage.measuredFromPopulation +
        '/' + restoredScoped.coverage.population,
    },
    {
      leg: 'COVERAGE: a self-destroying sample is reported as PARTIAL and named',
      detected:
        collapsePass.coverage.status === 'partial' &&
        collapsePass.coverage.sampleDestroyed === true &&
        collapsePass.coverage.skipped.staleAfterSampleDestroyed >= 10 &&
        /destroyer/.test(String(collapsePass.coverage.destroyedBy)) &&
        collapsePass.coverage.coveragePct < 20,
      detail:
        'status=' + collapsePass.coverage.status +
        ' coverage=' + collapsePass.coverage.coveragePct + '%' +
        ' measured=' + collapsePass.coverage.measuredFromPopulation +
        '/' + collapsePass.coverage.population +
        ' stale=' + collapsePass.coverage.skipped.staleAfterSampleDestroyed +
        ' destroyedBy=' + JSON.stringify(collapsePass.coverage.destroyedBy) +
        ' unaccounted=' + collapsePass.coverage.unaccounted,
    },
    {
      leg: 'COVERAGE: an identical STABLE sample is reported as FULL at 100%',
      detected:
        stablePass.coverage.status === 'full' &&
        stablePass.coverage.sampleDestroyed === false &&
        stablePass.coverage.coveragePct === 100 &&
        stablePass.coverage.measuredFromPopulation === 13 &&
        stablePass.coverage.unaccounted === 0,
      detail:
        'status=' + stablePass.coverage.status +
        ' coverage=' + stablePass.coverage.coveragePct + '%' +
        ' measured=' + stablePass.coverage.measuredFromPopulation +
        '/' + stablePass.coverage.population +
        ' unaccounted=' + stablePass.coverage.unaccounted,
    },
    {
      leg: 'ROOT CAUSE: a tabindex="-1" roving control is not focused, sample survives',
      detected:
        rovingPass.coverage.status === 'full' &&
        rovingPass.coverage.sampleDestroyed === false &&
        rovingPass.coverage.skipped.notTabReachable >= 1 &&
        rovingPass.coverage.measuredFromPopulation === 12 &&
        rovingPass.coverage.population === 12,
      detail:
        'status=' + rovingPass.coverage.status +
        ' measured=' + rovingPass.coverage.measuredFromPopulation +
        '/' + rovingPass.coverage.population +
        ' notTabReachable=' + rovingPass.coverage.skipped.notTabReachable +
        ' sampleDestroyed=' + rovingPass.coverage.sampleDestroyed,
    },
    {
      // The leg that closes the structural blindness: if the self-proof is
      // pinned to a small static surface, the app-facing legs above can never
      // observe the failure mode and this one says so out loud.
      leg: 'the self-proof route is CAPABLE of exhibiting sample collapse',
      detected:
        populationLate !== populationEarly ||
        routeShape.autoActivationTabs > 0 ||
        routeShape.rovingFocusables > 0,
      detail:
        'route=' + control.url +
        ' population ' + populationEarly + ' -> ' + populationLate +
        ' autoActivationTabs=' + routeShape.autoActivationTabs +
        ' rovingFocusables=' + routeShape.rovingFocusables +
        (populationLate !== populationEarly || routeShape.autoActivationTabs > 0 || routeShape.rovingFocusables > 0
          ? ''
          : ' -- STATIC surface: this self-proof cannot observe the defect it guards.'),
    },
  ];
  return {
    route: control.url,
    routeSelection: SELF_PROOF_ROUTE_REASON,
    viewport: vp.label,
    routeShape: Object.assign({ populationEarly, populationLate }, routeShape),
    baseline: {
      axeViolations: baselineAxe.metrics.violations,
      contrastChecked: baselineContrast.metrics.checked,
      contrastFailed: baselineContrast.metrics.failed,
      contrastMinimumRatio: baselineContrast.metrics.minimumRatio,
      tabReachablePopulation: populationLate,
    },
    coverageControls: {
      selfDestroying: collapsePass.coverage,
      stable: stablePass.coverage,
      rovingTabindex: rovingPass.coverage,
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
            ' COVERAGE=' + r.focusCoverage.coveragePct + '% (' +
            r.focusCoverage.measuredFromPopulation + '/' + r.focusCoverage.population + ' ' +
            r.focusCoverage.status.toUpperCase() + ')' +
            (r.focusCoverage.sampleDestroyed
              ? ' SAMPLE-DESTROYED-BY=' + JSON.stringify(r.focusCoverage.destroyedBy)
              : '') +
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
        // The numbers that make the focus evidence readable AS evidence.
        focusPopulation: a.focusPopulation + r.focusCoverage.population,
        focusMeasured: a.focusMeasured + r.focusCoverage.measuredFromPopulation,
        focusableBeforeSettle: a.focusableBeforeSettle + r.keyboard.focusableCountBeforeSettle,
        rovingNotAudited: a.rovingNotAudited + r.focusCoverage.skipped.notTabReachable,
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
        focusPopulation: 0,
        focusMeasured: 0,
        focusableBeforeSettle: 0,
        rovingNotAudited: 0,
      }
    );
    const mins = results.map((r) => r.contrast.minimumRatio).filter((n) => typeof n === 'number');
    totals.contrastMinimumRatio = mins.length ? Math.min.apply(null, mins) : null;

    totals.focusCoveragePct =
      totals.focusPopulation === 0
        ? 100
        : Math.round((totals.focusMeasured / totals.focusPopulation) * 1000) / 10;

    const partial = results.filter((r) => r.focusCoverage.status !== 'full');
    const destroyed = results.filter((r) => r.focusCoverage.sampleDestroyed);
    const coverage = {
      // What the focus/keyboard evidence below actually covers. Read this
      // BEFORE reading any focus number in this file.
      focusPopulation: totals.focusPopulation,
      focusMeasured: totals.focusMeasured,
      focusCoveragePct: totals.focusCoveragePct,
      surfacesTotal: results.length,
      surfacesPartial: partial.length,
      surfacesWithDestroyedSample: destroyed.length,
      // Roving-tabindex children (tabindex="-1") are enumerated but deliberately
      // NOT focused: a Tab user cannot reach them, and focusing one is what
      // destroyed the sample. They are reachable by arrow key inside their
      // widget, so their focus rings are genuinely unaudited here. Stated, not
      // hidden -- see the follow-up issue referenced in the baseline doc.
      rovingEnumeratedNotAudited: totals.rovingNotAudited,
      partialSurfaces: partial.map((r) => ({
        route: r.route,
        viewport: r.viewport,
        coveragePct: r.focusCoverage.coveragePct,
        measured: r.focusCoverage.measuredFromPopulation,
        population: r.focusCoverage.population,
        destroyedBy: r.focusCoverage.destroyedBy,
        skipped: r.focusCoverage.skipped,
      })),
    };
    const status = partial.length === 0 ? 'complete' : 'partial';

    const record = {
      // First keys in the file on purpose: a reader cannot reach a focus number
      // without passing the coverage that number was measured at.
      status,
      coverage,
      started,
      finished: new Date().toISOString(),
      base,
      selfProof: proof,
      totals,
      results,
    };
    const file = path.join(outDir, 'a11y-report.json');
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    console.log('\nTOTALS ' + JSON.stringify(totals, null, 2));
    console.log('\nrecord: ' + file);

    const rule = '='.repeat(78);
    const banner =
      '\n' + rule + '\n' +
      'FOCUS/KEYBOARD COVERAGE: ' + totals.focusMeasured + ' of ' + totals.focusPopulation +
      ' Tab-reachable controls measured (' + totals.focusCoveragePct + '%)' + '\n' +
      'status=' + status + '   partial surfaces: ' + partial.length + '/' + results.length +
      '   samples destroyed while measuring: ' + destroyed.length + '\n' +
      rule;
    if (status === 'partial') {
      console.error(banner);
      for (const r of partial) {
        console.error(
          '  PARTIAL ' + (r.route + ' ' + r.viewport).padEnd(34) +
            r.focusCoverage.measuredFromPopulation + '/' + r.focusCoverage.population +
            ' (' + r.focusCoverage.coveragePct + '%)' +
            (r.focusCoverage.destroyedBy
              ? '  sample destroyed by ' + JSON.stringify(r.focusCoverage.destroyedBy)
              : '  ' + JSON.stringify(r.focusCoverage.skipped))
        );
      }
      console.error(
        '\nThe focus numbers above describe ONLY the measured fraction. Exiting 3 so a' + '\n' +
          'partial sweep cannot be read, or scripted, as a complete one.' + '\n'
      );
      process.exitCode = 3;
    } else {
      console.log(banner);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('harness error:', e);
  process.exit(2);
});
