import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGitHubImportPreviewResponse,
  buildTaskRefreshUpdateFromGitHubPreview,
  mergeGitHubSourceFromUpstream,
} from '../src/lib/github-task-import';
import {
  GITHUB_PROJECT_WORKSPACE_MAPPINGS,
  normalizeGitHubProjectStatus,
  reconcileGitHubProjectStatus,
} from '../src/lib/github-project-sync';
import { GENERIC_SYNC_PLACEHOLDER_STRINGS, isGenericSyncPlaceholder, mergeDispatchMetadataFromUpstream, requiresDispatchContractBeforeWorkStarts, summarizeDispatchContract, validateDispatchMetadata } from '../src/lib/dispatch-contract';
import {
  buildWritebackActivityMessage,
  planGitHubWriteback,
  type GitHubWritebackTaskSnapshot,
} from '../src/lib/github-writeback';
import { buildGitHubDiagnosticsPayload, buildMissingTokenDiagnostics } from '../src/lib/github-diagnostics';
import {
  getMckN8nSyncHistoryLimit,
  normalizeMckN8nSyncPayload,
  shouldNotifyMckN8nSyncAlert,
} from '../src/lib/n8n-sync-status';
import { presentMckN8nSyncRun } from '../src/lib/n8n-sync-presentation';
import {
  LOCAL_CONTROL_SURFACES,
  mapGitHubDiagnosticsToHealth,
  mapN8nSyncStatusToHealth,
  mapOpenClawStatusToHealth,
} from '../src/lib/local-control-panel';

test('GitHub diagnostics treats missing tokens as blocked', () => {
  const payload = buildMissingTokenDiagnostics();

  assert.equal(payload.status, 'missing_token');
  assert.equal(payload.authenticated, false);
  assert.equal(payload.issue_read_available, false);
  assert.equal(payload.project_read_available, false);
});

test('n8n sync presentation distinguishes warning review from errors and success', () => {
  assert.deepEqual(presentMckN8nSyncRun({ ok: true, alert_level: 'ok' }), {
    state: 'ok',
    label: 'OK',
    showMessage: false,
  });
  assert.deepEqual(presentMckN8nSyncRun({ ok: true, alert_level: 'warning' }), {
    state: 'warning',
    label: 'Review needed',
    showMessage: true,
  });
  assert.deepEqual(presentMckN8nSyncRun({ ok: true, alert_level: 'unknown' }), {
    state: 'warning',
    label: 'Review needed',
    showMessage: true,
  });
  assert.deepEqual(presentMckN8nSyncRun({ ok: false, alert_level: 'warning' }), {
    state: 'error',
    label: 'Attention needed',
    showMessage: true,
  });
});

test('Local Control surface list keeps launch-only cards separate from MCK diagnostics', () => {
  const surfaces = new Map(LOCAL_CONTROL_SURFACES.map((surface) => [surface.id, surface]));

  assert.equal(surfaces.get('mck-assistants')?.href, '/workspace/assistants');
  assert.equal(surfaces.get('managed-sync-route')?.displayUrl, '3021 / mck.host:3021');
  assert.equal(surfaces.get('mission-control')?.href, 'http://127.0.0.1:3001');
  assert.equal(surfaces.get('command-center')?.href, 'http://127.0.0.1:3088');
  assert.equal(surfaces.get('memsys-console')?.href, 'http://127.0.0.1:5111');
  assert.equal(surfaces.get('hermes-native')?.href, 'http://127.0.0.1:9119');
  assert.equal(surfaces.get('n8n-local')?.href, 'http://127.0.0.1:5678');

  for (const surface of LOCAL_CONTROL_SURFACES) {
    assert.ok(!/start|stop|restart|kill|railway/i.test(`${surface.name} ${surface.description} ${surface.href}`));
  }
});

test('Local Control health mapping degrades GitHub, OpenClaw, and n8n states safely', () => {
  assert.deepEqual(mapGitHubDiagnosticsToHealth({ status: 'ok', viewer_login: 'iMelki' }), {
    state: 'ok',
    label: 'Ready',
    detail: 'Authenticated as @iMelki',
  });

  assert.equal(mapGitHubDiagnosticsToHealth({ status: 'limited', message: 'Project reads failed' }).state, 'limited');
  assert.equal(mapGitHubDiagnosticsToHealth({ status: 'missing_token', message: 'Missing token' }).state, 'attention');

  assert.deepEqual(mapOpenClawStatusToHealth({ connected: true, sessions_count: 2 }), {
    state: 'ok',
    label: 'Connected',
    detail: '2 sessions visible',
  });
  assert.equal(mapOpenClawStatusToHealth({ connected: true, error: 'List failed' }).state, 'limited');
  assert.equal(mapOpenClawStatusToHealth({ connected: false, error: 'Gateway down' }).state, 'attention');

  assert.equal(mapN8nSyncStatusToHealth({ latest: null }).state, 'unknown');
  assert.equal(mapN8nSyncStatusToHealth({ latest: { ok: true, alert_level: 'ok', summary: { updated: 4, errors: 0 } } }).state, 'ok');
  assert.equal(mapN8nSyncStatusToHealth({ latest: { ok: true, alert_level: 'warning', summary: { updated: 4 } } }).state, 'limited');
  assert.equal(mapN8nSyncStatusToHealth({ latest: { ok: false, alert_level: 'error', summary: { updated: 4, errors: 1 } } }).state, 'attention');
});

