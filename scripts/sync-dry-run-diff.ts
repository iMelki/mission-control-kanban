/**
 * Dry-run diff for the GitHub to MCK sync (docs/SYNC_FIELD_AUTHORITY.md
 * sections 4 and 9). It never writes to the database you point it at: it
 * copies the database into a fresh temp folder, runs the sync in dry-run mode
 * against the copy, and reports what would change. A clear that is not backed
 * by an explicit upstream MCK-CLEAR signal is refused by the sync and counted
 * here as a silent delete; the run exits 1 if there is any.
 *
 * Fixture (no network, no token):
 *   npx tsx scripts/sync-dry-run-diff.ts --fixture tests/fixtures/sync-dry-run/fixture.json
 *
 * Live (on the machine that owns the DB; needs GH_GENERAL_TOKEN or GITHUB_TOKEN
 * with read access to the Project, and reads GitHub only):
 *   npx tsx scripts/sync-dry-run-diff.ts --db ./mission-control.db --workspace memsys
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Args {
  fixture?: string;
  db?: string;
  workspaces: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { workspaces: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--fixture' && value) { args.fixture = value; index += 1; }
    else if (flag === '--db' && value) { args.db = value; index += 1; }
    else if (flag === '--workspace' && value) { args.workspaces.push(value); index += 1; }
    else throw new Error(`Unknown or incomplete argument: ${flag}`);
  }
  if (!args.fixture && !args.db) {
    throw new Error('Pass --fixture <file> or --db <path> [--workspace <slug>]...');
  }
  return args;
}

function copyDatabase(source: string, targetDir: string): string {
  const target = path.join(targetDir, 'mission-control.copy.db');
  // Copy the main file plus WAL/SHM so committed-but-uncheckpointed rows are included.
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${source}${suffix}`)) fs.copyFileSync(`${source}${suffix}`, `${target}${suffix}`);
  }
  return target;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mck-sync-dry-run-'));
  try {
    process.env.DATABASE_PATH = args.db
      ? copyDatabase(path.resolve(args.db), tempDir)
      : path.join(tempDir, 'fixture.db');

    const db = await import('../src/lib/db');
    const sync = await import('../src/lib/github-project-sync');

    const runs: Array<Awaited<ReturnType<typeof sync.syncLoadedGitHubProjectWorkspace>>> = [];
    if (args.fixture) {
      const fixture = JSON.parse(fs.readFileSync(args.fixture, 'utf8'));
      const now = new Date().toISOString();
      const ws = fixture.workspace;
      db.run(
        `INSERT OR REPLACE INTO workspaces (id, name, slug, github_project_owner, github_project_number, github_project_title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ws.id, ws.name, ws.slug, ws.github_project_owner, ws.github_project_number, ws.github_project_title, now, now],
      );
      for (const task of fixture.tasks) {
        db.run(
          `INSERT INTO tasks (id, title, description, status, priority, workspace_id, business_id,
             source_repo_owner, source_repo_name, source_issue_number, source_issue_url, source_project_item_id,
             dispatch_metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'normal', ?, 'default', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [task.id, task.title, task.description, task.status, ws.id, ws.github_project_owner, 'memsys',
            task.source_issue_number, `https://github.com/iMelki/memsys/issues/${task.source_issue_number}`,
            task.source_project_item_id, JSON.stringify(task.dispatch_metadata), now, now],
        );
      }
      runs.push(await sync.syncLoadedGitHubProjectWorkspace(ws.slug, fixture.project, { dryRun: true }));
    } else {
      const slugs = args.workspaces.length > 0 ? args.workspaces : sync.GITHUB_PROJECT_WORKSPACE_MAPPINGS.map((m) => m.slug);
      for (const slug of slugs) {
        runs.push(await sync.syncGitHubProjectWorkspace(slug, { dryRun: true }));
      }
    }

    let silentDeletes = 0;
    for (const result of runs) {
      const refused = result.details.filter((detail) => detail.action === 'error' && /without a tombstone/.test(detail.reason ?? ''));
      silentDeletes += refused.length;
      const summary = {
        workspace: result.workspace_slug,
        dry_run: result.dry_run,
        scanned_items: result.scanned_items,
        would_import: result.imported,
        would_update: result.updated,
        would_reconcile_status: result.status_reconciled,
        needs_evidence: result.needs_evidence,
        drift_warnings: result.upstream_drift_warnings,
        would_write_tombstones: result.tombstones,
        silent_deletes: refused.length,
        errors: result.errors.length,
      };
      console.log(JSON.stringify(summary));
      for (const detail of result.details) {
        if (['tombstone', 'needs_evidence', 'drift', 'error', 'import', 'status_reconcile'].includes(detail.action)) {
          console.log(`  ${detail.action.padEnd(16)} ${detail.issue ?? '-'} ${detail.field ?? ''} ${detail.reason ?? ''}`.trimEnd());
        }
      }
    }
    console.log(`silent_deletes_total=${silentDeletes}`);
    db.closeDb();
    process.exitCode = silentDeletes === 0 ? 0 : 1;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
