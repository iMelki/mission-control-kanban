import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Regression guard for the Runtime Regression server crash seen after the
// Next.js 16.3.6 upgrade:
//
//   node::RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr
//   Statement::~Statement() [.../better_sqlite3.node]
//
// better-sqlite3 < 13 wraps statements in node::ObjectWrap. On Node 24 its
// destructor removes an environment cleanup hook through the *current*
// context, so a GC that finalizes a dropped statement from a V8 foreground
// task (incremental marking finished while the event loop is idle) has no
// context and aborts the whole process. The child below drives exactly that
// pattern: short bursts of prepared statements and garbage separated by idle
// gaps. It must exit cleanly.
const child = String.raw`
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('create table t (a)');
let rounds = 0;
function burst() {
  let keep = [];
  for (let i = 0; i < 5000; i++) keep.push(db.prepare('select a from t where a = ?'));
  let junk = [];
  for (let i = 0; i < 50000; i++) junk.push({ i, s: 'x' + i });
  keep = null;
  junk = null;
  if (++rounds < 40) setTimeout(burst, 20);
  else console.log('rounds=' + rounds);
}
burst();
`;

test('dropped prepared statements survive GC finalized outside a JS context', () => {
  const result = spawnSync(process.execPath, ['-e', child], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });

  assert.equal(result.signal, null, `child was killed by ${result.signal}\n${result.stderr}`);
  assert.equal(result.status, 0, `child exited ${result.status}\n${result.stderr}`);
  assert.match(result.stdout, /rounds=40/);
});