test('GitHub Project workspace mappings cover the operator boards without duplicating source of truth', () => {
  const mappings = new Map(GITHUB_PROJECT_WORKSPACE_MAPPINGS.map((mapping) => [mapping.slug, mapping]));

  assert.equal(mappings.get('assistants')?.github_project_number, 13);
  assert.equal(mappings.get('memsys')?.github_project_number, 12);
  assert.equal(mappings.get('content-factory')?.github_project_number, 14);
  assert.equal(mappings.get('asimtop')?.github_project_number, 8);
  assert.equal(mappings.get('asimtop')?.github_project_title, 'Asimtop Trading Automation');
  assert.equal(mappings.get('asimtop')?.github_project_auto_refresh, false);
  assert.equal(mappings.get('frontend-revenue')?.github_project_number, 15);
  assert.equal(mappings.get('frontend-revenue')?.github_project_title, 'Frontend Revenue Program 2026');
  assert.equal(mappings.get('frontend-revenue')?.github_project_auto_refresh, false);

  // Workspaces added after the original seed start with auto-refresh off so a
  // manual sync has to prove the mapping before scheduled sync touches them.
  const manualSyncSlugs = new Set(['asimtop', 'frontend-revenue']);

  for (const mapping of GITHUB_PROJECT_WORKSPACE_MAPPINGS) {
    assert.equal(mapping.github_project_owner, 'iMelki');
    assert.equal(mapping.github_project_auto_refresh, !manualSyncSlugs.has(mapping.slug));
    assert.match(mapping.description, /mapped to GitHub Project/i);
    assert.equal(
      mapping.github_project_url,
      `https://github.com/users/${mapping.github_project_owner}/projects/${mapping.github_project_number}`
    );
  }

  const projectNumbers = GITHUB_PROJECT_WORKSPACE_MAPPINGS.map((mapping) => mapping.github_project_number);
  assert.equal(new Set(projectNumbers).size, projectNumbers.length, 'each mapping owns a distinct GitHub Project');
});

test('GitHub Project status mapping reconciles upstream Done without inventing a Blocked column', () => {
  assert.equal(normalizeGitHubProjectStatus('Ready for Agent'), 'ready');
  assert.equal(normalizeGitHubProjectStatus('Review'), 'review');
  assert.equal(normalizeGitHubProjectStatus('Blocked'), 'blocked');
  assert.equal(normalizeGitHubProjectStatus('Done'), 'done');

  assert.deepEqual(
    reconcileGitHubProjectStatus({ currentStatus: 'inbox', issueClosed: true, projectStatus: 'Ready' }),
    {
      upstream_status: 'done',
      local_status: 'done',
      reason: 'GitHub issue is closed, so the local MCK task should be Done.',
    }
  );

  assert.equal(
    reconcileGitHubProjectStatus({ currentStatus: 'review', projectStatus: 'Done' }).local_status,
    'done'
  );
  assert.equal(
    reconcileGitHubProjectStatus({ currentStatus: 'in_progress', projectStatus: 'Review' }).local_status,
    'review'
  );
  assert.equal(
    reconcileGitHubProjectStatus({ currentStatus: 'planning', projectStatus: 'Ready' }).local_status,
    'inbox'
  );
  assert.equal(
    reconcileGitHubProjectStatus({ currentStatus: 'in_progress', projectStatus: 'Ready' }).local_status,
    undefined
  );
  assert.match(
    reconcileGitHubProjectStatus({ currentStatus: 'in_progress', projectStatus: 'Blocked' }).drift_warning ?? '',
    /no first-class MCK column/i
  );
});

test('MCK n8n sync payload normalization records alert state and run scope', () => {
  const normalized = normalizeMckN8nSyncPayload(
    {
      ok: false,
      dryRun: false,
      receivedAt: '2026-06-10T07:00:00.000Z',
      mode: 'local-mck-sync',
      baseUrl: 'http://mck.host:3021',
      workspaces: ['assistants', 'memsys'],
      summary: {
        scanned_items: 90,
        updated: 10,
        errors: 1,
      },
      alert: {
        level: 'error',
        message: 'MCK sync returned 1 error.',
      },
      results: [
        { workspace: 'assistants', ok: true },
        { workspace: 'memsys', ok: false },
      ],
    },
    new Date('2026-06-10T07:00:01.000Z')
  );

  assert.equal(normalized.dry_run, false);
  assert.equal(normalized.ok, false);
  assert.equal(normalized.alert_level, 'error');
  assert.equal(normalized.alert_message, 'MCK sync returned 1 error.');
  assert.deepEqual(normalized.workspaces, ['assistants', 'memsys']);
  assert.equal(normalized.received_at, '2026-06-10T07:00:00.000Z');
});

