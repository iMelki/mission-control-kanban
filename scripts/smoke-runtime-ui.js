const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const {
  verifyRuntimeSmokeCleanup,
  writeRuntimeSmokeCleanupReceipt,
} = require('./runtime-smoke-cleanup');

const baseUrl = process.env.MCK_SMOKE_URL || 'http://127.0.0.1:3021';
const workspaceSlug = process.env.MCK_SMOKE_WORKSPACE || 'default';
const workspaceUrl = `${baseUrl.replace(/\/$/, '')}/workspace/${workspaceSlug}`;
const artifactDir = process.env.MCK_SMOKE_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'runtime-ui-smoke', String(Date.now()));

async function waitForWorkspaceReady(page) {
  const readyShell = page.locator('[data-workspace-ready="true"]');
  const workspaceNav = page.locator('nav[aria-label="Workspace sections"]');
  const settingsTab = workspaceNav.getByRole('tab', { name: /^Settings$/i });
  try {
    await readyShell.waitFor({ timeout: 20_000 });
    await workspaceNav.waitFor({ timeout: 10_000 });
    await settingsTab.waitFor({ timeout: 20_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      url: window.location.href,
      readyState: document.querySelector('[data-workspace-ready]')?.getAttribute('data-workspace-ready') || null,
      navHtml: document.querySelector('nav[aria-label="Workspace sections"]')?.outerHTML.slice(0, 4_000) || null,
      settings: (() => {
        const button = Array.from(document.querySelectorAll('nav[aria-label="Workspace sections"] button'))
          .find((candidate) => candidate.textContent?.trim() === 'Settings');
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        return {
          outerHtml: button.outerHTML,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
        };
      })(),
    })).catch(() => ({ url: page.url(), readyState: null, navHtml: null }));
    console.error(`Workspace shell readiness diagnostics: ${JSON.stringify(diagnostics)}`);
    throw error;
  }
}

