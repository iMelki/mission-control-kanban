const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.MCK_SMOKE_URL || 'http://127.0.0.1:3021';
const workspaceSlug = process.env.MCK_SMOKE_WORKSPACE || 'default';
const workspaceUrl = `${baseUrl.replace(/\/$/, '')}/workspace/${workspaceSlug}`;
const artifactDir = process.env.MCK_SMOKE_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'runtime-ui-smoke', String(Date.now()));

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
  const agent = await requestJson('/api/agents', {
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

  const task = await requestJson('/api/tasks', {
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

  let browser;
  try {
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
    );
    page.on('console', (message) => {
      if (message.type() === 'error' && !isIgnorableConsoleNoise(message.text())) {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    fs.mkdirSync(artifactDir, { recursive: true });
    await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText(/Mission Queue/i).waitFor({ timeout: 10_000 });
    await page.locator('nav[aria-label="Workspace sections"] button').filter({ hasText: 'Settings' }).click();
    await page.getByText(/Workspace runtime defaults/i).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(artifactDir, 'desktop-runtime-workspace.png'), fullPage: true });

    await page.goto(`${baseUrl.replace(/\/$/, '')}/settings`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText(/Runtime operations/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Webhook templates & callback cleanup/i).waitFor({ timeout: 10_000 });
    await assertJsonEndpoint('/api/schemas/webhook-dispatch-payload');
    await assertJsonEndpoint('/api/schemas/webhook-callback-completion');
    await assertJsonEndpoint('/api/runtime/regression');
    await page.screenshot({ path: path.join(artifactDir, 'settings-runtime-ops.png'), fullPage: true });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText(/Runtime Regression/i).waitFor({ timeout: 10_000 });
    await page.getByText(/Workspace surfaces and health/i).waitFor({ timeout: 10_000 });

    await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText(/Mission Queue/i).waitFor({ timeout: 10_000 });
    await page.locator('nav[aria-label="Workspace sections"] button').filter({ hasText: 'Board' }).click();
    await page.getByText(/Mission Queue/i).waitFor({ timeout: 10_000 });

    await page.getByRole('button', { name: /Add agent/i }).click();
    await page.getByLabel(/Runtime type/i).waitFor({ timeout: 10_000 });
    await page.getByLabel(/Runtime type/i).selectOption('webhook');
    await page.getByText(/Enable auto-dispatch/i).waitFor({ timeout: 10_000 });
    await page.getByText(/^Runtime config JSON$/i).waitFor({ timeout: 10_000 });
    await page.locator('div.fixed.inset-0 button').first().click();
    await page.getByLabel(/Runtime type/i).waitFor({ state: 'hidden', timeout: 10_000 });

    const taskCard = page.getByRole('button', { name: new RegExp(task.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    await taskCard.waitFor({ timeout: 10_000 });
    await taskCard.getByText(/Webhook auto/i).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Webhook$/i }).click();
    await page.getByText(/Showing/i).waitFor({ timeout: 10_000 });
    await taskCard.click();
    await page.getByRole('button', { name: /Copy handoff/i }).waitFor({ timeout: 10_000 });
    await page.getByText(/Dispatch timeline/i).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /Retry webhook/i }).waitFor({ timeout: 10_000 });
    await page.locator('div.fixed.inset-0 button').first().click();

    const responsiveChecks = [
      { name: 'tablet', width: 900, height: 1100 },
      { name: 'mobile', width: 390, height: 844 },
    ];
    for (const viewport of responsiveChecks) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
        'dispatch timeline retry control',
        'settings runtime operations retention and callback panel',
        'webhook dispatch/callback schema endpoints',
        'tablet responsive shell',
        'mobile responsive shell',
        'no browser console errors',
      ],
    }, null, 2));
  } finally {
    if (browser) {
      await browser.close();
    }
    await requestJson(`/api/tasks/${task.id}`, { method: 'DELETE' }).catch((error) => {
      console.error(`Failed to clean up smoke task ${task.id}:`, error);
    });
    await requestJson(`/api/agents/${agent.id}`, { method: 'DELETE' }).catch((error) => {
      console.error(`Failed to clean up smoke agent ${agent.id}:`, error);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