test('MCK scheduled sync surfaces upstream drift instead of recording a clean run (#134)', () => {
  const normalized = normalizeMckN8nSyncPayload(
    {
      ok: true,
      dryRun: false,
      mode: 'local-mck-sync',
      workspaces: ['assistants'],
      summary: {
        scanned_items: 90,
        updated: 3,
        errors: 0,
        status_reconciled: 2,
        upstream_drift_warnings: 9,
      },
      alert: { level: 'ok' },
    },
    new Date('2026-08-05T07:00:00.000Z')
  );

  // Drift downgrades the alert level; the run itself still succeeded.
  assert.equal(normalized.ok, true);
  assert.equal(normalized.alert_level, 'warning');
  assert.match(normalized.alert_message, /2 status reconciled/);
  assert.match(normalized.alert_message, /9 upstream drift warnings/);
  // Drift is divergence, not failure: the alert webhook must not fire.
  assert.equal(
    shouldNotifyMckN8nSyncAlert({ ok: normalized.ok, alert_level: normalized.alert_level }),
    false
  );

  // A drift-free clean run still records alert_level 'ok'.
  assert.equal(
    normalizeMckN8nSyncPayload({ ok: true, summary: { updated: 4, errors: 0 } }).alert_level,
    'ok'
  );

  // Drift never softens an error-level run.
  assert.equal(
    normalizeMckN8nSyncPayload({
      ok: false,
      summary: { errors: 2, upstream_drift_warnings: 1 },
      alert: { level: 'error', message: 'MCK sync returned 2 errors.' },
    }).alert_level,
    'error'
  );

  // Historical rows recorded before this fix (alert_level 'ok' with drift in the
  // stored summary) still degrade the Local Control panel.
  const health = mapN8nSyncStatusToHealth({
    latest: {
      ok: true,
      alert_level: 'ok',
      summary: { updated: 3, status_reconciled: 2, upstream_drift_warnings: 9 },
    },
  });
  assert.equal(health.state, 'limited');
  assert.match(health.detail, /9 upstream drift warnings/);
});

test('MCK n8n sync history limit stays configurable and bounded', () => {
  const previousLimit = process.env.MCK_N8N_SYNC_HISTORY_LIMIT;

  try {
    process.env.MCK_N8N_SYNC_HISTORY_LIMIT = '12';
    assert.equal(getMckN8nSyncHistoryLimit(), 12);

    process.env.MCK_N8N_SYNC_HISTORY_LIMIT = '9999';
    assert.equal(getMckN8nSyncHistoryLimit(), 500);

    process.env.MCK_N8N_SYNC_HISTORY_LIMIT = '0';
    assert.equal(getMckN8nSyncHistoryLimit(), 1);

    process.env.MCK_N8N_SYNC_HISTORY_LIMIT = 'not-a-number';
    assert.equal(getMckN8nSyncHistoryLimit(), 100);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.MCK_N8N_SYNC_HISTORY_LIMIT;
    } else {
      process.env.MCK_N8N_SYNC_HISTORY_LIMIT = previousLimit;
    }
  }
});

test('MCK n8n sync alerts notify only on failed or error-level runs', () => {
  assert.equal(shouldNotifyMckN8nSyncAlert({ ok: true, alert_level: 'ok' }), false);
  assert.equal(shouldNotifyMckN8nSyncAlert({ ok: true, alert_level: 'warning' }), false);
  assert.equal(shouldNotifyMckN8nSyncAlert({ ok: false, alert_level: 'warning' }), true);
  assert.equal(shouldNotifyMckN8nSyncAlert({ ok: true, alert_level: 'error' }), true);
});

test('GitHub diagnostics reports limited when Project field reads need read:project', () => {
  const payload = buildGitHubDiagnosticsPayload({
    tokenSource: 'GH_GENERAL_TOKEN',
    viewerLogin: 'iMelki',
    projectReadAvailable: false,
    projectCountVisible: null,
    projectProbeError: "The 'id' field requires one of the following scopes: ['read:project']",
  });

  assert.equal(payload.status, 'limited');
  assert.equal(payload.authenticated, true);
  assert.equal(payload.issue_read_available, true);
  assert.equal(payload.project_read_available, false);
  assert.match(payload.message, /Project field reads failed/i);
  assert.match(payload.project_probe_error ?? '', /read:project/);
});

test('GitHub import preview builds source identity and dispatch-ready preview from a groomed issue', () => {
  const response = buildGitHubImportPreviewResponse({
    request: {
      issue: {
        number: 24,
        title: 'Version Workflow Pack 1 against the local n8n runtime',
        body: [
          '## Goal',
          'Version the workflow pack against the local runtime.',
          '',
          '## Allowed File Scope',
          '- projects-ops/n8n-workflows/**',
          '- projects-ops/scripts/**',
          '',
          '## Acceptance Criteria',
          '- Workflow artifacts are versioned in-repo.',
          '- The local webhook path is trialed successfully.',
          '',
          '## Test Requirements',
          '- Validate workflow JSON locally.',
          '- Trial the local webhook path.',
          '',
          '## Safety Rules',
          '- Do not mutate GitHub in dry-run mode.',
          '',
          '## Rollback / Fallback Plan',
          'Disable the workflow and leave GitHub fields unchanged.',
        ].join('\n'),
        html_url: 'https://github.com/iMelki/projects-ops/issues/24',
        labels: [{ name: 'type:automation' }, { name: 'area:workflow' }],
      },
      repository: {
        full_name: 'iMelki/projects-ops',
        name: 'projects-ops',
        owner: { login: 'iMelki' },
      },
      project_fields: {
        Repo: 'iMelki/projects-ops',
        Project: 'GitHub-native pipeline',
        Readiness: 'Ready for Agent',
        'Review Mode': 'Human Required',
        Risk: 'Medium',
        Priority: 'High',
        Impact: 'workflow automation',
        'Project Item ID': 'PVTI_local_24',
      },
    },
  });

  assert.equal(response.source_identity?.repo_owner, 'iMelki');
  assert.equal(response.source_identity?.repo_name, 'projects-ops');
  assert.equal(response.source_identity?.issue_number, 24);
  assert.equal(response.preview.github_source?.project_item_id, 'PVTI_local_24');
  assert.equal(response.dispatch_ready, true);
  assert.deepEqual(response.dispatch_blockers, []);
  assert.match(response.preview.dispatch_metadata?.rollback_plan ?? '', /Disable the workflow/i);
  assert.deepEqual(response.preview.dispatch_metadata?.allowed_file_scope, [
    'projects-ops/n8n-workflows/**',
    'projects-ops/scripts/**',
  ]);
});

