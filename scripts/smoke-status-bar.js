const path = require('node:path');

// A workspace that auto-refreshes from a GitHub Project, so the page runs the sync the stubs answer.
const PROJECT_SLUG = 'memsys';

const RECONCILIATION_ONLY = {
  imported: 0,
  updated: 4,
  moved: 0,
  status_reconciled: 2,
  upstream_drift_warnings: 0,
  details: [
    { action: 'status_reconcile', issue: 'iMelki/memsys#201', reason: 'Moved local status from In progress to Done to match GitHub.' },
    { action: 'status_reconcile', issue: 'iMelki/memsys#188', reason: 'Moved local status from Review to Done to match GitHub.' },
  ],
};

const MIXED = {
  imported: 0,
  updated: 4,
  moved: 0,
  status_reconciled: 2,
  upstream_drift_warnings: 1,
  details: [
    ...RECONCILIATION_ONLY.details,
    { action: 'drift', issue: 'iMelki/memsys#199', reason: 'Local task is Done while GitHub Project Status is In progress.' },
  ],
};

const LONG_TITLE = 'Quarterly planning and cross-team delivery tracker for the platform reliability programme and its follow-up work';

async function openDrawerWith(browser, baseUrl, syncPayload) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.route(`**/api/workspaces/${PROJECT_SLUG}/github-sync`, (route) => route.fulfill({ json: syncPayload }));
    await page.goto(`${baseUrl}/workspace/${PROJECT_SLUG}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const bar = page.locator('[data-workspace-status-bar]');
    await bar.waitFor({ timeout: 20_000 });
    // Both the mobile and the desktop chip are in the DOM; only the visible one proves the sync landed.
    await bar.locator('button:visible', { hasText: /Synced/ }).first().waitFor({ timeout: 20_000 });
    await bar.getByRole('button', { name: /^Details/ }).click();
    const notes = page.locator('#workspace-status-notes');
    await notes.waitFor({ timeout: 10_000 });
    return { page, text: await notes.innerText() };
  } catch (error) {
    await page.close();
    throw error;
  }
}

function assertMatches(label, text, pattern, expected) {
  if (pattern.test(text) !== expected) {
    throw new Error(`status drawer (${label}): expected ${pattern} ${expected ? 'to match' : 'not to match'}:\n${text}`);
  }
}

async function assertLongTitleStaysInsideBar(browser, baseUrl, artifactDir) {
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  try {
    await page.route(`**/api/workspaces/${PROJECT_SLUG}/github-sync`, (route) => route.fulfill({ json: { ...RECONCILIATION_ONLY, details: [] } }));
    // Settled diagnostics render the Check button, the widest trailing control in the chip row.
    await page.route('**/api/github/diagnostics', (route) => route.fulfill({ json: { status: 'limited', message: 'smoke diagnostics' } }));
    await page.route(new RegExp(`/api/workspaces/${PROJECT_SLUG}(\\?.*)?$`), async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      const workspace = body && body.workspace ? body.workspace : body;
      workspace.github_project_title = LONG_TITLE;
      return route.fulfill({ response, json: body });
    });
    await page.goto(`${baseUrl}/workspace/${PROJECT_SLUG}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const bar = page.locator('[data-workspace-status-bar]');
    await bar.waitFor({ timeout: 20_000 });
    await bar.getByText(/Quarterly planning/).waitFor({ timeout: 20_000 });
    await bar.getByRole('button', { name: /^Details/ }).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(artifactDir, 'status-bar-768-long-title.png') });

    const geometry = await page.evaluate(() => {
      const barRect = document.querySelector('[data-workspace-status-bar]').getBoundingClientRect();
      const barEl = document.querySelector('[data-workspace-status-bar]');
      // A chip scrolled out of the horizontally scrolling chip row is clipped by that row, not painted outside the bar.
      const clippedInsideBar = (button) => {
        for (let el = button.parentElement; el && el !== barEl; el = el.parentElement) {
          if (getComputedStyle(el).overflowX === 'visible') continue;
          const rect = el.getBoundingClientRect();
          return rect.left >= barRect.left - 1 && rect.right <= barRect.right + 1;
        }
        return false;
      };
      const buttons = Array.from(barEl.querySelectorAll('button'))
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return { name: button.getAttribute('aria-label') || button.textContent.trim(), left: rect.left, right: rect.right, clipped: clippedInsideBar(button) };
        });
      return { barLeft: barRect.left, barRight: barRect.right, buttons };
    });
    for (const button of geometry.buttons) {
      if (button.clipped) continue;
      if (button.left < geometry.barLeft - 1 || button.right > geometry.barRight + 1) {
        throw new Error(`status bar at 768px: "${button.name}" sits outside the bar with a long Project title: ${JSON.stringify(geometry)}`);
      }
    }
    const names = geometry.buttons.map((button) => button.name);
    if (!names.some((name) => /^Details/.test(name)) || !names.some((name) => /Sync workspace now/.test(name))) {
      throw new Error(`status bar at 768px lost Details or Sync now with a long Project title: ${JSON.stringify(geometry)}`);
    }
  } finally {
    await page.close();
  }
}

/** Drives the real status bar and drawer: sync payload -> chips -> drawer text, then the narrow-bar geometry. */
async function assertStatusBar(browser, baseUrl, artifactDir) {
  const base = baseUrl.replace(/\/$/, '');

  const reconciliation = await openDrawerWith(browser, base, RECONCILIATION_ONLY);
  try {
    assertMatches('reconciliation only', reconciliation.text, /MCK moved 2 cards to match GitHub\. Nothing to resolve\./, true);
    assertMatches('reconciliation only', reconciliation.text, /disagree/, false);
  } finally {
    await reconciliation.page.close();
  }

  const mixed = await openDrawerWith(browser, base, MIXED);
  try {
    assertMatches('mixed', mixed.text, /GitHub and MCK disagree on 1 item\./, true);
    assertMatches('mixed', mixed.text, /MCK moved 2 cards to match GitHub/, true);
    assertMatches('mixed', mixed.text, /still lists this issue as open/, true);
  } finally {
    await mixed.page.close();
  }

  await assertLongTitleStaysInsideBar(browser, base, artifactDir);
}

module.exports = { assertStatusBar };
