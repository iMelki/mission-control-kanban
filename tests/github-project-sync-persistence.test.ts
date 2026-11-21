import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-github-sync-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'mission-control-test.db');

let closeDb: typeof import('../src/lib/db').closeDb;
let queryOne: typeof import('../src/lib/db').queryOne;
let run: typeof import('../src/lib/db').run;
let syncLoadedGitHubProjectWorkspace: typeof import('../src/lib/github-project-sync').syncLoadedGitHubProjectWorkspace;
let projectWorkspaceMappings: typeof import('../src/lib/github-project-sync').GITHUB_PROJECT_WORKSPACE_MAPPINGS;
let parseDispatchMetadata: typeof import('../src/lib/dispatch-contract').parseDispatchMetadata;
let validateDispatchMetadata: typeof import('../src/lib/dispatch-contract').validateDispatchMetadata;
let getTask: typeof import('../src/app/api/tasks/[id]/route').GET;
let patchTask: typeof import('../src/app/api/tasks/[id]/route').PATCH;

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
  projectWorkspaceMappings = syncModule.GITHUB_PROJECT_WORKSPACE_MAPPINGS;
  parseDispatchMetadata = dispatchContract.parseDispatchMetadata;
  validateDispatchMetadata = dispatchContract.validateDispatchMetadata;
  const taskRoute = await import('../src/app/api/tasks/[id]/route');
  getTask = taskRoute.GET;
  patchTask = taskRoute.PATCH;
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
  assert.equal(metadata?.risk_level, 'medium');
  assert.equal(metadata?.readiness, 'ready_for_agent');
  assert.deepEqual(metadata?.acceptance_criteria, [
    'Existing imported tasks receive repaired dispatch metadata.',
    'Status is not churned backward when the task is already active.',
  ]);
  // allowed_file_scope, safety_rules and review_mode are local-owned: sync
  // never writes them, even into an empty local value, and shows the upstream
  // difference as drift (docs/SYNC_FIELD_AUTHORITY.md section 7, T12).
  assert.equal(metadata?.allowed_file_scope, undefined);
  assert.equal(metadata?.safety_rules, undefined);
  assert.equal(metadata?.review_mode, undefined);
  assert.equal(validateDispatchMetadata(metadata).canDispatch, false);
  const driftFields = result.details.filter((detail) => detail.action === 'drift').map((detail) => detail.field);
  assert.deepEqual(driftFields, [
    'dispatch_metadata.allowed_file_scope',
    'dispatch_metadata.review_mode',
    'dispatch_metadata.safety_rules',
  ]);
});

test('targeted GitHub Project sync mutates only one exact issue ref', async () => {
  seedWorkspaceAndTask();
  const issue = (number: number, id: string) => ({
    id,
    isArchived: false,
    content: {
      __typename: 'Issue',
      number,
      title: `Issue ${number}`,
      body: '## Impact\nTargeted sync proof.',
      url: `https://github.com/iMelki/mission-control-kanban/issues/${number}`,
      state: 'OPEN',
      closed: false,
      repository: {
        name: 'mission-control-kanban',
        nameWithOwner: 'iMelki/mission-control-kanban',
        owner: { login: 'iMelki' },
      },
      labels: { nodes: [{ name: 'type:ops' }] },
    },
    fieldValues: { nodes: [{ name: 'Ready', field: { name: 'Status' } }] },
  });

  const result = await syncLoadedGitHubProjectWorkspace(
    'assistants',
    { title: 'Assistants', allItems: [issue(34, 'PVTI_existing'), issue(35, 'PVTI_target')] },
    { dryRun: true, issueRefs: ['iMelki/mission-control-kanban#35'] }
  );

  assert.equal(result.selection, 'targeted');
  assert.deepEqual(result.requested_issue_refs, ['iMelki/mission-control-kanban#35']);
  assert.equal(result.scanned_items, 2);
  assert.equal(result.selected_items, 1);
  assert.equal(result.imported, 1);
  assert.equal(result.updated, 0);
  assert.deepEqual(result.details.map((detail) => detail.issue), ['iMelki/mission-control-kanban#35']);
});