test('GitHub import preview reports duplicate-import blockers when an existing task is linked', () => {
  const response = buildGitHubImportPreviewResponse({
    request: {
      issue: {
        number: 12,
        title: 'Add GitHub import preview and source identity mapping',
        body: '## Goal\nPersist GitHub source identity.',
        html_url: 'https://github.com/iMelki/mission-control-kanban/issues/12',
      },
      repository: {
        full_name: 'iMelki/mission-control-kanban',
        name: 'mission-control-kanban',
        owner: { login: 'iMelki' },
      },
    },
    existingTask: {
      id: 'task-123',
      title: 'Existing imported task',
      status: 'inbox',
      priority: 'normal',
      created_at: '2026-05-15T00:00:00.000Z',
      updated_at: '2026-05-15T00:00:00.000Z',
    },
  });

  assert.equal(response.dispatch_ready, false);
  assert.ok(response.blockers.some((blocker) => blocker.includes('already imported as task task-123')));
  assert.equal(response.existing_task?.id, 'task-123');
});

test('GitHub import preview can normalize required dispatch sections from GitHub Project fields', () => {
  const response = buildGitHubImportPreviewResponse({
    request: {
      issue: {
        number: 31,
        title: 'Backfill operator onboarding in MCK',
        body: '## Goal\nMake the import flow usable for first-time operators.',
        html_url: 'https://github.com/iMelki/mission-control-kanban/issues/31',
      },
      repository: {
        full_name: 'iMelki/mission-control-kanban',
        name: 'mission-control-kanban',
        owner: { login: 'iMelki' },
      },
      project_fields: {
        Repo: 'iMelki/mission-control-kanban',
        Project: 'GitHub-native pipeline',
        Readiness: 'Ready for Agent',
        'Review Mode': 'Human Required',
        Risk: 'Medium',
        Impact: 'operator UX',
        'Project Item ID': 'PVTI_mock_31',
        'Allowed File Scope': 'src/components/**\nsrc/app/api/github/**',
        'Acceptance Criteria': '- Import preview is available in the UI\n- Operators can create a local task from it',
        'Test Requirements': 'npm run test:github-sync\nManual import against localhost',
        'Rollback / Fallback Plan': 'Disable the new modal and keep API routes intact.',
        'Safety Rules': '- Do not write back to GitHub before the operator reviews the plan',
      },
    },
  });

  assert.deepEqual(response.preview.dispatch_metadata?.allowed_file_scope, [
    'src/components/**',
    'src/app/api/github/**',
  ]);
  assert.deepEqual(response.preview.dispatch_metadata?.test_requirements, [
    'npm run test:github-sync',
    'Manual import against localhost',
  ]);
  assert.match(response.preview.dispatch_metadata?.rollback_plan ?? '', /Disable the new modal/i);
  assert.deepEqual(response.preview.dispatch_metadata?.safety_rules, [
    'Do not write back to GitHub before the operator reviews the plan',
  ]);
  assert.equal(response.dispatch_ready, true);
});

test('GitHub import preview hydrates dispatch metadata from issue body headings', () => {
  const response = buildGitHubImportPreviewResponse({
    request: {
      issue: {
        number: 24,
        title: 'Reconcile Project Done into local MCK Done',
        body: [
          'Project/Workstream: project workspace sync',
          '',
          '## Readiness',
          'Ready for Agent',
          '',
          '## Review Mode',
          'Human Required',
          '',
          '## Risk',
          'Medium',
          '',
          '## Impact',
          'Stops stale active MCK cards when GitHub is already closed or Done.',
          '',
          '## Allowed File Scope',
          '- src/lib/github-project-sync.ts',
          '- src/app/workspace/[slug]/page.tsx',
          '- tests/github-sync.test.ts',
          '',
          '## Acceptance Criteria',
          '- Closed GitHub issues reconcile to local Done.',
          '- Project Done items reconcile to local Done.',
          '',
          '## Test Requirements',
          '- npm run test:github-sync',
          '',
          '## Rollback / Fallback Plan',
          'Disable status reconciliation and keep metadata refresh only.',
          '',
          '## Safety Rules',
          '- Do not write back to GitHub from workspace sync.',
        ].join('\n'),
        html_url: 'https://github.com/iMelki/mission-control-kanban/issues/24',
        labels: [{ name: 'type:automation' }],
      },
      repository: {
        full_name: 'iMelki/mission-control-kanban',
        name: 'mission-control-kanban',
        owner: { login: 'iMelki' },
      },
      project_fields: {
        'Project Item ID': 'PVTI_mock_24',
      },
    },
  });

  assert.equal(response.dispatch_ready, true);
  assert.equal(response.preview.dispatch_metadata?.readiness, 'ready_for_agent');
  assert.equal(response.preview.dispatch_metadata?.review_mode, 'human_required');
  assert.equal(response.preview.dispatch_metadata?.risk_level, 'medium');
  assert.match(response.preview.dispatch_metadata?.impact ?? '', /stale active MCK cards/i);
  assert.deepEqual(response.preview.dispatch_metadata?.allowed_file_scope, [
    'src/lib/github-project-sync.ts',
    'src/app/workspace/[slug]/page.tsx',
    'tests/github-sync.test.ts',
  ]);
});

