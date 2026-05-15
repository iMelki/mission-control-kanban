import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGitHubImportPreviewResponse } from '../src/lib/github-task-import';
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
