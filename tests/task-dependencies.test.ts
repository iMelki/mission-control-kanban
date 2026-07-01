import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-task-deps-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'mission-control-test.db');

let closeDb: typeof import('../src/lib/db').closeDb;
let run: typeof import('../src/lib/db').run;
let addTaskDependency: typeof import('../src/lib/task-dependencies').addTaskDependency;
let removeTaskDependency: typeof import('../src/lib/task-dependencies').removeTaskDependency;
let listTaskDependencies: typeof import('../src/lib/task-dependencies').listTaskDependencies;
let listDependencyCandidates: typeof import('../src/lib/task-dependencies').listDependencyCandidates;
let listTaskDependenciesForTasks: typeof import('../src/lib/task-dependencies').listTaskDependenciesForTasks;

function resetDb() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${process.env.DATABASE_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function seedWorkspace(id: string) {
  const now = new Date().toISOString();
  run(
    `INSERT OR IGNORE INTO workspaces (id, name, slug, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, id, id, '', now, now]
  );
}

function seedTask(id: string, workspaceId = 'default', title = id) {
  seedWorkspace(workspaceId);
  const now = new Date().toISOString();
  run(
    `INSERT INTO tasks (id, title, description, status, priority, workspace_id, business_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, '', 'inbox', 'normal', workspaceId, 'default', now, now]
  );
}

test.before(async () => {
  const dbModule = await import('../src/lib/db');
  const dependencies = await import('../src/lib/task-dependencies');
  closeDb = dbModule.closeDb;
  run = dbModule.run;
  addTaskDependency = dependencies.addTaskDependency;
  removeTaskDependency = dependencies.removeTaskDependency;
  listTaskDependencies = dependencies.listTaskDependencies;
  listDependencyCandidates = dependencies.listDependencyCandidates;
  listTaskDependenciesForTasks = dependencies.listTaskDependenciesForTasks;
});

test.after(() => {
  resetDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('task dependency validation rejects self, duplicate, and cross-workspace edges', () => {
  resetDb();
  seedTask('task-a');
  seedTask('task-b');
  seedTask('task-c', 'other');

  assert.throws(() => addTaskDependency('task-a', 'task-a'), /cannot block itself/i);
  addTaskDependency('task-a', 'task-b', 'B must land first');
  assert.throws(() => addTaskDependency('task-a', 'task-b'), /already exists/i);
  assert.throws(() => addTaskDependency('task-a', 'task-c'), /same workspace/i);

  const deps = listTaskDependencies('task-a');
  assert.equal(deps.blocked_by.length, 1);
  assert.equal(deps.blocked_by[0].blocked_by_title, 'task-b');
  assert.equal(deps.blocked_by[0].note, 'B must land first');
});

test('task dependency validation rejects direct and transitive cycles', () => {
  resetDb();
  seedTask('task-a');
  seedTask('task-b');
  seedTask('task-c');

  addTaskDependency('task-a', 'task-b');
  assert.throws(() => addTaskDependency('task-b', 'task-a'), /cycle/i);

  addTaskDependency('task-b', 'task-c');
  assert.throws(() => addTaskDependency('task-c', 'task-a'), /cycle/i);
});

test('candidate and batch dependency listings stay scoped and removable', () => {
  resetDb();
  seedTask('task-a', 'default', 'A');
  seedTask('task-b', 'default', 'B');
  seedTask('task-c', 'default', 'C');
  seedTask('task-other', 'other', 'Other');

  const created = addTaskDependency('task-a', 'task-b');
  addTaskDependency('task-c', 'task-a');

  const candidates = listDependencyCandidates('task-a', 'default');
  assert.deepEqual(candidates.map((candidate) => candidate.id).sort(), ['task-b', 'task-c']);

  const batch = listTaskDependenciesForTasks(['task-a', 'task-c']);
  assert.equal(batch.get('task-a')?.blocked_by.length, 1);
  assert.equal(batch.get('task-a')?.blocking.length, 1);
  assert.equal(batch.get('task-c')?.blocked_by.length, 1);

  removeTaskDependency('task-a', created.id);
  assert.equal(listTaskDependencies('task-a').blocked_by.length, 0);
});
