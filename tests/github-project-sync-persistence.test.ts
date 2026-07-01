import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-github-sync-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'mission-control-test.db');

let closeDb: typeof import('../src/lib/db').closeDb;
let queryOne: typeof import('../src/lib/db').queryOne;
let run: typeof import('../src/lib/db').run;
let syncLoadedGitHubProjectWorkspace: typeof import('../src/lib/github-project-sync').syncLoadedGitHubProjectWorkspace;
let parseDispatchMetadata: typeof import('../src/lib/dispatch-contract').parseDispatchMetadata;
let validateDispatchMetadata: typeof import('../src/lib/dispatch-contract').validateDispatchMetadata;

function resetDb() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${process.env.DATABASE_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

test.before(async () => {
  const dbModule = await import('../src/lib/db');
  const syncModule = await import('../src/lib/github-project-sync');
  const dispatchContract = await import('../src/lib/dispatch-contract');
  closeDb = dbModule.closeDb;
  queryOne = dbModule.queryOne;
  run = dbModule.run;
  syncLoadedGitHubProjectWorkspace = syncModule.syncLoadedGitHubProjectWorkspace;
  parseDispatchMetadata = dispatchContract.parseDispatchMetadata;
  validateDispatchMetadata = dispatchContract.validateDispatchMetadata;
});

test.after(() => {
  resetDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedWorkspaceAndTask() {
  resetDb();
  const now = '2026-07-01T10:00:00.000Z';
  run(
    `INSERT OR REPLACE INTO workspaces (
       id, name, slug, description, icon, github_project_owner, github_project_number,
       github_project_title, github_project_url, github_project_auto_refresh, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'assistants',
      'Assistants',
      'assistants',
      'Operator cockpit mapped to GitHub Project #13.',
      'A',
      'iMelki',
      13,
      'Assistants',
      'https://github.com/users/iMelki/projects/13',
      1,
      now,
      now,
    ]
  );
  run(
    `INSERT INTO tasks (
       id, title, description, status, priority, workspace_id, business_id,
       source_repo_owner, source_repo_name, source_issue_number, source_issue_url,
       source_project_item_id, dispatch_metadata, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'task-existing',
      'Stale imported task',
      'Old description',
      'in_progress',
      'normal',
      'assistants',
      'default',
      'iMelki',
      'mission-control-kanban',
      34,
      'https://github.com/iMelki/mission-control-kanban/issues/34',
      'PVTI_existing',
      JSON.stringify({ target_repo: 'iMelki/mission-control-kanban', readiness: 'needs_grooming' }),
      now,
      now,
    ]
  );
}

test('GitHub Project sync refreshes existing imported task dispatch metadata from repaired issue body', async () => {
  seedWorkspaceAndTask();
  const repairedIssueBody = [
    '## Goal',
    'Refresh dispatch metadata on existing GitHub Project sync tasks.',
    '',
    '## Allowed File Scope',
    '- src/lib/github-project-sync.ts',
    '- tests/github-project-sync-persistence.test.ts',
    '',
    '## Acceptance Criteria',
    '- Existing imported tasks receive repaired dispatch metadata.',
    '- Status is not churned backward when the task is already active.',
    '',
    '## Test Requirements',
    '- Add a persistence-level regression test.',
    '- Run npm run test:github-sync.',
    '',
    '## Safety Rules',
    '- Do not mutate GitHub in this test.',
    '',
    '## Impact',
    'Keeps MCK mirrored tasks dispatch-ready after GitHub issue grooming.',
    '',
    '## Rollback / Fallback Plan',
    'Re-run sync after restoring the previous task metadata.',
  ].join('\n');

  const result = await syncLoadedGitHubProjectWorkspace(
    'assistants',
    {
      title: 'Assistants',
      allItems: [
        {
          id: 'PVTI_existing',
          isArchived: false,
          content: {
            __typename: 'Issue',
            number: 34,
            title: 'Refresh dispatch metadata on existing GitHub Project sync tasks',
            body: repairedIssueBody,
            url: 'https://github.com/iMelki/mission-control-kanban/issues/34',
            state: 'OPEN',
            closed: false,
            repository: {
              name: 'mission-control-kanban',
              nameWithOwner: 'iMelki/mission-control-kanban',
              owner: { login: 'iMelki' },
            },
            labels: { nodes: [{ name: 'type:bug' }] },
          },
          fieldValues: {
            nodes: [
              { name: 'Ready for Agent', field: { name: 'Readiness' } },
              { name: 'Human Required', field: { name: 'Review Mode' } },
              { name: 'Medium', field: { name: 'Risk' } },
              { name: 'High', field: { name: 'Priority' } },
              { name: 'Ready for Agent', field: { name: 'Status' } },
            ],
          },
        },
      ],
    },
    { dryRun: false }
  );

  assert.equal(result.updated, 1);
  assert.equal(result.imported, 0);
  assert.equal(result.moved, 0);
  assert.equal(result.status_reconciled, 0);

  const row = queryOne<{ status: string; priority: string; dispatch_metadata: string }>(
    'SELECT status, priority, dispatch_metadata FROM tasks WHERE id = ?',
    ['task-existing']
  );
  assert.equal(row?.status, 'in_progress');
  assert.equal(row?.priority, 'high');
  const metadata = parseDispatchMetadata(row?.dispatch_metadata);
  const readiness = validateDispatchMetadata(metadata);
  assert.equal(readiness.canDispatch, true);
  assert.equal(metadata?.readiness, 'ready_for_agent');
  assert.equal(metadata?.risk_level, 'medium');
  assert.deepEqual(metadata?.allowed_file_scope, ['src/lib/github-project-sync.ts', 'tests/github-project-sync-persistence.test.ts']);
});