test('GitHub write-back plan stays bounded and dry-run friendly without live GitHub credentials', async () => {
  const previousGeneralToken = process.env.GH_GENERAL_TOKEN;
  const previousGitHubToken = process.env.GITHUB_TOKEN;
  delete process.env.GH_GENERAL_TOKEN;
  delete process.env.GITHUB_TOKEN;

  const snapshot: GitHubWritebackTaskSnapshot = {
    id: 'task-42',
    title: 'Validate GitHub write-back plan',
    status: 'review',
    assigned_agent_name: 'Codex',
    github_source: {
      repo_owner: 'iMelki',
      repo_name: 'mission-control-kanban',
      issue_number: 13,
      issue_url: 'https://github.com/iMelki/mission-control-kanban/issues/13',
    },
    dispatch_metadata: {
      readiness: 'ready_for_agent',
      review_mode: 'human_required',
    },
    dispatch_blockers: [],
  };

  try {
    const plan = await planGitHubWriteback(snapshot);

    assert.match(plan.signature, /^[a-f0-9]{64}$/);
    assert.match(plan.issue_comment_body, /Mission Control Kanban write-back/);
    assert.match(plan.issue_comment_body, /Status: Review/);
    assert.match(plan.issue_comment_body, /Agent: Codex/);
    assert.equal(plan.project_updates[0]?.field_name, 'Status');
    assert.equal(plan.project_updates[0]?.value, 'Review');
    assert.equal(plan.project_updates[1]?.field_name, 'Agent');
    assert.equal(plan.project_updates[1]?.value, 'Codex');
    assert.ok(plan.warnings.some((warning) => warning.includes('Missing GH_GENERAL_TOKEN or GITHUB_TOKEN')));
    assert.ok(plan.warnings.some((warning) => warning.includes('No GitHub Project item ID')));
  } finally {
    if (previousGeneralToken !== undefined) {
      process.env.GH_GENERAL_TOKEN = previousGeneralToken;
    }

    if (previousGitHubToken !== undefined) {
      process.env.GITHUB_TOKEN = previousGitHubToken;
    }
  }
});

test('GitHub write-back activity messages stay explicit about dry-run versus apply state', () => {
  assert.equal(
    buildWritebackActivityMessage('dry_run', 'planned', 'iMelki/mission-control-kanban#13'),
    'GitHub write-back dry run prepared for iMelki/mission-control-kanban#13'
  );
  assert.equal(
    buildWritebackActivityMessage('apply', 'applied', 'iMelki/mission-control-kanban#13'),
    'GitHub write-back applied to iMelki/mission-control-kanban#13'
  );
});

test('Imported GitHub tasks require a complete dispatch contract before active work statuses', () => {
  assert.equal(requiresDispatchContractBeforeWorkStarts('planning'), false);
  assert.equal(requiresDispatchContractBeforeWorkStarts('inbox'), false);
  assert.equal(requiresDispatchContractBeforeWorkStarts('assigned'), true);
  assert.equal(requiresDispatchContractBeforeWorkStarts('in_progress'), true);
  assert.equal(requiresDispatchContractBeforeWorkStarts('done'), true);
});

test('Dispatch summary distinguishes ready, grooming, and human-only work', () => {
  const ready = summarizeDispatchContract({
    target_repo: 'iMelki/mission-control-kanban',
    project_workstream: 'dispatch-ui',
    allowed_file_scope: ['src/components/**'],
    acceptance_criteria: ['UI shows readiness state'],
    test_requirements: ['npm run test:github-sync'],
    risk_level: 'medium',
    readiness: 'ready_for_agent',
    review_mode: 'human_required',
    impact: 'operator UX',
    rollback_plan: 'Hide the new summary block',
  });

  const grooming = summarizeDispatchContract({
    readiness: 'needs_grooming',
    review_mode: 'human_required',
    risk_level: 'medium',
  });

  const humanOnly = summarizeDispatchContract({
    target_repo: 'iMelki/mission-control-kanban',
    project_workstream: 'dispatch-ui',
    allowed_file_scope: ['src/components/**'],
    acceptance_criteria: ['Human handles the rollout'],
    test_requirements: ['Manual review'],
    risk_level: 'high',
    readiness: 'needs_human',
    review_mode: 'human_required',
    impact: 'operator safety',
    rollback_plan: 'Do not dispatch the task',
  });

  assert.equal(ready.state, 'ready');
  assert.match(ready.headline, /Ready for agent dispatch/i);
  assert.equal(grooming.state, 'needs_grooming');
  assert.match(grooming.headline, /Needs grooming/i);
  assert.equal(humanOnly.state, 'human_only');
  assert.match(humanOnly.headline, /Human-only work/i);
});