async function requestJson(path, init) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init && init.headers ? init.headers : {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init?.method || 'GET'} ${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function assertJsonEndpoint(path) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`);
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  await response.json();
}

async function main() {
  const stamp = Date.now();
  let agent;
  let task;
  let blockerTask;
  let checklistTask;
  let browser;
  let primaryError;
  let browserCloseError;
  let cleanupReceipt;
  let cleanupReceiptPath;
  let cleanupReceiptWriteError;
  try {
    agent = await requestJson('/api/agents', {
      method: 'POST',
      body: JSON.stringify({
        name: `Runtime Smoke ${stamp}`,
        role: 'Webhook Smoke Agent',
        description: 'Temporary smoke-test agent for runtime UI verification.',
        avatar_emoji: '🧪',
        workspace_id: workspaceSlug,
        runtime_type: 'webhook',
        runtime_config: {
          webhook_url: 'https://example.test/mck-runtime-smoke',
          bearer_token_env: 'MCK_SMOKE_TOKEN',
        },
        dispatch_enabled: true,
      }),
    });

    task = await requestJson('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: `Runtime UI smoke ${stamp}`,
        description: 'Temporary task for runtime badge and handoff copy UI smoke coverage.',
        priority: 'normal',
        status: 'inbox',
        workspace_id: workspaceSlug,
        assigned_agent_id: agent.id,
        dispatch_metadata: {
          target_repo: 'iMelki/mission-control-kanban',
          project_workstream: 'runtime smoke',
          allowed_file_scope: ['src/components/**'],
          acceptance_criteria: ['Runtime badge is visible'],
          test_requirements: ['browser smoke'],
          risk_level: 'low',
          readiness: 'ready_for_agent',
          review_mode: 'human_required',
          impact: 'local smoke only',
          rollback_plan: 'delete smoke task and agent',
          safety_rules: ['do not dispatch externally'],
        },
      }),
    });

    blockerTask = await requestJson('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: `Runtime UI blocker ${stamp}`,
        description: 'Temporary blocker task for dependency graph smoke coverage.',
        priority: 'normal',
        status: 'in_progress',
        workspace_id: workspaceSlug,
      }),
    });

    await requestJson(`/api/tasks/${task.id}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ blocked_by_task_id: blockerTask.id, note: 'Smoke dependency edge' }),
    });

    checklistTask = await requestJson('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: `Runtime checklist smoke ${stamp}`,
        description: 'Temporary sparse task for ready checklist smoke coverage.',
        priority: 'normal',
        status: 'inbox',
        workspace_id: workspaceSlug,
      }),
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    const isIgnorableConsoleNoise = (text) => (
      /Failed to load sub-agent count: TypeError: Failed to fetch/.test(text)
      || /Failed to load OpenClaw session .* TypeError: Failed to fetch/.test(text)
      || /Failed to load n8n sync status: TypeError: Failed to fetch/.test(text)
      || /Failed to load workspace: TypeError: Failed to fetch/.test(text)
      || /Failed to load data: TypeError: Failed to fetch/.test(text)
      // Local smoke often runs without OpenClaw Gateway; Chromium reports the expected
      // /api/openclaw/sessions 503 as a generic resource load error without the URL.
      || /Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)/.test(text)
      || (/hydration-mismatch/.test(text) && /caret-color/.test(text))
    );
    page.on('console', (message) => {
      if (message.type() === 'error' && !isIgnorableConsoleNoise(message.text())) {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    fs.mkdirSync(artifactDir, { recursive: true });
    await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.getByText(/Mission Queue/i).waitFor({ timeout: 10_000 });
    await waitForWorkspaceReady(page);
    const workspaceNav = page.locator('nav[aria-label="Workspace sections"]');
    await workspaceNav.waitFor({ timeout: 20_000 });
    const workspaceSettingsTab = workspaceNav.getByRole('tab', { name: /^Settings$/i });
    await workspaceSettingsTab.waitFor({ timeout: 20_000 });
    await workspaceSettingsTab.click({ force: true });
    await page.getByRole('heading', { name: /Workspace runtime defaults/i }).waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(artifactDir, 'desktop-runtime-workspace.png'), fullPage: true });

    await page.goto(`${baseUrl.replace(/\/$/, '')}/settings`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText(/Runtime operations/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Webhook templates & callback cleanup/i).waitFor({ timeout: 10_000 });
    await assertJsonEndpoint('/api/schemas/webhook-dispatch-payload');
    await assertJsonEndpoint('/api/schemas/webhook-callback-completion');
    await assertJsonEndpoint('/api/runtime/regression');
    await page.screenshot({ path: path.join(artifactDir, 'settings-runtime-ops.png'), fullPage: true });

    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (error) {
      if (!/ERR_ABORTED/.test(String(error))) throw error;
    }
    await page.getByText(/Runtime Regression/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Workspace surfaces and health/i).waitFor({ timeout: 10_000 });

    await page.goto(`${baseUrl.replace(/\/$/, '')}/runtime-regression`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('heading', { name: /Runtime Regression Evidence/i }).waitFor({ timeout: 10_000 });
    await page.getByText(/Local command/i).waitFor({ timeout: 10_000 });

    await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.getByText(/Mission Queue/i).waitFor({ timeout: 10_000 });
    await workspaceNav.getByRole('tab', { name: /^Board$/i }).click();
    await page.getByText(/Mission Queue/i).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: /Add agent/i }).click({ force: true });
    await page.getByText(/Runtime & dispatch/i).waitFor({ timeout: 20_000 });
    await page.getByLabel(/Runtime type/i).waitFor({ timeout: 20_000 });
    await page.getByLabel(/Runtime type/i).selectOption('webhook');
    await page.getByText(/Enable auto-dispatch/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Webhook validation wizard/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Validate endpoint\/env\/secret settings/i).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /Validate endpoint/i }).waitFor({ timeout: 10_000 });
    const autoDispatchCheckbox = page.getByLabel(/Enable auto-dispatch/i);
    if (!(await autoDispatchCheckbox.isDisabled())) {
      throw new Error('Webhook auto-dispatch should be disabled before validation');
    }
    await page.getByText(/^Runtime config JSON$/i).waitFor({ timeout: 10_000 });
    await page.locator('div.fixed.inset-0 button').first().click();
    await page.getByLabel(/Runtime type/i).waitFor({ state: 'hidden', timeout: 10_000 });

    const taskCard = page.locator('li > [role="button"]').filter({ hasText: task.title });
    await taskCard.waitFor({ timeout: 10_000 });
    await taskCard.getByText(/Webhook auto/i).waitFor({ timeout: 10_000 });
    await taskCard.getByText(/Blocked by 1/i).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Webhook$/i }).click();
    await page.getByText(/Showing/i).waitFor({ timeout: 10_000 });
    await taskCard.click();
    await page.getByRole('button', { name: /Copy handoff/i }).waitFor({ timeout: 10_000 });
    await page.getByText(/Dispatch timeline/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Task dependencies \/ blocked-by/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Dependency graph/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Smoke dependency edge/i).first().waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /Retry webhook/i }).waitFor({ timeout: 10_000 });
    await page.locator('div.fixed.inset-0 button').first().click();
    await page.getByRole('button', { name: /All runtimes/i }).click();

    const checklistCard = page.locator('li > [role="button"]').filter({ hasText: checklistTask.title });
    await checklistCard.waitFor({ timeout: 10_000 });
    await checklistCard.click();
    await page.getByRole('button', { name: /Apply ready-for-agent checklist/i }).click();
    await page.locator('select[id$="-readiness"]').evaluate((element) => {
      if (element.value !== 'ready_for_agent') throw new Error(`Expected ready_for_agent, got ${element.value}`);
    });
    await page.getByText(/Operator can verify/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Run relevant automated tests/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Preserve unrelated dirty work/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Revert the scoped commit/i).waitFor({ timeout: 10_000 });
    await page.locator('div.fixed.inset-0 button').first().click();

    const responsiveChecks = [
      { name: 'tablet', width: 900, height: 1100 },
      { name: 'mobile', width: 390, height: 844 },
    ];
    for (const viewport of responsiveChecks) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1500);
      await page.getByText(/Mission Queue/i).waitFor({ timeout: 10_000 });
      await page.getByText(/Runtime filter/i).waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: /New Task/i }).waitFor({ timeout: 10_000 });
      await page.screenshot({ path: path.join(artifactDir, `${viewport.name}-runtime-workspace.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      if (overflow) {
        throw new Error(`${viewport.name} viewport has document-level horizontal overflow`);
      }
    }

    if (consoleErrors.length) {
      throw new Error(`Browser console errors: ${consoleErrors.join('\n')}`);
    }

    console.log(JSON.stringify({
      ok: true,
      workspaceUrl,
      agent_id: agent.id,
      task_id: task.id,
      artifact_dir: artifactDir,
      screenshots: [
        path.join(artifactDir, 'desktop-runtime-workspace.png'),
        path.join(artifactDir, 'settings-runtime-ops.png'),
        path.join(artifactDir, 'tablet-runtime-workspace.png'),
        path.join(artifactDir, 'mobile-runtime-workspace.png'),
      ],
      checks: [
        'agent modal runtime selector',
        'dispatch-enabled control',
        'runtime config field',
        'task-card runtime badge',
        'runtime filter chips',
        'task-modal copy handoff action',
        'task dependency graph and blocked-by badge',
        'ready-for-agent checklist seeding',
        'webhook validation wizard disabled gate',
        'dispatch timeline retry control',
        'settings runtime operations retention and callback panel',
        'webhook dispatch/callback schema endpoints',
        'tablet responsive shell',
        'mobile responsive shell',
        'no browser console errors',
      ],
    }, null, 2));
  } catch (error) {
    primaryError = error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        browserCloseError = error;
      }
    }

    const entities = [
      task && { kind: 'task', role: 'primary', id: task.id, path: `/api/tasks/${task.id}` },
      blockerTask && { kind: 'task', role: 'blocker', id: blockerTask.id, path: `/api/tasks/${blockerTask.id}` },
      checklistTask && { kind: 'task', role: 'checklist', id: checklistTask.id, path: `/api/tasks/${checklistTask.id}` },
      agent && { kind: 'agent', role: 'runtime', id: agent.id, path: `/api/agents/${agent.id}` },
    ].filter(Boolean);

    cleanupReceipt = await verifyRuntimeSmokeCleanup({ baseUrl, entities });
    try {
      cleanupReceiptPath = writeRuntimeSmokeCleanupReceipt({ artifactDir, receipt: cleanupReceipt });
    } catch (error) {
      cleanupReceiptWriteError = error;
    }

    console.log(`RUNTIME_SMOKE_CLEANUP_RECEIPT ${JSON.stringify({
      ...cleanupReceipt,
      artifact_path: cleanupReceiptPath || null,
    })}`);
  }

  const failures = [primaryError, browserCloseError, cleanupReceiptWriteError].filter(Boolean);
  if (cleanupReceipt && !cleanupReceipt.ok) {
    failures.push(new Error('Runtime smoke cleanup did not prove every temporary entity absent'));
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Runtime UI smoke and cleanup reported multiple failures');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