test('every declared GitHub Project workspace mapping is seeded by the migrations', () => {
  resetDb();

  for (const mapping of projectWorkspaceMappings) {
    const row = queryOne<{
      id: string;
      name: string;
      icon: string | null;
      description: string | null;
      github_project_owner: string | null;
      github_project_number: number | null;
      github_project_title: string | null;
      github_project_url: string | null;
      github_project_auto_refresh: number | null;
    }>(
      `SELECT id, name, icon, description, github_project_owner, github_project_number,
              github_project_title, github_project_url, github_project_auto_refresh
       FROM workspaces WHERE slug = ?`,
      [mapping.slug]
    );

    assert.ok(row, `workspace '${mapping.slug}' is declared in code but never seeded by a migration`);
    assert.equal(row.id, mapping.id);
    assert.equal(row.name, mapping.name);
    assert.equal(row.icon, mapping.icon);
    assert.equal(row.description, mapping.description);
    assert.equal(row.github_project_owner, mapping.github_project_owner);
    assert.equal(row.github_project_number, mapping.github_project_number);
    assert.equal(row.github_project_title, mapping.github_project_title);
    assert.equal(row.github_project_url, mapping.github_project_url);
    assert.equal(row.github_project_auto_refresh === 1, mapping.github_project_auto_refresh);
  }
});

test('targeted GitHub Project sync fails closed when the issue ref is missing', async () => {
  seedWorkspaceAndTask();

  await assert.rejects(
    syncLoadedGitHubProjectWorkspace(
      'assistants',
      { title: 'Assistants', allItems: [] },
      { dryRun: true, issueRefs: ['iMelki/mission-control-kanban#35'] }
    ),
    /must match exactly one active Project item; found 0/
  );
});

test('GitHub Project sync preserves locally authored dispatch contract fields when the issue body omits them', async () => {
  seedWorkspaceAndTask();
  const localContract = {
    source_issue_url: 'https://github.com/iMelki/mission-control-kanban/issues/34',
    target_repo: 'iMelki/mission-control-kanban',
    project_workstream: 'local-workstream',
    allowed_file_scope: ['src/lib/dispatch-contract.ts', 'tests/github-project-sync-persistence.test.ts'],
    acceptance_criteria: ['Local acceptance criterion is not cleared by sync'],
    test_requirements: ['npm run test:github-sync'],
    risk_level: 'medium',
    readiness: 'ready_for_agent',
    review_mode: 'human_required',
    impact: 'Local impact statement stays after a body-less resync',
    rollback_plan: 'Revert the local dispatch contract commit.',
    safety_rules: ['Do not clear locally authored contract fields'],
  };
  run(
    `UPDATE tasks SET dispatch_metadata = ?, title = ? WHERE id = ?`,
    [JSON.stringify(localContract), 'Stale imported task', 'task-existing']
  );

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
            title: 'Upstream title should refresh',
            body: 'A short issue body with no dispatch-contract headings.\n\nJust a goal paragraph.',
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
              { name: 'High', field: { name: 'Priority' } },
              { name: 'upstream-workstream', field: { name: 'Project' } },
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
  assert.equal(result.status_reconciled, 0);

  const row = queryOne<{ title: string; status: string; priority: string; dispatch_metadata: string }>(
    'SELECT title, status, priority, dispatch_metadata FROM tasks WHERE id = ?',
    ['task-existing']
  );
  assert.equal(row?.title, 'Upstream title should refresh');
  assert.equal(row?.status, 'in_progress');
  assert.equal(row?.priority, 'high');
  const metadata = parseDispatchMetadata(row?.dispatch_metadata);
  assert.equal(metadata?.source_issue_url, localContract.source_issue_url);
  assert.equal(metadata?.target_repo, 'iMelki/mission-control-kanban');
  // Local once set: the Project value never replaces it (T21).
  assert.equal(metadata?.project_workstream, 'local-workstream');
  assert.deepEqual(metadata?.allowed_file_scope, localContract.allowed_file_scope);
  assert.deepEqual(metadata?.acceptance_criteria, localContract.acceptance_criteria);
  assert.deepEqual(metadata?.test_requirements, localContract.test_requirements);
  assert.equal(metadata?.rollback_plan, localContract.rollback_plan);
  assert.deepEqual(metadata?.safety_rules, localContract.safety_rules);
  assert.equal(metadata?.impact, localContract.impact);
  assert.equal(metadata?.readiness, 'ready_for_agent');
  assert.equal(metadata?.review_mode, 'human_required');
  assert.equal(metadata?.risk_level, 'medium');
  assert.equal(validateDispatchMetadata(metadata).canDispatch, true);
});