test('GitHub refresh patch updates imported task metadata without forcing status churn', () => {
  const patch = buildTaskRefreshUpdateFromGitHubPreview(
    {
      title: 'Old title',
      description: 'Old description',
      priority: 'normal',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'projects-ops',
        issue_number: 1,
        issue_url: 'https://github.com/iMelki/projects-ops/issues/1',
      },
      dispatch_metadata: {
        target_repo: 'iMelki/projects-ops',
        project_workstream: 'Old workstream',
      },
    },
    {
      title: 'Refreshed title',
      description: 'Refreshed description',
      priority: 'high',
      status: 'inbox',
      workspace_id: 'default',
      business_id: 'default',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'projects-ops',
        issue_number: 1,
        issue_url: 'https://github.com/iMelki/projects-ops/issues/1',
        project_item_id: 'PVTI_refresh_1',
      },
      dispatch_metadata: {
        target_repo: 'iMelki/projects-ops',
        project_workstream: 'GitHub-native pipeline',
        allowed_file_scope: ['projects-ops/docs/**'],
      },
    }
  );

  assert.equal(patch.title, 'Refreshed title');
  assert.equal(patch.description, 'Refreshed description');
  assert.equal(patch.priority, 'high');
  assert.equal(patch.github_source?.project_item_id, 'PVTI_refresh_1');
  assert.deepEqual(patch.dispatch_metadata?.allowed_file_scope, ['projects-ops/docs/**']);
  assert.equal('status' in patch, false);
});


test('GitHub refresh patch preserves local dispatch contract fields when the issue body omits them', () => {
  const localContract = {
    source_issue_url: 'https://github.com/iMelki/memsys/issues/991',
    target_repo: 'iMelki/memsys',
    project_workstream: 'old-workstream',
    allowed_file_scope: ['src/lib/hindsight.ts', 'tests/hindsight.test.ts'],
    acceptance_criteria: ['Local acceptance criterion stays'],
    test_requirements: ['npm run test:hindsight'],
    risk_level: 'medium' as const,
    readiness: 'ready_for_agent' as const,
    review_mode: 'human_required' as const,
    impact: 'Local impact statement stays after a body-less resync',
    rollback_plan: 'Revert the local dispatch contract commit.',
    safety_rules: ['Do not clear locally authored contract fields'],
  };

  const patch = buildTaskRefreshUpdateFromGitHubPreview(
    {
      title: 'Old title',
      description: 'Old description',
      priority: 'normal',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'memsys',
        issue_number: 991,
        issue_url: 'https://github.com/iMelki/memsys/issues/991',
      },
      dispatch_metadata: localContract,
    },
    {
      title: 'Refreshed memsys#991 title',
      description: 'Issue body without contract sections.',
      priority: 'high',
      status: 'inbox',
      workspace_id: 'default',
      business_id: 'default',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'memsys',
        issue_number: 991,
        issue_url: 'https://github.com/iMelki/memsys/issues/991',
        project_item_id: 'PVTI_fa3cfe1d',
      },
      dispatch_metadata: {
        source_issue_url: 'https://github.com/iMelki/memsys/issues/991',
        target_repo: 'iMelki/memsys',
        project_workstream: 'updated-workstream',
      },
    }
  );

  assert.equal(patch.title, 'Refreshed memsys#991 title');
  assert.equal(patch.priority, 'high');
  assert.equal(patch.github_source?.project_item_id, 'PVTI_fa3cfe1d');
  assert.equal(patch.dispatch_metadata?.source_issue_url, localContract.source_issue_url);
  assert.equal(patch.dispatch_metadata?.target_repo, 'iMelki/memsys');
  assert.equal(patch.dispatch_metadata?.project_workstream, 'updated-workstream');
  assert.deepEqual(patch.dispatch_metadata?.allowed_file_scope, localContract.allowed_file_scope);
  assert.deepEqual(patch.dispatch_metadata?.acceptance_criteria, localContract.acceptance_criteria);
  assert.deepEqual(patch.dispatch_metadata?.test_requirements, localContract.test_requirements);
  assert.equal(patch.dispatch_metadata?.rollback_plan, localContract.rollback_plan);
  assert.deepEqual(patch.dispatch_metadata?.safety_rules, localContract.safety_rules);
  assert.equal(patch.dispatch_metadata?.impact, localContract.impact);
  assert.equal(patch.dispatch_metadata?.readiness, 'ready_for_agent');
  assert.equal(patch.dispatch_metadata?.review_mode, 'human_required');
  assert.equal(patch.dispatch_metadata?.risk_level, 'medium');
  assert.equal(validateDispatchMetadata(patch.dispatch_metadata).canDispatch, true);
});

test('GitHub refresh patch applies non-empty upstream contract values and ignores empty ones', () => {
  const merged = mergeDispatchMetadataFromUpstream(
    {
      target_repo: 'iMelki/memsys',
      project_workstream: 'local-stream',
      allowed_file_scope: ['src/local.ts'],
      test_requirements: ['npm test'],
      rollback_plan: 'Revert the local change.',
      readiness: 'ready_for_agent',
    },
    {
      target_repo: 'iMelki/memsys',
      project_workstream: 'upstream-stream',
      allowed_file_scope: ['src/upstream.ts', 'tests/upstream.test.ts'],
      test_requirements: [],
      rollback_plan: '   ',
      impact: 'Upstream impact is non-empty so it is applied',
    }
  );

  assert.equal(merged?.project_workstream, 'upstream-stream');
  assert.deepEqual(merged?.allowed_file_scope, ['src/upstream.ts', 'tests/upstream.test.ts']);
  assert.deepEqual(merged?.test_requirements, ['npm test']);
  assert.equal(merged?.rollback_plan, 'Revert the local change.');
  assert.equal(merged?.readiness, 'ready_for_agent');
  assert.equal(merged?.impact, 'Upstream impact is non-empty so it is applied');
});

