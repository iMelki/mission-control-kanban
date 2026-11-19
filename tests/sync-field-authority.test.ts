/**
 * docs/SYNC_FIELD_AUTHORITY.md section 10 (T1-T9) plus the Step 2 rulings
 * from CTO on 2026-11-19 14:41 IST: tombstones on both write paths, merged
 * github_source on sync, evidence for Done and Review, the write-back Status
 * guard, Needs Grooming imports, local-owned security keys (CTO ruling
 * 14:49 IST), and T10-T21 from the fa1e7f9f doc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-sync-authority-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'mission-control-test.db');

type DbModule = typeof import('../src/lib/db');
type SyncModule = typeof import('../src/lib/github-project-sync');
type ContractModule = typeof import('../src/lib/dispatch-contract');
type TombstoneModule = typeof import('../src/lib/field-tombstones');
type WritebackModule = typeof import('../src/lib/github-writeback');
type TaskRouteModule = typeof import('../src/app/api/tasks/[id]/route');
type WritebackRouteModule = typeof import('../src/app/api/tasks/[id]/github-writeback/route');
type TaskImportModule = typeof import('../src/lib/github-task-import');

let db: DbModule;
let sync: SyncModule;
let contract: ContractModule;
let tombstones: TombstoneModule;
let writeback: WritebackModule;
let taskRoute: TaskRouteModule;
let writebackRoute: WritebackRouteModule;
let taskImport: TaskImportModule;

const ISSUE_URL = 'https://github.com/iMelki/mission-control-kanban/issues/34';
const ISSUE_REF = 'iMelki/mission-control-kanban#34';

const LOCAL_CONTRACT = {
  source_issue_url: ISSUE_URL,
  target_repo: 'iMelki/mission-control-kanban',
  project_workstream: 'Assistants',
  allowed_file_scope: ['src/lib/dispatch-contract.ts', 'tests/sync-field-authority.test.ts'],
  acceptance_criteria: ['Local acceptance criterion is never silently cleared'],
  test_requirements: ['npm run test:github-sync'],
  risk_level: 'medium',
  readiness: 'ready_for_agent',
  review_mode: 'human_required',
  impact: 'Local impact statement stays',
  rollback_plan: 'Revert the local dispatch contract commit.',
  safety_rules: ['Do not clear locally authored contract fields'],
};

function resetDb() {
  db.closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${process.env.DATABASE_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

test.before(async () => {
  db = await import('../src/lib/db');
  sync = await import('../src/lib/github-project-sync');
  contract = await import('../src/lib/dispatch-contract');
  tombstones = await import('../src/lib/field-tombstones');
  writeback = await import('../src/lib/github-writeback');
  taskRoute = await import('../src/app/api/tasks/[id]/route');
  writebackRoute = await import('../src/app/api/tasks/[id]/github-writeback/route');
  taskImport = await import('../src/lib/github-task-import');
});

test.after(() => {
  resetDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seed(options: { status?: string; metadata?: Record<string, unknown>; description?: string } = {}) {
  resetDb();
  const now = '2026-11-19T10:00:00.000Z';
  db.run(
    `INSERT OR REPLACE INTO workspaces (
       id, name, slug, description, icon, github_project_owner, github_project_number,
       github_project_title, github_project_url, github_project_auto_refresh, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['assistants', 'Assistants', 'assistants', 'Operator cockpit mapped to GitHub Project #13.', 'A',
      'iMelki', 13, 'Assistants', 'https://github.com/users/iMelki/projects/13', 1, now, now],
  );
  db.run(
    `INSERT INTO tasks (
       id, title, description, status, priority, workspace_id, business_id,
       source_repo_owner, source_repo_name, source_issue_number, source_issue_url,
       source_project_item_id, dispatch_metadata, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['task-existing', 'Existing card', options.description ?? 'Local description', options.status ?? 'in_progress',
      'normal', 'assistants', 'default', 'iMelki', 'mission-control-kanban', 34, ISSUE_URL, 'PVTI_existing',
      JSON.stringify(options.metadata ?? LOCAL_CONTRACT), now, now],
  );
}

interface ItemOptions {
  id?: string | null;
  number?: number;
  body?: string;
  closed?: boolean;
  fields?: Array<{ name: string; field: string }>;
}

function issueItem(options: ItemOptions = {}) {
  const number = options.number ?? 34;
  return {
    id: options.id === undefined ? 'PVTI_existing' : options.id,
    isArchived: false,
    content: {
      __typename: 'Issue',
      number,
      title: `Issue ${number}`,
      body: options.body ?? 'A goal paragraph with no contract headings.',
      url: `https://github.com/iMelki/mission-control-kanban/issues/${number}`,
      state: options.closed ? 'CLOSED' : 'OPEN',
      closed: Boolean(options.closed),
      repository: {
        name: 'mission-control-kanban',
        nameWithOwner: 'iMelki/mission-control-kanban',
        owner: { login: 'iMelki' },
      },
      labels: { nodes: [] },
    },
    fieldValues: {
      nodes: (options.fields ?? [{ name: 'In Progress', field: 'Status' }])
        .map((value) => ({ name: value.name, field: { name: value.field } })),
    },
  };
}

function pullRequestItem(options: { number: number; baseRefName: string; merged: boolean; closes: number }) {
  return {
    id: `PVTI_pr_${options.number}`,
    isArchived: false,
    content: {
      __typename: 'PullRequest',
      number: options.number,
      title: `PR ${options.number}`,
      url: `https://github.com/iMelki/mission-control-kanban/pull/${options.number}`,
      state: options.merged ? 'MERGED' : 'OPEN',
      merged: options.merged,
      baseRefName: options.baseRefName,
      repository: { nameWithOwner: 'iMelki/mission-control-kanban' },
      closingIssuesReferences: {
        nodes: [{ number: options.closes, repository: { nameWithOwner: 'iMelki/mission-control-kanban' } }],
      },
    },
    fieldValues: { nodes: [] },
  };
}

async function runSync(items: any[], options: { dryRun?: boolean; syncRunId?: string; readAt?: string } = {}) {
  return sync.syncLoadedGitHubProjectWorkspace('assistants', { title: 'Assistants', allItems: items }, {
    dryRun: options.dryRun ?? false,
    syncRunId: options.syncRunId,
    readAt: options.readAt,
  });
}

function taskRow() {
  return db.queryOne<{
    status: string;
    description: string | null;
    dispatch_metadata: string | null;
    source_project_item_id: string | null;
  }>('SELECT status, description, dispatch_metadata, source_project_item_id FROM tasks WHERE id = ?', ['task-existing']);
}

function storedMetadata() {
  return contract.parseDispatchMetadata(taskRow()?.dispatch_metadata);
}

function tombstoneCount(): number {
  return db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM task_field_tombstones')?.n ?? 0;
}

async function patchTask(body: Record<string, unknown>) {
  const { NextRequest } = await import('next/server');
  return taskRoute.PATCH(
    new NextRequest('http://mck.test/api/tasks/task-existing', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'task-existing' }) },
  );
}

// ---------------------------------------------------------------- T1 / T2 / T3

test('T1 clear->tombstone: PATCH /api/tasks/[id] clearing a contract field writes one tombstone', async () => {
  seed();
  const { allowed_file_scope: _cleared, ...rest } = LOCAL_CONTRACT;
  const response = await patchTask({ dispatch_metadata: rest });
  assert.equal(response.status, 200);

  assert.equal(storedMetadata()?.allowed_file_scope, undefined);
  const rows = tombstones.listTaskFieldTombstones('task-existing');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, 'dispatch_metadata.allowed_file_scope');
  assert.deepEqual(rows[0].old_value, LOCAL_CONTRACT.allowed_file_scope);
  assert.equal(rows[0].source, 'mck:user');
  assert.match(rows[0].cleared_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  const payload = await response.json() as { field_tombstones: Array<{ field: string }> };
  assert.equal(payload.field_tombstones.length, 1);
});

test('T1 clear->tombstone: PATCH clearing the body and a github_source subfield records the agent as source', async () => {
  seed();
  const response = await patchTask({
    description: '',
    github_source: {
      repo_owner: 'iMelki',
      repo_name: 'mission-control-kanban',
      issue_number: 34,
      issue_url: ISSUE_URL,
    },
    updated_by_agent_id: 'agent-7',
  });
  assert.equal(response.status, 200);
  const rows = tombstones.listTaskFieldTombstones('task-existing');
  assert.deepEqual(rows.map((row) => row.field).sort(), ['description', 'github_source.project_item_id']);
  assert.ok(rows.every((row) => row.source === 'agent:agent-7'));
  assert.equal(rows.find((row) => row.field === 'github_source.project_item_id')?.old_value, 'PVTI_existing');
});

test('T1 clear->tombstone: explicit upstream MCK-CLEAR clears in the sync transaction with a tombstone', async () => {
  seed();
  const result = await runSync([
    issueItem({ body: '## Test Requirements\nMCK-CLEAR\n\n## Impact\nLocal impact statement stays' }),
  ], { syncRunId: 'run-t1' });

  assert.deepEqual(result.errors, []);
  assert.equal(result.tombstones, 1);
  assert.equal(storedMetadata()?.test_requirements, undefined);
  const rows = tombstones.listTaskFieldTombstones('task-existing');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, 'dispatch_metadata.test_requirements');
  assert.deepEqual(rows[0].old_value, LOCAL_CONTRACT.test_requirements);
  assert.equal(rows[0].source, `github:${ISSUE_REF}`);
  assert.equal(rows[0].sync_run_id, 'run-t1');
});

test('T2 clear without tombstone is refused and leaves the value', () => {
  seed();
  const before = { dispatch_metadata: storedMetadata() };
  const after = { dispatch_metadata: { ...LOCAL_CONTRACT, rollback_plan: undefined } as never };

  for (const attempt of [
    { source: undefined, allowedFields: undefined },
    // The sync path: a tombstone source, but the clear did not come from an
    // explicit upstream signal.
    { source: { source: `github:${ISSUE_REF}`, sync_run_id: 'run-t2' }, allowedFields: new Set<string>() },
  ]) {
    assert.throws(
      () => db.transaction(() => {
        tombstones.recordFieldClears({
          taskId: 'task-existing',
          before,
          after,
          source: attempt.source,
          allowedFields: attempt.allowedFields,
          context: 'T2',
        });
        db.run('UPDATE tasks SET dispatch_metadata = ? WHERE id = ?', [
          contract.serializeDispatchMetadata(after.dispatch_metadata),
          'task-existing',
        ]);
      }),
      (error: unknown) => error instanceof tombstones.SilentClearRefusedError
        && error.fields.includes('dispatch_metadata.rollback_plan'),
    );
    assert.equal(storedMetadata()?.rollback_plan, LOCAL_CONTRACT.rollback_plan);
    assert.equal(tombstoneCount(), 0);
  }
});

test('T3 tombstone is kept through later refreshes, cannot be edited or deleted, and is on the task read', async () => {
  seed();
  const { impact: _cleared, ...rest } = LOCAL_CONTRACT;
  await patchTask({ dispatch_metadata: rest });
  assert.equal(tombstoneCount(), 1);

  await runSync([issueItem()]);
  await runSync([issueItem({ body: '## Impact\nRestored upstream impact' })]);
  assert.equal(storedMetadata()?.impact, 'Restored upstream impact', 'restoring after a tombstone is a normal write');
  assert.equal(tombstoneCount(), 1);

  assert.throws(() => db.run('DELETE FROM task_field_tombstones'), /append-only/);
  assert.throws(() => db.run("UPDATE task_field_tombstones SET source = 'x'"), /append-only/);

  const { NextRequest } = await import('next/server');
  const response = await taskRoute.GET(new NextRequest('http://mck.test/api/tasks/task-existing'), {
    params: Promise.resolve({ id: 'task-existing' }),
  });
  const payload = await response.json() as { field_tombstones: Array<{ field: string; old_value: unknown }> };
  assert.equal(payload.field_tombstones.length, 1);
  assert.equal(payload.field_tombstones[0].field, 'dispatch_metadata.impact');
  assert.equal(payload.field_tombstones[0].old_value, LOCAL_CONTRACT.impact);
});

// ---------------------------------------------------------------- T4 / T5 / T6

test('T4 empty upstream leaves local value (persisted through syncLoadedGitHubProjectWorkspace)', async () => {
  seed();
  const emptyBody = [
    '## Allowed File Scope',
    '',
    '## Acceptance Criteria',
    '   ',
    '## Test Requirements',
    '- ',
    '- [ ] ',
    '## Rollback / Fallback Plan',
    '',
    '## Safety Rules',
    '',
  ].join('\n');
  const result = await runSync([
    issueItem({
      body: emptyBody,
      fields: [
        { name: 'In Progress', field: 'Status' },
        { name: '   ', field: 'Impact' },
        { name: ' ; ', field: 'Allowed File Scope' },
        { name: ',  ,', field: 'Safety Rules' },
      ],
    }),
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.tombstones, 0);
  const metadata = storedMetadata();
  for (const key of ['allowed_file_scope', 'acceptance_criteria', 'test_requirements', 'rollback_plan', 'safety_rules', 'impact'] as const) {
    assert.deepEqual(metadata?.[key], LOCAL_CONTRACT[key], `${key} kept`);
  }
  assert.equal(metadata?.readiness, 'ready_for_agent');
  assert.equal(tombstoneCount(), 0);
});

test('T4 empty upstream leaves local value: missing, null, whitespace, [] and all-empty arrays (merge helper)', () => {
  for (const upstream of [undefined, null, '', '   ', [], ['', '  '], [null]]) {
    const merged = contract.mergeDispatchMetadataFromUpstream(
      LOCAL_CONTRACT as never,
      { acceptance_criteria: upstream, rollback_plan: upstream } as never,
    );
    assert.deepEqual(merged?.acceptance_criteria, LOCAL_CONTRACT.acceptance_criteria);
    assert.equal(merged?.rollback_plan, LOCAL_CONTRACT.rollback_plan);
  }
});

test('T13 a missing or empty upstream project_item_id never blanks the local one (persisted sync UPDATE)', async () => {
  for (const id of [null, '']) {
    seed();
    const result = await runSync([issueItem({ id })]);
    assert.deepEqual(result.errors, []);
    assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing', `item id ${JSON.stringify(id)}`);
    assert.equal(tombstoneCount(), 0);
  }
});

test('T5 placeholder never overwrites: every placeholder shape leaves the local value and writes no tombstone', async () => {
  const scope = 'Owning repo issue, docs, scripts, and tests named by the task.';
  const acceptance = [
    'Issue is present on the mapped GitHub Project.',
    'Required dispatch fields are populated for MCK import.',
  ];
  const shapes: Array<{ name: string; body: string; fields?: Array<{ name: string; field: string }> }> = [
    { name: 'single item', body: `## Allowed File Scope\n${scope}` },
    { name: 'semicolon join', body: '', fields: [{ name: acceptance.join('; '), field: 'Acceptance Criteria' }] },
    { name: 'LF join', body: `## Acceptance Criteria\n${acceptance.join('\n')}` },
    { name: 'CRLF join', body: `## Acceptance Criteria\r\n${acceptance.join('\r\n')}` },
    { name: 'first item only', body: `## Acceptance Criteria\n- ${acceptance[0]}` },
    { name: 'comma pieces', body: '', fields: [{ name: scope, field: 'Allowed File Scope' }] },
  ];

  for (const shape of shapes) {
    seed();
    const result = await runSync([
      issueItem({ body: shape.body || 'Goal only.', fields: [{ name: 'In Progress', field: 'Status' }, ...(shape.fields ?? [])] }),
    ]);
    assert.deepEqual(result.errors, [], shape.name);
    const metadata = storedMetadata();
    assert.deepEqual(metadata?.allowed_file_scope, LOCAL_CONTRACT.allowed_file_scope, shape.name);
    assert.deepEqual(metadata?.acceptance_criteria, LOCAL_CONTRACT.acceptance_criteria, shape.name);
    assert.equal(tombstoneCount(), 0, shape.name);
  }
});

test('T6 placeholder-only is not dispatchable on a persisted card', () => {
  seed({ metadata: { ...LOCAL_CONTRACT, allowed_file_scope: ['Owning repo issue', 'and tests named by the task.'] } });
  const validation = contract.validateDispatchMetadata(storedMetadata());
  assert.equal(validation.canDispatch, false);
  assert.ok(validation.missingFields.includes('allowed file scope'));
});

// ---------------------------------------------------------------- T7 (write-back)

interface RecordedCall {
  url: string;
  method: string;
  body: string;
}

type EvidenceNode = { url?: string; merged?: boolean; baseRefName?: string };

async function withMockedGitHub<T>(
  fn: (calls: RecordedCall[]) => Promise<T>,
  options: { evidenceNodes?: EvidenceNode[] } = {},
): Promise<T> {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GH_GENERAL_TOKEN;
  process.env.GH_GENERAL_TOKEN = 'test-token-not-a-secret';
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/graphql')) {
      if (body.includes('WritebackStatusEvidence')) {
        return json({ data: { repository: { issue: { closedByPullRequestsReferences: { nodes: options.evidenceNodes ?? [] } } } } });
      }
      if (body.includes('ResolveProjectItem')) {
        return json({
          data: {
            node: {
              id: 'PVTI_existing',
              project: {
                id: 'PVT_13',
                fields: {
                  nodes: [
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      id: 'F_status',
                      name: 'Status',
                      dataType: 'SINGLE_SELECT',
                      options: [
                        { id: 'OPT_done', name: 'Done' },
                        { id: 'OPT_review', name: 'Review' },
                        { id: 'OPT_progress', name: 'In Progress' },
                      ],
                    },
                    { __typename: 'ProjectV2Field', id: 'F_agent', name: 'Agent', dataType: 'TEXT' },
                  ],
                },
              },
            },
          },
        });
      }
      return json({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_existing' } } } });
    }
    return json({ id: 1 });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GH_GENERAL_TOKEN;
    else process.env.GH_GENERAL_TOKEN = previousToken;
  }
}

function writebackSnapshot(status: 'done' | 'review' | 'in_progress', evidence?: never[] | Array<Record<string, unknown>>) {
  return {
    id: 'task-existing',
    title: 'Existing card',
    status,
    assigned_agent_name: 'Dev',
    github_source: {
      repo_owner: 'iMelki',
      repo_name: 'mission-control-kanban',
      issue_number: 34,
      issue_url: ISSUE_URL,
      project_item_id: 'PVTI_existing',
    },
    dispatch_metadata: { readiness: 'ready_for_agent' as const },
    dispatch_blockers: [],
    status_evidence: evidence as never,
  };
}

function statusMutations(calls: RecordedCall[]): string[] {
  return calls
    .filter((call) => call.url.endsWith('/graphql') && call.body.includes('UpdateProjectField'))
    .flatMap((call) => {
      const variables = (JSON.parse(call.body) as { variables?: { fieldId?: string; optionId?: string } }).variables;
      return variables?.fieldId === 'F_status' && variables.optionId ? [variables.optionId] : [];
    });
}

test('T7 local Done never closes an issue and never promotes Project Status without evidence', async () => {
  await withMockedGitHub(async (calls) => {
    for (const status of ['done', 'review'] as const) {
      calls.length = 0;
      const snapshot = writebackSnapshot(status);
      const plan = await writeback.planGitHubWriteback(snapshot);
      const statusUpdate = plan.project_updates.find((update) => update.field_name === 'Status');
      assert.equal(statusUpdate?.skipped, true, `${status}: Status update refused`);
      assert.equal(statusUpdate?.reason, writeback.WRITEBACK_STATUS_REFUSAL_REASON);

      await writeback.applyGitHubWriteback(snapshot, plan);
      assert.deepEqual(statusMutations(calls), [], `${status}: no Status mutation was sent`);
      // No issue close call and no issue state change of any kind.
      for (const call of calls) {
        assert.ok(!(call.method === 'PATCH' && /\/issues\/34$/.test(call.url)), `${status}: no issue PATCH`);
        assert.ok(!/"state"\s*:/.test(call.body), `${status}: no state change in ${call.url}`);
        assert.ok(!/closeIssue/.test(call.body), `${status}: no closeIssue mutation`);
      }
      // The Agent field still writes, so the guard is narrow.
      assert.ok(calls.some((call) => call.body.includes('F_agent')));
    }
  });
});

test('T10 Done or Review write-back without evidence is refused in buildDesiredProjectUpdates; dev merge refused, main merge allowed', () => {
  const refused = writeback.buildDesiredProjectUpdates(writebackSnapshot('done', [
    { kind: 'merged_pr', base_ref: 'dev', merged: true },
  ]));
  assert.equal(refused[0].field_name, 'Status');
  assert.equal(refused[0].skipped, true);

  const allowed = writeback.buildDesiredProjectUpdates(writebackSnapshot('done', [
    { kind: 'merged_pr', base_ref: 'main', merged: true },
  ]));
  assert.equal(allowed[0].skipped, undefined);
  assert.equal(allowed[0].value, 'Done');

  const nonPromoting = writeback.buildDesiredProjectUpdates(writebackSnapshot('in_progress'));
  assert.equal(nonPromoting[0].skipped, undefined);
  assert.equal(nonPromoting[0].value, 'In Progress');
});

// ---------------------------------------------------------------- T8 and evidence

test('T8 dev-only merge never moves to Done or Review: Project item at Done whose only evidence is a dev merge', async () => {
  seed({ status: 'in_progress' });
  const result = await runSync([
    issueItem({ fields: [{ name: 'Done', field: 'Status' }] }),
    pullRequestItem({ number: 501, baseRefName: 'dev', merged: true, closes: 34 }),
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(taskRow()?.status, 'in_progress');
  assert.equal(result.status_reconciled, 0);
  assert.equal(result.needs_evidence, 1);
  assert.ok(result.details.some((detail) => detail.action === 'status_reconcile' && /Needs evidence/.test(detail.reason ?? '')));
  const flags = db.queryOne<{ sync_flags: string }>("SELECT sync_flags FROM tasks WHERE id = 'task-existing'");
  assert.match(JSON.parse(flags?.sync_flags ?? '{}').needs_evidence ?? '', /Needs evidence/);
  const event = db.queryOne<{ message: string }>(
    "SELECT message FROM events WHERE type = 'task_needs_evidence' AND task_id = 'task-existing'",
  );
  assert.match(event?.message ?? '', /Needs evidence/);
  // The PR item never becomes a card.
  assert.equal(db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')?.n, 1);
});

test('T11 with a linked main merge PR the card moves to Done', async () => {
  seed({ status: 'in_progress' });
  const result = await runSync([
    issueItem({ fields: [{ name: 'Done', field: 'Status' }] }),
    pullRequestItem({ number: 502, baseRefName: 'main', merged: true, closes: 34 }),
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(taskRow()?.status, 'done');
  assert.equal(result.needs_evidence, 0);
});

test('T11 Project Done without evidence keeps the column and flags needs evidence', () => {
  const reconciliation = sync.reconcileGitHubProjectStatus({ currentStatus: 'testing', projectStatus: 'Done' });
  assert.equal(reconciliation.local_status, undefined);
  assert.equal(reconciliation.needs_evidence, true);
  assert.match(reconciliation.drift_warning ?? '', /^Needs evidence: GitHub Project Status is Done/);
});

test('T11 Project Review without evidence keeps the column and flags needs evidence', () => {
  const reconciliation = sync.reconcileGitHubProjectStatus({ currentStatus: 'in_progress', projectStatus: 'Review' });
  assert.equal(reconciliation.local_status, undefined);
  assert.equal(reconciliation.needs_evidence, true);
  assert.match(reconciliation.drift_warning ?? '', /^Needs evidence: GitHub Project Status is Review/);

  const devOnly = sync.reconcileGitHubProjectStatus({
    currentStatus: 'in_progress',
    projectStatus: 'Review',
    evidence: [{ kind: 'merged_pr', base_ref: 'dev', merged: true }],
  });
  assert.equal(devOnly.local_status, undefined);
  assert.equal(devOnly.needs_evidence, true);
});

test('T11 a closed issue without evidence is not moved to Done; a closing comment naming what shipped is evidence', () => {
  const bare = sync.reconcileGitHubProjectStatus({ currentStatus: 'in_progress', issueClosed: true, projectStatus: 'In Progress' });
  assert.equal(bare.local_status, undefined);
  assert.equal(bare.needs_evidence, true);

  const withComment = sync.reconcileGitHubProjectStatus({
    currentStatus: 'in_progress',
    issueClosed: true,
    evidence: [{ kind: 'closing_comment', shipped: 'Shipped in v2.4.0 (#512 merged to main)' }],
  });
  assert.equal(withComment.local_status, 'done');

  // Other columns still follow Project Status.
  assert.equal(sync.reconcileGitHubProjectStatus({ currentStatus: 'planning', projectStatus: 'Ready' }).local_status, 'inbox');
});

// ---------------------------------------------------------------- T9

test('T9 dry run writes no tombstones: it reports would-be tombstones and persists none', async () => {
  seed();
  const result = await runSync([
    issueItem({ body: '## Rollback / Fallback Plan\nMCK-CLEAR' }),
  ], { dryRun: true });

  assert.equal(result.dry_run, true);
  assert.equal(result.tombstones, 1);
  const detail = result.details.find((entry) => entry.action === 'tombstone');
  assert.equal(detail?.field, 'dispatch_metadata.rollback_plan');
  assert.match(detail?.reason ?? '', /dry run; nothing persisted/);
  assert.equal(tombstoneCount(), 0);
  assert.equal(storedMetadata()?.rollback_plan, LOCAL_CONTRACT.rollback_plan);
});

// ---------------------------------------------------------------- imports

test('T14 every open Project issue without a card is imported as Needs Grooming; PRs never become cards', async () => {
  seed();
  const result = await runSync([
    issueItem(),
    issueItem({
      id: 'PVTI_new_1',
      number: 77,
      fields: [
        { name: 'Ready for Agent', field: 'Status' },
        { name: 'Ready for Agent', field: 'Readiness' },
      ],
    }),
    issueItem({ id: 'PVTI_new_2', number: 78, fields: [{ name: 'Todo', field: 'Status' }] }),
    issueItem({ id: 'PVTI_closed', number: 79, closed: true }),
    pullRequestItem({ number: 503, baseRefName: 'main', merged: true, closes: 77 }),
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped_closed, 1);
  assert.ok(result.details.some((detail) => detail.action === 'skip' && /pull request: never a card/.test(detail.reason ?? '')));

  const imported = db.queryAll<{ source_issue_number: number; status: string; dispatch_metadata: string }>(
    "SELECT source_issue_number, status, dispatch_metadata FROM tasks WHERE id != 'task-existing' ORDER BY source_issue_number",
  );
  assert.deepEqual(imported.map((row) => row.source_issue_number), [77, 78]);
  for (const row of imported) {
    assert.equal(row.status, 'inbox');
    const metadata = contract.parseDispatchMetadata(row.dispatch_metadata);
    assert.equal(metadata?.readiness, 'needs_grooming');
    assert.equal(contract.validateDispatchMetadata(metadata).canDispatch, false);
  }
});

// ---------------------------------------------------------------- T11 persisted, T12

test('T11 persisted: Project Review and a closed issue without evidence keep the column, flag the card and log a reconcile entry', async () => {
  for (const item of [
    issueItem({ fields: [{ name: 'Review', field: 'Status' }] }),
    issueItem({ closed: true, fields: [{ name: 'In Progress', field: 'Status' }] }),
  ]) {
    seed({ status: 'in_progress' });
    const result = await runSync([item]);
    assert.deepEqual(result.errors, []);
    assert.equal(taskRow()?.status, 'in_progress');
    assert.equal(result.needs_evidence, 1);
    assert.ok(result.details.some((detail) => detail.action === 'status_reconcile' && /Needs evidence/.test(detail.reason ?? '')));
    assert.ok(db.queryOne("SELECT id FROM events WHERE type = 'task_needs_evidence' AND task_id = 'task-existing'"));
  }
});

test('T12 sync never writes local-owned security keys: a differing upstream value logs drift and changes nothing', async () => {
  seed();
  const before = contract.validateDispatchMetadata(storedMetadata()).canDispatch;
  const result = await runSync([
    issueItem({
      body: '## Allowed File Scope\n- src/**\n- .github/workflows/**\n\n## Safety Rules\n- Anything goes\n\n## Review Mode\nAuto Checks Only',
      fields: [{ name: 'In Progress', field: 'Status' }, { name: 'Auto Checks Only', field: 'Review Mode' }],
    }),
  ]);

  assert.deepEqual(result.errors, []);
  const metadata = storedMetadata();
  assert.deepEqual(metadata?.allowed_file_scope, LOCAL_CONTRACT.allowed_file_scope);
  assert.deepEqual(metadata?.safety_rules, LOCAL_CONTRACT.safety_rules);
  assert.equal(metadata?.review_mode, LOCAL_CONTRACT.review_mode);
  assert.equal(contract.validateDispatchMetadata(metadata).canDispatch, before);

  const driftFields = result.details.filter((detail) => detail.action === 'drift').map((detail) => detail.field).sort();
  assert.deepEqual(driftFields, [
    'dispatch_metadata.allowed_file_scope',
    'dispatch_metadata.review_mode',
    'dispatch_metadata.safety_rules',
  ]);
  const flags = JSON.parse(db.queryOne<{ sync_flags: string }>("SELECT sync_flags FROM tasks WHERE id = 'task-existing'")?.sync_flags ?? '{}');
  assert.equal(flags.drift.length, 3);
  assert.equal(tombstoneCount(), 0);

  // The same value upstream is not drift.
  seed();
  const same = await runSync([
    issueItem({ body: `## Allowed File Scope\n${LOCAL_CONTRACT.allowed_file_scope.map((entry) => `- ${entry}`).join('\n')}` }),
  ]);
  assert.equal(same.details.filter((detail) => detail.action === 'drift').length, 0);
});

test('T12 on import the local-owned keys are not taken from upstream', async () => {
  seed();
  await runSync([
    issueItem({
      id: 'PVTI_new_scope',
      number: 88,
      body: '## Allowed File Scope\n- src/**\n\n## Safety Rules\n- Be careful\n\n## Acceptance Criteria\n- Imported criterion',
      fields: [{ name: 'Todo', field: 'Status' }, { name: 'Pair Review', field: 'Review Mode' }],
    }),
  ]);
  const row = db.queryOne<{ dispatch_metadata: string }>('SELECT dispatch_metadata FROM tasks WHERE source_issue_number = 88');
  const metadata = contract.parseDispatchMetadata(row?.dispatch_metadata);
  assert.equal(metadata?.allowed_file_scope, undefined);
  assert.equal(metadata?.safety_rules, undefined);
  assert.equal(metadata?.review_mode, undefined);
  assert.deepEqual(metadata?.acceptance_criteria, ['Imported criterion']);
  assert.equal(metadata?.readiness, 'needs_grooming');
});

// ---------------------------------------------------------------- T15

test('T15 normalized placeholder variants never overwrite', async () => {
  const variants = [
    'ISSUE IS PRESENT ON THE MAPPED GITHUB PROJECT.',
    '  Issue   is present\ton the mapped   GitHub Project  ',
    'Issue\u00a0is present on the mapped GitHub Project.',
    'Ｉｓｓｕｅ is present on the mapped GitHub Project.',
    '• Issue is present on the mapped GitHub Project.',
    '- Issue is present on the mapped GitHub Project,',
    'Issue is present on the mapped GitHub Project!',
  ];
  for (const variant of variants) {
    assert.equal(contract.isGenericSyncPlaceholder(variant), true, JSON.stringify(variant));
  }
  // 'docs' and 'scripts' are real scopes, not placeholders (kanban#227).
  assert.equal(contract.isGenericSyncPlaceholder('Docs'), false);
  assert.equal(contract.isGenericSyncPlaceholder('scripts.'), false);
  assert.equal(contract.isGenericSyncPlaceholder('OWNING REPO ISSUE.'), true);
  // Real scopes survive: path characters are not punctuation to strip.
  assert.equal(contract.isGenericSyncPlaceholder('docs/'), false);
  assert.equal(contract.isGenericSyncPlaceholder('docs/**'), false);
  assert.equal(contract.isGenericSyncPlaceholder('Issue is present on a different Project.'), false);

  seed();
  const result = await runSync([
    issueItem({ body: `## Acceptance Criteria\n${variants.map((variant) => `- ${variant}`).join('\n')}` }),
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(storedMetadata()?.acceptance_criteria, LOCAL_CONTRACT.acceptance_criteria);
  assert.equal(tombstoneCount(), 0);
});

// ---------------------------------------------------------------- T16

test('T16 concurrent edit and ordering: local edit survives, older read changes nothing, same read twice is idempotent', async () => {
  seed();
  const body = '## Allowed File Scope\n- src/upstream/**\n\n## Impact\nNewer upstream impact';
  // A local edit to a local-owned field after the sync read.
  await patchTask({ dispatch_metadata: { ...LOCAL_CONTRACT, allowed_file_scope: ['src/edited-locally.ts'] } });
  await runSync([issueItem({ body })], { readAt: '2026-11-19T12:00:00.000Z' });
  assert.deepEqual(storedMetadata()?.allowed_file_scope, ['src/edited-locally.ts']);
  assert.equal(storedMetadata()?.impact, 'Newer upstream impact');
  const afterFirst = taskRow();

  // The same read again: same card.
  await runSync([issueItem({ body })], { readAt: '2026-11-19T12:00:00.000Z' });
  assert.deepEqual(
    { ...taskRow(), dispatch_metadata: storedMetadata() },
    { ...afterFirst, dispatch_metadata: contract.parseDispatchMetadata(afterFirst?.dispatch_metadata) },
  );

  // An older read applied after the newer one changes nothing.
  const stale = await runSync([issueItem({ body: '## Impact\nOlder upstream impact', fields: [{ name: 'Review', field: 'Status' }] })], {
    readAt: '2026-11-19T11:00:00.000Z',
  });
  assert.equal(storedMetadata()?.impact, 'Newer upstream impact');
  assert.ok(stale.details.some((detail) => detail.action === 'skip' && /stale read/.test(detail.reason ?? '')));
  assert.equal(stale.updated, 0);
});

// ---------------------------------------------------------------- T17

test('T17 failed or partial read changes nothing: redacted item, truncated page set, failed page', async () => {
  const fullBody = '## Impact\nShould never be applied from a partial read\n\n## Rollback / Fallback Plan\nMCK-CLEAR';
  for (const read of [
    { complete: false, reason: 'page 2 says more pages exist but has no cursor (truncated page set)' },
    { complete: false, reason: 'page 3 failed: HTTP 502' },
  ]) {
    seed();
    const before = taskRow();
    const result = await sync.syncLoadedGitHubProjectWorkspace('assistants', {
      title: 'Assistants',
      allItems: [issueItem({ body: fullBody, fields: [{ name: 'Done', field: 'Status' }] }), issueItem({ id: 'PVTI_new', number: 90 })] as never,
      read,
    }, { dryRun: false });
    assert.equal(result.read_complete, false);
    assert.deepEqual(result.stale_repos, ['iMelki/mission-control-kanban']);
    assert.equal(result.imported + result.updated, 0);
    assert.ok(result.details.some((detail) => detail.action === 'skip' && detail.reason?.includes(read.reason)));
    assert.deepEqual(taskRow(), before);
    assert.equal(tombstoneCount(), 0);
    assert.equal(db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')?.n, 1);
  }

  // A 403 / redacted item: content is null. It changes no card, logs the
  // skip, and marks the board STALE.
  seed();
  const before = taskRow();
  const result = await runSync([{ id: 'PVTI_existing', isArchived: false, content: null, fieldValues: { nodes: [] } }]);
  assert.equal(result.read_complete, false);
  assert.deepEqual(result.stale_repos, ['iMelki/mission-control-kanban']);
  assert.ok(result.details.some((detail) => detail.action === 'skip' && /redacted or inaccessible/.test(detail.reason ?? '')));
  assert.deepEqual(taskRow(), before);
  assert.equal(tombstoneCount(), 0);
});

// ---------------------------------------------------------------- T18

test('T18 a removed item needs two complete reads before it is tombstoned', async () => {
  seed();
  const other = issueItem({ id: 'PVTI_other', number: 91 });

  const first = await runSync([other]);
  assert.equal(first.removed_from_project, 0);
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');
  assert.equal(tombstoneCount(), 0);

  // A partial read in between does not count.
  await sync.syncLoadedGitHubProjectWorkspace('assistants', { title: 'Assistants', allItems: [other] as never, read: { complete: false, reason: 'page 2 failed' } });
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');

  const dry = await runSync([other], { dryRun: true });
  assert.ok(dry.details.some((detail) => detail.action === 'tombstone' && detail.field === 'github_source.project_item_id'));
  assert.equal(tombstoneCount(), 0);

  const second = await runSync([other], { syncRunId: 'run-t18' });
  assert.equal(second.removed_from_project, 1);
  assert.equal(taskRow()?.source_project_item_id, null);
  const rows = tombstones.listTaskFieldTombstones('task-existing');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, 'github_source.project_item_id');
  assert.equal(rows[0].old_value, 'PVTI_existing');
  assert.equal(rows[0].source, 'github:iMelki/projects/13');
  assert.equal(rows[0].sync_run_id, 'run-t18');
  const flags = JSON.parse(db.queryOne<{ sync_flags: string }>("SELECT sync_flags FROM tasks WHERE id = 'task-existing'")?.sync_flags ?? '{}');
  assert.match(flags.removed_from_project, /two consecutive complete reads/);

  // Seen again in between resets the count.
  seed();
  await runSync([other]);
  await runSync([issueItem(), other]);
  await runSync([other]);
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');
});

// ---------------------------------------------------------------- T19

test('T19 Project field beats body; the body only fills an empty key', async () => {
  seed({ metadata: { ...LOCAL_CONTRACT, acceptance_criteria: undefined, test_requirements: undefined } });
  await runSync([
    issueItem({
      body: '## Acceptance Criteria\n- From the body\n\n## Test Requirements\n- Body test requirement',
      fields: [{ name: 'In Progress', field: 'Status' }, { name: 'From the Project field', field: 'Acceptance Criteria' }],
    }),
  ]);
  const metadata = storedMetadata();
  assert.deepEqual(metadata?.acceptance_criteria, ['From the Project field']);
  assert.deepEqual(metadata?.test_requirements, ['Body test requirement']);
});

// ---------------------------------------------------------------- T20

test('T20 a placeholder title or body never replaces the local value', async () => {
  for (const title of ['Untitled GitHub issue', 'Untitled GitHub issue import', '', '   ', null]) {
    seed();
    const item = issueItem({ body: 'Issue is present on the mapped GitHub Project.' });
    (item.content as { title: string | null }).title = title;
    const result = await runSync([item]);
    assert.deepEqual(result.errors, []);
    const row = db.queryOne<{ title: string; description: string }>("SELECT title, description FROM tasks WHERE id = 'task-existing'");
    assert.equal(row?.title, 'Existing card', `title ${JSON.stringify(title)}`);
    assert.equal(row?.description, 'Local description');
  }

  seed();
  await runSync([issueItem({ body: 'A real refreshed body.' })]);
  const refreshed = db.queryOne<{ title: string; description: string }>("SELECT title, description FROM tasks WHERE id = 'task-existing'");
  assert.equal(refreshed?.title, 'Issue 34');
  assert.equal(refreshed?.description, 'A real refreshed body.');
});

// ---------------------------------------------------------------- T21

test('T21 target_repo and project_workstream: a non-empty local value survives a differing injected Repo or Project', async () => {
  seed({ metadata: { ...LOCAL_CONTRACT, target_repo: 'iMelki/local-target', project_workstream: 'Local workstream' } });
  await runSync([issueItem({ fields: [{ name: 'In Progress', field: 'Status' }, { name: 'Other workstream', field: 'Project/Workstream' }] })]);
  const metadata = storedMetadata();
  assert.equal(metadata?.target_repo, 'iMelki/local-target');
  assert.equal(metadata?.project_workstream, 'Local workstream');
});

test('T21 target_repo and project_workstream: an empty local value is filled from upstream', async () => {
  seed({ metadata: { ...LOCAL_CONTRACT, target_repo: undefined, project_workstream: '  ' } });
  await runSync([issueItem()]);
  const metadata = storedMetadata();
  assert.equal(metadata?.target_repo, 'iMelki/mission-control-kanban');
  assert.equal(metadata?.project_workstream, 'Assistants');
});

// ---------------------------------------------------------------- MemSys: Done + placeholder-only contract

function placeholderEvents(): number {
  return db.queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM events WHERE type = 'task_placeholder_contract' AND task_id = 'task-existing'",
  )?.n ?? 0;
}

function syncFlags() {
  return JSON.parse(db.queryOne<{ sync_flags: string | null }>("SELECT sync_flags FROM tasks WHERE id = 'task-existing'")?.sync_flags ?? '{}');
}

const PLACEHOLDER_CONTRACT = {
  ...LOCAL_CONTRACT,
  allowed_file_scope: ['Owning repo issue, docs, scripts, and tests named by the task.'],
  acceptance_criteria: ['Issue is present on the mapped GitHub Project.'],
  test_requirements: ['Run this script in -DryRun mode before broad repair.'],
  rollback_plan:
    'Remove the Project item from the mapped board or set Status=Done if this issue should not be visible in MCK.',
  safety_rules: undefined,
  impact: 'Keeps repository work visible in the mapped operator cockpit and MCK sync.',
  readiness: 'ready_for_agent',
};

test('Done card with a placeholder-only contract: two syncs make zero readiness writes and exactly one log entry; a changed contract logs one more (memsys#114, #561)', async () => {
  assert.equal(contract.isPlaceholderOnlyContract(PLACEHOLDER_CONTRACT as never), true);

  seed({ status: 'done', metadata: PLACEHOLDER_CONTRACT });
  // Upstream says a different readiness; sync must not write it on a Done card.
  const upstream = issueItem({
    closed: true,
    fields: [{ name: 'Done', field: 'Status' }, { name: 'Needs Human', field: 'Readiness' }],
  });

  const dry = await runSync([upstream], { dryRun: true });
  assert.equal(dry.placeholder_contract_drift, 1);
  assert.equal(placeholderEvents(), 0, 'dry run logs nothing');

  const first = await runSync([upstream]);
  assert.deepEqual(first.errors, []);
  assert.equal(taskRow()?.status, 'done');
  assert.equal(storedMetadata()?.readiness, 'ready_for_agent', 'no readiness write on a Done card');
  assert.equal(first.placeholder_contract_drift, 1);
  assert.equal(first.details.filter((detail) => detail.action === 'drift' && detail.field === 'dispatch_metadata').length, 1);
  assert.equal(placeholderEvents(), 1);
  const fingerprint = syncFlags().placeholder_contract?.fingerprint;
  assert.match(fingerprint ?? '', /^fnv1a32:[0-9a-f]{8}$/);

  const second = await runSync([upstream]);
  assert.deepEqual(second.errors, []);
  assert.equal(storedMetadata()?.readiness, 'ready_for_agent', 'still no readiness write');
  assert.equal(second.placeholder_contract_drift, 0, 'not repeated');
  assert.equal(second.details.filter((detail) => detail.field === 'dispatch_metadata').length, 0);
  assert.equal(placeholderEvents(), 1, 'exactly one log entry across two syncs');
  assert.equal(syncFlags().placeholder_contract?.fingerprint, fingerprint);
  assert.equal(tombstoneCount(), 0);

  // The contract changes (a local edit to another placeholder-only contract;
  // an upstream placeholder never overwrites, section 4 rule 1): one new
  // entry, then quiet again.
  await patchTask({
    dispatch_metadata: { ...PLACEHOLDER_CONTRACT, acceptance_criteria: ['Required dispatch fields are populated for MCK import.'] },
  });
  const changed = await runSync([upstream]);
  assert.deepEqual(changed.errors, []);
  assert.equal(changed.placeholder_contract_drift, 1);
  assert.equal(placeholderEvents(), 2);
  assert.notEqual(syncFlags().placeholder_contract?.fingerprint, fingerprint);
  assert.equal(storedMetadata()?.readiness, 'ready_for_agent');

  const again = await runSync([upstream]);
  assert.equal(again.placeholder_contract_drift, 0);
  assert.equal(placeholderEvents(), 2);
});

test('Done cards: sync never writes readiness, and a real contract or a card that is not Done is not flagged', async () => {
  // Done card with a real contract and no readiness: upstream Ready for Agent is not written.
  seed({ status: 'done', metadata: { ...LOCAL_CONTRACT, readiness: undefined } });
  const doneUpstream = issueItem({ closed: true, fields: [{ name: 'Done', field: 'Status' }, { name: 'Ready for Agent', field: 'Readiness' }] });
  const real = await runSync([doneUpstream]);
  assert.deepEqual(real.errors, []);
  assert.equal(storedMetadata()?.readiness, undefined);
  assert.equal(real.placeholder_contract_drift, 0);
  assert.equal(placeholderEvents(), 0);

  // Not Done: readiness still follows upstream (doc section 7), and no placeholder flag.
  seed({ status: 'in_progress', metadata: PLACEHOLDER_CONTRACT });
  const open = await runSync([issueItem({ fields: [{ name: 'In Progress', field: 'Status' }, { name: 'Needs Human', field: 'Readiness' }] })]);
  assert.equal(open.placeholder_contract_drift, 0);
  assert.equal(storedMetadata()?.readiness, 'needs_human');
  assert.equal(placeholderEvents(), 0);
  assert.equal(contract.validateDispatchMetadata(storedMetadata()).canDispatch, false, 'section 4 rule 3 still blocks dispatch');
});

test('T17 a redacted item anywhere in the snapshot stops every write, including sibling issues', async () => {
  seed();
  const before = taskRow();
  const result = await runSync([
    issueItem({ body: '## Impact\nShould not be applied', fields: [{ name: 'Review', field: 'Status' }] }),
    issueItem({ id: 'PVTI_sibling', number: 95 }),
    { id: 'PVTI_redacted', isArchived: false, content: null, fieldValues: { nodes: [] } },
  ]);
  assert.equal(result.read_complete, false);
  assert.equal(result.imported + result.updated, 0);
  assert.deepEqual(taskRow(), before);
  assert.equal(db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')?.n, 1);
  assert.equal(tombstoneCount(), 0);
});

test('T11 an unevidenced close keeps the card in its column even when Project Status maps elsewhere', () => {
  const reconciled = sync.reconcileGitHubProjectStatus({
    currentStatus: 'planning',
    issueClosed: true,
    projectStatus: 'Ready',
    evidence: [],
  });
  assert.equal(reconciled.local_status, undefined);
  assert.equal(reconciled.needs_evidence, true);
});

// ------------------------------------------- kanban#232 CTO review, Medium 1
// docs/SYNC_FIELD_AUTHORITY.md section 5, rules 2 and 6: a mixed upstream
// value keeps its non-placeholder parts. For the scalar keys `impact` and
// `rollback_plan` those parts stay a string, so real text is never dropped.

const IMPACT_PLACEHOLDER = 'Keeps repository work visible in the mapped operator cockpit and MCK sync.';
const ROLLBACK_PLACEHOLDER = 'Remove the Project item from the mapped board or set Status=Done if this issue should not be visible in MCK.';
const MIXED_IMPACT = `${IMPACT_PLACEHOLDER.toUpperCase()}; Captures failed deployment attempts.`;
const MIXED_ROLLBACK = `${ROLLBACK_PLACEHOLDER}\nRevert the deploy-attempt capture commit.`;

function mixedContractItem(id = 'PVTI_existing') {
  return issueItem({
    id,
    body: `## Rollback / Fallback Plan\n${MIXED_ROLLBACK}`,
    fields: [
      { name: 'In Progress', field: 'Status' },
      { name: MIXED_IMPACT, field: 'Impact' },
    ],
  });
}

function seedSecondCard(itemId: string, number: number) {
  const now = '2026-11-19T10:00:00.000Z';
  db.run(
    `INSERT INTO tasks (
       id, title, description, status, priority, workspace_id, business_id,
       source_repo_owner, source_repo_name, source_issue_number, source_issue_url,
       source_project_item_id, dispatch_metadata, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['task-gone', 'Card whose item left the Project', 'Local description', 'in_progress', 'normal', 'assistants', 'default',
      'iMelki', 'mission-control-kanban', number, `https://github.com/iMelki/mission-control-kanban/issues/${number}`,
      itemId, JSON.stringify(LOCAL_CONTRACT), now, now],
  );
}

test('kanban#232 M1 mixed placeholder plus real text in impact and rollback_plan keeps the real text (merge helper)', () => {
  const result = contract.mergeDispatchMetadataFromUpstreamDetailed(
    LOCAL_CONTRACT as never,
    { impact: MIXED_IMPACT, rollback_plan: MIXED_ROLLBACK } as never,
  );
  assert.equal(result.merged?.impact, 'Captures failed deployment attempts.');
  assert.equal(result.merged?.rollback_plan, 'Revert the deploy-attempt capture commit.');
  assert.deepEqual(result.explicit_clears, []);
  // Every other key is untouched.
  assert.deepEqual(result.merged?.acceptance_criteria, LOCAL_CONTRACT.acceptance_criteria);

  // Placeholder-only still never overwrites, and list keys still split.
  const placeholderOnly = contract.mergeDispatchMetadataFromUpstream(
    LOCAL_CONTRACT as never,
    { impact: IMPACT_PLACEHOLDER.toUpperCase(), rollback_plan: ` ${ROLLBACK_PLACEHOLDER} ` } as never,
  );
  assert.equal(placeholderOnly?.impact, LOCAL_CONTRACT.impact);
  assert.equal(placeholderOnly?.rollback_plan, LOCAL_CONTRACT.rollback_plan);
  assert.deepEqual(
    contract.stripGenericSyncPlaceholdersForKey('acceptance_criteria', 'Issue is present on the mapped GitHub Project.; Real criterion'),
    ['Real criterion'],
  );
  assert.equal(
    contract.stripGenericSyncPlaceholdersForKey('impact', `A; ${IMPACT_PLACEHOLDER}; B`),
    'A; B',
  );
});

test('kanban#232 M1 Project sync: mixed impact and rollback_plan apply cleanly, no rollback loop across 3 syncs, two-read removal stays on', async () => {
  seed();
  seedSecondCard('PVTI_gone', 92);

  const runs = [];
  for (const runId of ['run-m1-a', 'run-m1-b', 'run-m1-c']) {
    runs.push(await runSync([mixedContractItem()], { syncRunId: runId }));
    assert.deepEqual(runs.at(-1)?.errors, [], `${runId}: no per-card error, so no rollback`);
    assert.ok(!runs.at(-1)?.details.some((detail) => detail.action === 'error'), `${runId}: no error detail`);
    const metadata = storedMetadata();
    assert.equal(metadata?.impact, 'Captures failed deployment attempts.', `${runId}: impact`);
    assert.equal(metadata?.rollback_plan, 'Revert the deploy-attempt capture commit.', `${runId}: rollback_plan`);
    assert.deepEqual(metadata?.acceptance_criteria, LOCAL_CONTRACT.acceptance_criteria, `${runId}: other keys kept`);
  }
  assert.equal(runs[0].updated, 1, 'the first sync applies the card update');

  // No field on the mixed card was cleared or tombstoned.
  assert.deepEqual(tombstones.listTaskFieldTombstones('task-existing'), []);

  // Two-read removal stayed enabled: the second complete clean read removes
  // the card whose item is gone, which never happens while errors is non-empty.
  assert.equal(runs[0].removed_from_project, 0);
  assert.equal(runs[1].removed_from_project, 1);
  const goneItem = db.queryOne<{ source_project_item_id: string | null }>(
    "SELECT source_project_item_id FROM tasks WHERE id = 'task-gone'",
  );
  assert.equal(goneItem?.source_project_item_id, null);
});

test('kanban#232 M1 Refresh From GitHub: mixed impact and rollback_plan PATCH writes no mck:user clear', async () => {
  seed();
  const patch = taskImport.buildTaskRefreshUpdateFromGitHubPreview(
    {
      title: 'Existing card',
      description: 'Local description',
      priority: 'normal',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'mission-control-kanban',
        issue_number: 34,
        issue_url: ISSUE_URL,
        project_item_id: 'PVTI_existing',
      },
      dispatch_metadata: LOCAL_CONTRACT as never,
    },
    {
      title: 'Existing card',
      description: 'Local description',
      priority: 'normal',
      status: 'in_progress',
      workspace_id: 'assistants',
      business_id: 'default',
      github_source: {
        repo_owner: 'iMelki',
        repo_name: 'mission-control-kanban',
        issue_number: 34,
        issue_url: ISSUE_URL,
        project_item_id: 'PVTI_existing',
      },
      dispatch_metadata: { source_issue_url: ISSUE_URL, impact: MIXED_IMPACT, rollback_plan: MIXED_ROLLBACK },
    } as never,
  );
  const response = await patchTask(patch as never);
  assert.equal(response.status, 200);
  const rows = tombstones.listTaskFieldTombstones('task-existing');
  assert.deepEqual(rows.filter((row) => row.source === 'mck:user').map((row) => row.field), [], 'no mck:user clear');
  assert.equal(rows.length, 0);
  assert.equal(patch.dispatch_metadata?.impact, 'Captures failed deployment attempts.');
  assert.equal(patch.dispatch_metadata?.rollback_plan, 'Revert the deploy-attempt capture commit.');
  assert.equal(storedMetadata()?.impact, 'Captures failed deployment attempts.');
  assert.equal(storedMetadata()?.rollback_plan, 'Revert the deploy-attempt capture commit.');
});

// ------------------------------------------- kanban#232 CTO review, Medium 2
// The write-back route loads status_evidence on the server from the issue's
// closedByPullRequestsReferences (the same source Project sync uses).

async function postWriteback(body: Record<string, unknown>) {
  const { NextRequest } = await import('next/server');
  const response = await writebackRoute.POST(
    new NextRequest('http://mck.test/api/tasks/task-existing/github-writeback', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'task-existing' }) },
  );
  return {
    status: response.status,
    payload: await response.json() as {
      status: string;
      project_updates: Array<{ field_name: string; value: string; skipped?: boolean; reason?: string; option_id?: string }>;
    },
  };
}

test('kanban#232 M2 Done and Review write-back passes with a linked main merge loaded on the server', async () => {
  for (const status of ['done', 'review'] as const) {
    seed({ status });
    await withMockedGitHub(async (calls) => {
      const dry = await postWriteback({});
      assert.equal(dry.status, 200);
      const statusUpdate = dry.payload.project_updates.find((update) => update.field_name === 'Status');
      assert.equal(statusUpdate?.skipped, undefined, `${status}: Status not refused`);
      assert.equal(statusUpdate?.option_id, status === 'done' ? 'OPT_done' : 'OPT_review');
      assert.ok(calls.some((call) => call.body.includes('WritebackStatusEvidence')), `${status}: evidence read on the server`);
      assert.deepEqual(statusMutations(calls), [], `${status}: dry run sends no mutation`);

      calls.length = 0;
      const applied = await postWriteback({ dry_run: false });
      assert.equal(applied.payload.status, 'applied');
      assert.deepEqual(statusMutations(calls), [status === 'done' ? 'OPT_done' : 'OPT_review'], `${status}: Status written`);
    }, { evidenceNodes: [{ url: 'https://github.com/iMelki/mission-control-kanban/pull/500', merged: true, baseRefName: 'main' }] });
  }
});

test('kanban#232 M2 Done and Review write-back is refused without evidence, with a dev merge, with an unmerged main PR, and ignores client-sent evidence', async () => {
  const cases: Array<{ name: string; nodes: EvidenceNode[] }> = [
    { name: 'no linked PR', nodes: [] },
    { name: 'dev merge only', nodes: [{ merged: true, baseRefName: 'dev' }] },
    { name: 'open PR into main', nodes: [{ merged: false, baseRefName: 'main' }] },
  ];
  for (const status of ['done', 'review'] as const) {
    for (const entry of cases) {
      seed({ status });
      await withMockedGitHub(async (calls) => {
        const dry = await postWriteback({
          // The route never trusts caller evidence.
          status_evidence: [{ kind: 'merged_pr', base_ref: 'main', merged: true }],
        });
        const statusUpdate = dry.payload.project_updates.find((update) => update.field_name === 'Status');
        assert.equal(statusUpdate?.skipped, true, `${status} / ${entry.name}: refused`);
        assert.equal(statusUpdate?.reason, writeback.WRITEBACK_STATUS_REFUSAL_REASON);

        calls.length = 0;
        await postWriteback({ dry_run: false });
        assert.deepEqual(statusMutations(calls), [], `${status} / ${entry.name}: no Status mutation`);
      }, { evidenceNodes: entry.nodes });
    }
  }

  // A card that does not promote never reads evidence.
  seed({ status: 'in_progress' });
  await withMockedGitHub(async (calls) => {
    const dry = await postWriteback({});
    const statusUpdate = dry.payload.project_updates.find((update) => update.field_name === 'Status');
    assert.equal(statusUpdate?.skipped, undefined);
    assert.ok(!calls.some((call) => call.body.includes('WritebackStatusEvidence')));
  });
});


// ------------------------------------------- distinct complete reads, list clear, open+Done

function missingReadState() {
  return db.queryOne<{ github_missing_reads: number; github_missing_read_ids: string | null }>(
    "SELECT github_missing_reads, github_missing_read_ids FROM tasks WHERE id = 'task-existing'",
  );
}

test('a repeated complete read of the same sync does not count toward unlink', async () => {
  seed();
  const other = issueItem({ id: 'PVTI_other', number: 91 });

  const first = await runSync([other], { syncRunId: 'run-same', readAt: '2026-11-19T12:00:00.000Z' });
  assert.equal(first.removed_from_project, 0);
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');
  assert.equal(missingReadState()?.github_missing_reads, 1);

  const replay = await runSync([other], { syncRunId: 'run-same', readAt: '2026-11-19T12:00:00.000Z' });
  assert.equal(replay.removed_from_project, 0);
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');
  assert.equal(tombstoneCount(), 0);
  assert.equal(missingReadState()?.github_missing_reads, 1);

  // Same sync run id, even with a later timestamp, is still the same sync.
  const sameRun = await runSync([other], { syncRunId: 'run-same', readAt: '2026-11-19T12:05:00.000Z' });
  assert.equal(sameRun.removed_from_project, 0);
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');
  assert.equal(tombstoneCount(), 0);

  // The same read snapshot under a new run id also does not count again.
  const sameSnapshot = await runSync([other], { syncRunId: 'run-replay', readAt: '2026-11-19T12:00:00.000Z' });
  assert.equal(sameSnapshot.removed_from_project, 0);
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');
  assert.equal(tombstoneCount(), 0);

  // A partial, paged, or errored read never increments the distinct count.
  const beforePartial = missingReadState();
  await sync.syncLoadedGitHubProjectWorkspace('assistants', {
    title: 'Assistants',
    allItems: [other] as never,
    read: { complete: false, reason: 'page 2 failed' },
  }, { syncRunId: 'run-partial', readAt: '2026-11-19T12:10:00.000Z' });
  assert.deepEqual(missingReadState(), beforePartial);
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');
});

test('unlink re-checks GitHub identity in the same transaction and refuses if it changed', async () => {
  seed();
  const other = issueItem({ id: 'PVTI_other', number: 91 });
  await runSync([other], { syncRunId: 'run-ident-1', readAt: '2026-11-19T12:00:00.000Z' });
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');

  sync.githubProjectSyncTestHooks.beforeTombstoneUnlinkIdentityCheck = () => {
    db.run(
      "UPDATE tasks SET source_project_item_id = 'PVTI_relinked', source_issue_number = 88 WHERE id = 'task-existing'",
    );
  };
  try {
    const second = await runSync([other], { syncRunId: 'run-ident-2', readAt: '2026-11-19T12:01:00.000Z' });
    assert.equal(second.removed_from_project, 0);
    assert.equal(tombstoneCount(), 0);
    assert.ok(second.details.some((detail) => detail.action === 'skip' && /identity changed before unlink/.test(detail.reason ?? '')));
    const row = db.queryOne<{ source_project_item_id: string; source_issue_number: number }>(
      "SELECT source_project_item_id, source_issue_number FROM tasks WHERE id = 'task-existing'",
    );
    assert.equal(row?.source_project_item_id, 'PVTI_relinked');
    assert.equal(row?.source_issue_number, 88);
  } finally {
    sync.githubProjectSyncTestHooks.beforeTombstoneUnlinkIdentityCheck = undefined;
  }
});

test('an empty, missing or unparsable list is never a clear; only an explicit marker is', () => {
  for (const upstream of [undefined, null, '', '   ', [], ['', '  '], [null], {}, { items: [] }, ';;;', ' , , ', 123, true]) {
    const result = contract.mergeDispatchMetadataFromUpstreamDetailed(
      LOCAL_CONTRACT as never,
      { acceptance_criteria: upstream, test_requirements: upstream } as never,
    );
    assert.deepEqual(result.explicit_clears, [], `clears for ${JSON.stringify(upstream)}`);
    assert.deepEqual(result.merged?.acceptance_criteria, LOCAL_CONTRACT.acceptance_criteria, `acceptance ${JSON.stringify(upstream)}`);
    assert.deepEqual(result.merged?.test_requirements, LOCAL_CONTRACT.test_requirements, `tests ${JSON.stringify(upstream)}`);
  }

  assert.equal(contract.isExplicitUpstreamListClear(undefined), false);
  assert.equal(contract.isExplicitUpstreamListClear(''), false);
  assert.equal(contract.isExplicitUpstreamListClear([]), false);
  assert.equal(contract.isExplicitUpstreamListClear({}), false);
  assert.equal(contract.isExplicitUpstreamListClear(';;;'), false);
  assert.equal(contract.isExplicitUpstreamListClear('MCK-CLEAR'), true);
  assert.equal(contract.isExplicitUpstreamListClear('- MCK-CLEAR'), true);
  assert.equal(contract.isExplicitUpstreamListClear('- [ ] MCK-CLEAR'), true);

  const cleared = contract.mergeDispatchMetadataFromUpstreamDetailed(
    LOCAL_CONTRACT as never,
    { acceptance_criteria: 'MCK-CLEAR' } as never,
  );
  assert.deepEqual(cleared.explicit_clears, ['dispatch_metadata.acceptance_criteria']);
  assert.equal(cleared.merged?.acceptance_criteria, undefined);

  // The raw bulleted token is a clear before any list parse.
  const bulleted = contract.mergeDispatchMetadataFromUpstreamDetailed(
    LOCAL_CONTRACT as never,
    { test_requirements: '- MCK-CLEAR' } as never,
  );
  assert.deepEqual(bulleted.explicit_clears, ['dispatch_metadata.test_requirements']);
  assert.equal(bulleted.merged?.test_requirements, undefined);
});

test('an open GitHub issue is imported and kept even when Project Status is Done', async () => {
  seed();
  const importedResult = await runSync([
    issueItem(),
    issueItem({ id: 'PVTI_open_done', number: 80, fields: [{ name: 'Done', field: 'Status' }] }),
  ]);
  assert.deepEqual(importedResult.errors, []);
  assert.equal(importedResult.imported, 1);
  assert.equal(importedResult.skipped_closed, 0);
  const imported = db.queryOne<{ status: string; source_project_item_id: string; dispatch_metadata: string }>(
    'SELECT status, source_project_item_id, dispatch_metadata FROM tasks WHERE source_issue_number = 80',
  );
  assert.equal(imported?.source_project_item_id, 'PVTI_open_done');
  assert.equal(imported?.status, 'inbox');
  assert.equal(contract.parseDispatchMetadata(imported?.dispatch_metadata)?.readiness, 'needs_grooming');
  assert.equal(tombstoneCount(), 0);

  // An existing open card with Project Done is not dropped or tombstoned, and
  // is not moved to Done without evidence.
  const existing = await runSync([
    issueItem({ fields: [{ name: 'Done', field: 'Status' }] }),
    issueItem({ id: 'PVTI_open_done', number: 80, fields: [{ name: 'Done', field: 'Status' }] }),
  ]);
  assert.equal(taskRow()?.source_project_item_id, 'PVTI_existing');
  assert.equal(taskRow()?.status, 'in_progress');
  assert.equal(existing.removed_from_project, 0);
  assert.ok(existing.details.some((detail) => /Needs evidence/.test(detail.reason ?? '')));
  assert.equal(tombstoneCount(), 0);
});
