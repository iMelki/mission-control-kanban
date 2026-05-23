import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGitHubImportPreviewResponse,
  buildTaskRefreshUpdateFromGitHubPreview,
} from '../src/lib/github-task-import';
import { requiresDispatchContractBeforeWorkStarts, summarizeDispatchContract } from '../src/lib/dispatch-contract';
import {
  buildWritebackActivityMessage,
  planGitHubWriteback,
  type GitHubWritebackTaskSnapshot,
} from '../src/lib/github-writeback';

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