test('GitHub refresh patch keeps canDispatch false when a required contract field is missing locally and upstream', () => {
  const incompleteLocal = {
    source_issue_url: 'https://github.com/iMelki/memsys/issues/991',
    target_repo: 'iMelki/memsys',
    project_workstream: 'old-workstream',
    allowed_file_scope: ['src/lib/hindsight.ts'],
    acceptance_criteria: ['Local acceptance criterion stays'],
    test_requirements: ['npm run test:hindsight'],
    risk_level: 'medium' as const,
    readiness: 'ready_for_agent' as const,
    review_mode: 'human_required' as const,
    impact: 'Local impact is present but rollback_plan is not',
  };

  const before = validateDispatchMetadata(incompleteLocal);
  assert.equal(before.canDispatch, false);
  assert.ok(before.missingFields.includes('rollback/fallback plan'));

  const patch = buildTaskRefreshUpdateFromGitHubPreview(
    {
      title: 'Old title',
      description: 'Old description',
      priority: 'normal',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'memsys',
        issue_number: 991,
        issue_url: 'https://github.com/iMelki/memsys/issues/991',
      },
      dispatch_metadata: incompleteLocal,
    },
    {
      title: 'Refreshed memsys#991 title',
      description: 'Issue body without contract sections.',
      priority: 'high',
      status: 'inbox',
      workspace_id: 'default',
      business_id: 'default',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'memsys',
        issue_number: 991,
        issue_url: 'https://github.com/iMelki/memsys/issues/991',
        project_item_id: 'PVTI_incomplete_contract',
      },
      dispatch_metadata: {
        source_issue_url: 'https://github.com/iMelki/memsys/issues/991',
        target_repo: 'iMelki/memsys',
        project_workstream: 'updated-workstream',
      },
    }
  );

  assert.equal(patch.title, 'Refreshed memsys#991 title');
  assert.equal(patch.dispatch_metadata?.project_workstream, 'updated-workstream');
  assert.equal(patch.dispatch_metadata?.rollback_plan, undefined);
  const after = validateDispatchMetadata(patch.dispatch_metadata);
  assert.equal(after.canDispatch, false);
  assert.ok(after.missingFields.includes('rollback/fallback plan'));
});

test('placeholder upstream overwrite refused', () => {
  const localImpact = 'Local impact describes the real operator change.';
  const localScope = ['src/lib/dispatch-contract.ts', 'tests/github-sync.test.ts'];
  const localCriteria = ['Local acceptance criterion stays'];
  const localTests = ['npm run test:github-sync'];
  const localRollback = 'Revert the local dispatch contract commit.';

  const merged = mergeDispatchMetadataFromUpstream(
    {
      target_repo: 'iMelki/memsys',
      project_workstream: 'local-stream',
      allowed_file_scope: localScope,
      acceptance_criteria: localCriteria,
      test_requirements: localTests,
      impact: localImpact,
      rollback_plan: localRollback,
      readiness: 'ready_for_agent',
    },
    {
      allowed_file_scope: ['Owning repo issue, docs, scripts, and tests named by the task.'],
      acceptance_criteria: [
        'Issue is present on the mapped GitHub Project.',
        'Required dispatch fields are populated for MCK import.',
        'Mapped MCK workspace sync imports or updates the local task mirror.',
      ],
      test_requirements: [
        'Run this script in -DryRun mode before broad repair.',
        'Run mapped MCK workspace sync after Project membership repair.',
      ],
      impact: 'Keeps repository work visible in the mapped operator cockpit and MCK sync.',
      rollback_plan: 'Remove the Project item from the mapped board or set Status=Done if this issue should not be visible in MCK.',
    },
  );

  assert.deepEqual(merged?.allowed_file_scope, localScope);
  assert.deepEqual(merged?.acceptance_criteria, localCriteria);
  assert.deepEqual(merged?.test_requirements, localTests);
  assert.equal(merged?.impact, localImpact);
  assert.equal(merged?.rollback_plan, localRollback);
  assert.equal(merged?.project_workstream, 'local-stream');

  // A mixed upstream array drops placeholder items, then applies the rest.
  const mixed = mergeDispatchMetadataFromUpstream(
    { acceptance_criteria: localCriteria },
    {
      acceptance_criteria: [
        '  Issue is present on the mapped GitHub Project.  ',
        'A real upstream criterion is kept',
      ],
    },
  );
  assert.deepEqual(mixed?.acceptance_criteria, ['A real upstream criterion is kept']);

  // Case or wording changes are not placeholders (exact match after trim only).
  assert.equal(isGenericSyncPlaceholder('issue is present on the mapped GitHub Project.'), false);
  assert.equal(
    isGenericSyncPlaceholder('  Issue is present on the mapped GitHub Project.  '),
    true,
  );
  assert.equal(GENERIC_SYNC_PLACEHOLDER_STRINGS.includes('Issue is present on the mapped GitHub Project.'), true);
});