// Generated Allowed File Scope defaults as live rows can hold them in an
// array: the projects-ops default already split on commas by the old
// normalizer, and the MemSys default kept as one item.
const LEGACY_SPLIT_PROJECTS_OPS_SCOPE = [
  'Owning repo issue',
  'docs',
  'scripts',
  'and tests named by the task.',
];
const MEMSYS_SCOPE_DEFAULT = 'Owning repo issue; docs; scripts; and tests named by the task';

function completeContractWithScope(allowedFileScope: unknown) {
  return {
    source_issue_url: 'https://github.com/iMelki/mission-control-kanban/issues/34',
    target_repo: 'iMelki/mission-control-kanban',
    project_workstream: 'local-workstream',
    allowed_file_scope: allowedFileScope,
    acceptance_criteria: ['Local acceptance criterion stays'],
    test_requirements: ['npm run test:github-sync'],
    risk_level: 'medium',
    readiness: 'ready_for_agent',
    review_mode: 'human_required',
    impact: 'Local impact statement stays',
    rollback_plan: 'Revert the local dispatch contract commit.',
    safety_rules: ['Do not widen factory allowed paths from GitHub'],
  };
}

function taskRouteContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function patchTaskDispatchMetadata(id: string, dispatchMetadata: unknown) {
  const response = await patchTask(
    new NextRequest(`http://127.0.0.1/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dispatch_metadata: dispatchMetadata }),
    }),
    taskRouteContext(id),
  );
  assert.equal(response.status, 200);
  return response.json() as Promise<{ dispatch_metadata?: { allowed_file_scope?: string[] }; dispatch_ready: boolean }>;
}

test('task API strips array-form generated scope placeholders and keeps a bare docs scope', async () => {
  seedWorkspaceAndTask();

  for (const placeholderScope of [
    LEGACY_SPLIT_PROJECTS_OPS_SCOPE,
    [MEMSYS_SCOPE_DEFAULT],
    [MEMSYS_SCOPE_DEFAULT.toUpperCase()],
    ['Owning repo issue', 'docs', 'scripts', 'and tests named by the task'],
  ]) {
    const patched = await patchTaskDispatchMetadata('task-existing', completeContractWithScope(placeholderScope));
    assert.equal(patched.dispatch_metadata?.allowed_file_scope, undefined, JSON.stringify(placeholderScope));
    assert.equal(patched.dispatch_ready, false);

    const fetched = await getTask(new NextRequest('http://127.0.0.1/api/tasks/task-existing'), taskRouteContext('task-existing'));
    const body = await fetched.json() as { dispatch_metadata?: { allowed_file_scope?: string[] }; dispatch_ready: boolean };
    assert.equal(body.dispatch_metadata?.allowed_file_scope, undefined);
    assert.equal(body.dispatch_ready, false);
  }

  const superstring = await patchTaskDispatchMetadata(
    'task-existing',
    completeContractWithScope([...LEGACY_SPLIT_PROJECTS_OPS_SCOPE, 'src/**']),
  );
  assert.deepEqual(superstring.dispatch_metadata?.allowed_file_scope, ['src/**']);

  for (const realScope of [['docs'], ['scripts'], ['docs', 'scripts']]) {
    const patched = await patchTaskDispatchMetadata('task-existing', completeContractWithScope(realScope));
    assert.deepEqual(patched.dispatch_metadata?.allowed_file_scope, realScope);
    assert.equal(patched.dispatch_ready, true);
  }
});

test('stored task row with a legacy split scope placeholder heals on read and on rewrite', async () => {
  seedWorkspaceAndTask();
  run(
    'UPDATE tasks SET dispatch_metadata = ? WHERE id = ?',
    [JSON.stringify(completeContractWithScope(LEGACY_SPLIT_PROJECTS_OPS_SCOPE)), 'task-existing'],
  );

  const legacyRow = queryOne<{ dispatch_metadata: string }>(
    'SELECT dispatch_metadata FROM tasks WHERE id = ?',
    ['task-existing'],
  );
  const healed = parseDispatchMetadata(legacyRow?.dispatch_metadata);
  assert.equal(healed?.allowed_file_scope, undefined);
  assert.equal(validateDispatchMetadata(healed).canDispatch, false);
  assert.ok(validateDispatchMetadata(healed).missingFields.includes('allowed file scope'));

  // Writing the normalized contract back stores no placeholder tokens.
  await patchTaskDispatchMetadata('task-existing', JSON.parse(legacyRow!.dispatch_metadata));
  const rewritten = queryOne<{ dispatch_metadata: string }>(
    'SELECT dispatch_metadata FROM tasks WHERE id = ?',
    ['task-existing'],
  );
  const stored = JSON.parse(rewritten!.dispatch_metadata) as Record<string, unknown>;
  assert.equal(stored.allowed_file_scope, undefined);
  assert.doesNotMatch(rewritten!.dispatch_metadata, /Owning repo issue|"docs"|"scripts"|named by the task/);
  assert.equal(stored.target_repo, 'iMelki/mission-control-kanban');

  // A real bare docs scope stored in a row survives the same read.
  run(
    'UPDATE tasks SET dispatch_metadata = ? WHERE id = ?',
    [JSON.stringify(completeContractWithScope(['docs'])), 'task-existing'],
  );
  const docsRow = queryOne<{ dispatch_metadata: string }>(
    'SELECT dispatch_metadata FROM tasks WHERE id = ?',
    ['task-existing'],
  );
  assert.deepEqual(parseDispatchMetadata(docsRow?.dispatch_metadata)?.allowed_file_scope, ['docs']);
});

function syncItemWithBody(body: string) {
  return {
    id: 'PVTI_existing',
    isArchived: false,
    content: {
      __typename: 'Issue',
      number: 34,
      title: 'Refreshed title',
      body,
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
      nodes: [{ name: 'Ready for Agent', field: { name: 'Status' } }],
    },
  };
}

test('GitHub refresh rewrites a legacy split scope placeholder row and lets upstream fill it', async () => {
  // Body without an Allowed File Scope section: the stored row is rewritten
  // without the placeholder and the card is not dispatch-ready.
  seedWorkspaceAndTask();
  run(
    'UPDATE tasks SET dispatch_metadata = ? WHERE id = ?',
    [JSON.stringify(completeContractWithScope(LEGACY_SPLIT_PROJECTS_OPS_SCOPE)), 'task-existing'],
  );
  const emptyScopeResult = await syncLoadedGitHubProjectWorkspace(
    'assistants',
    { title: 'Assistants', allItems: [syncItemWithBody('A goal paragraph with no contract headings.')] },
    { dryRun: false },
  );
  assert.equal(emptyScopeResult.updated, 1);
  const emptyScopeRow = queryOne<{ dispatch_metadata: string }>(
    'SELECT dispatch_metadata FROM tasks WHERE id = ?',
    ['task-existing'],
  );
  assert.equal((JSON.parse(emptyScopeRow!.dispatch_metadata) as Record<string, unknown>).allowed_file_scope, undefined);
  assert.doesNotMatch(emptyScopeRow!.dispatch_metadata, /Owning repo issue|"docs"|"scripts"|named by the task/);
  assert.equal(validateDispatchMetadata(parseDispatchMetadata(emptyScopeRow?.dispatch_metadata)).canDispatch, false);

  // Repaired body with a real scope: the placeholder-only local key is
  // filled from upstream even though allowed_file_scope is local-only.
  run(
    'UPDATE tasks SET dispatch_metadata = ? WHERE id = ?',
    [JSON.stringify(completeContractWithScope([MEMSYS_SCOPE_DEFAULT])), 'task-existing'],
  );
  const repairedResult = await syncLoadedGitHubProjectWorkspace(
    'assistants',
    {
      title: 'Assistants',
      allItems: [syncItemWithBody('## Allowed File Scope\n- src/lib/dispatch-contract.ts\n- docs')],
    },
    { dryRun: false },
  );
  assert.equal(repairedResult.updated, 1);
  const repairedRow = queryOne<{ dispatch_metadata: string }>(
    'SELECT dispatch_metadata FROM tasks WHERE id = ?',
    ['task-existing'],
  );
  const repaired = parseDispatchMetadata(repairedRow?.dispatch_metadata);
  // Repaired body with a real scope: allowed_file_scope is local-owned (T12),
  // so sync never writes it from upstream, and shows the upstream difference as drift.
  assert.equal(repaired?.allowed_file_scope, undefined);
  assert.equal(validateDispatchMetadata(repaired).canDispatch, false);
});