test('empty upstream keeps local value', () => {
  const local = {
    target_repo: 'iMelki/memsys',
    project_workstream: 'local-stream',
    allowed_file_scope: ['src/local.ts'],
    acceptance_criteria: ['Local criterion'],
    test_requirements: ['npm test'],
    impact: 'Local impact stays',
    rollback_plan: 'Revert the local change.',
    readiness: 'ready_for_agent' as const,
  };

  const merged = mergeDispatchMetadataFromUpstream(local, {
    project_workstream: '   ',
    allowed_file_scope: [],
    acceptance_criteria: ['   '],
    test_requirements: undefined,
    impact: '',
    rollback_plan: ' \n\t ',
  });

  assert.equal(merged?.project_workstream, 'local-stream');
  assert.deepEqual(merged?.allowed_file_scope, ['src/local.ts']);
  assert.deepEqual(merged?.acceptance_criteria, ['Local criterion']);
  assert.deepEqual(merged?.test_requirements, ['npm test']);
  assert.equal(merged?.impact, 'Local impact stays');
  assert.equal(merged?.rollback_plan, 'Revert the local change.');
  assert.equal(merged?.readiness, 'ready_for_agent');
  assert.equal(merged?.target_repo, 'iMelki/memsys');
});

test('placeholder-only field is not dispatchable', () => {
  const otherwiseComplete = {
    target_repo: 'iMelki/memsys',
    project_workstream: 'local-stream',
    allowed_file_scope: ['Owning repo issue, docs, scripts, and tests named by the task.'],
    acceptance_criteria: [
      'Issue is present on the mapped GitHub Project.',
      'Required dispatch fields are populated for MCK import.',
    ],
    test_requirements: ['Run this wrapper in dry-run mode before apply.'],
    risk_level: 'medium' as const,
    readiness: 'ready_for_agent' as const,
    review_mode: 'human_required' as const,
    impact: 'Keeps repository work visible in the mapped operator cockpit and MCK sync.',
    rollback_plan: 'Use the generated rollback manifest to restore prior Project field values or remove newly created Project items.',
  };

  const result = validateDispatchMetadata(otherwiseComplete);
  assert.equal(result.canDispatch, false);
  assert.ok(result.missingFields.includes('allowed file scope'));
  assert.ok(result.missingFields.includes('acceptance criteria'));
  assert.ok(result.missingFields.includes('test requirements'));
  assert.ok(result.missingFields.includes('impact'));
  assert.ok(result.missingFields.includes('rollback/fallback plan'));
  assert.equal(result.missingFields.includes('target repo'), false);
  assert.equal(result.missingFields.includes('project/workstream'), false);

  // A required field with a real item plus a placeholder is still present.
  const mixed = validateDispatchMetadata({
    ...otherwiseComplete,
    allowed_file_scope: [
      'Owning repo issue, docs, scripts, and tests named by the task.',
      'src/lib/dispatch-contract.ts',
    ],
    acceptance_criteria: ['A real acceptance criterion'],
    test_requirements: ['npm run test:github-sync'],
    impact: 'Local impact describes the real operator change.',
    rollback_plan: 'Revert the local dispatch contract commit.',
  });
  assert.equal(mixed.canDispatch, true);
  assert.deepEqual(mixed.missingFields, []);
});

test('partial upstream github_source keeps local subfields', () => {
  const localSource = {
    repo_owner: 'iMelki',
    repo_name: 'memsys',
    issue_number: 991,
    issue_url: 'https://github.com/iMelki/memsys/issues/991',
    project_item_id: 'PVTI_local_kept',
  };

  const merged = mergeGitHubSourceFromUpstream(localSource, {
    repo_owner: 'iMelki',
    repo_name: '',
    issue_number: 0,
    issue_url: '   ',
    project_item_id: 'PVTI_upstream_refresh',
  });

  assert.equal(merged?.repo_owner, 'iMelki');
  assert.equal(merged?.repo_name, 'memsys');
  assert.equal(merged?.issue_number, 991);
  assert.equal(merged?.issue_url, 'https://github.com/iMelki/memsys/issues/991');
  assert.equal(merged?.project_item_id, 'PVTI_upstream_refresh');

  // A placeholder string in an upstream subfield does not wipe the local value.
  const placeholderOwner = mergeGitHubSourceFromUpstream(localSource, {
    repo_owner: 'Issue is present on the mapped GitHub Project.',
    repo_name: 'memsys',
    issue_number: 991,
    issue_url: 'https://github.com/iMelki/memsys/issues/991',
  });
  assert.equal(placeholderOwner?.repo_owner, 'iMelki');
  assert.equal(placeholderOwner?.project_item_id, 'PVTI_local_kept');

  // The refresh helper uses the same subfield merge.
  const patch = buildTaskRefreshUpdateFromGitHubPreview(
    {
      title: 'Old title',
      description: 'Old description',
      priority: 'normal',
      github_source: localSource,
      dispatch_metadata: { target_repo: 'iMelki/memsys' },
    },
    {
      title: 'Refreshed title',
      description: 'Refreshed description',
      priority: 'high',
      status: 'inbox',
      workspace_id: 'default',
      business_id: 'default',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'memsys',
        issue_number: 991,
        issue_url: 'https://github.com/iMelki/memsys/issues/991',
        // project_item_id absent: local value must stay
      },
      dispatch_metadata: { target_repo: 'iMelki/memsys' },
    },
  );

  assert.equal(patch.github_source?.project_item_id, 'PVTI_local_kept');
  assert.equal(patch.github_source?.repo_name, 'memsys');
  assert.equal(patch.github_source?.issue_number, 991);
});
