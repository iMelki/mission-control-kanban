/**
 * Database Migrations System
 *
 * Handles schema changes in a production-safe way:
 * 1. Tracks which migrations have been applied
 * 2. Runs new migrations automatically on startup
 * 3. Never runs the same migration twice
 */

import Database from 'better-sqlite3';

interface Migration {
  id: string;
  name: string;
  up: (db: Database.Database) => void;
}

// All migrations in order - NEVER remove or reorder existing migrations
const migrations: Migration[] = [
  {
    id: '001',
    name: 'initial_schema',
    up: (db) => {
      // Core tables - these are created in schema.ts on fresh databases
      // This migration exists to mark the baseline for existing databases
      console.log('[Migration 001] Baseline schema marker');
    }
  },
  {
    id: '002',
    name: 'add_workspaces',
    up: (db) => {
      console.log('[Migration 002] Adding workspaces table and columns...');

      // Create workspaces table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          icon TEXT DEFAULT '📁',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);

      // Insert default workspace if not exists
      db.exec(`
        INSERT OR IGNORE INTO workspaces (id, name, slug, description, icon)
        VALUES ('default', 'Default Workspace', 'default', 'Default workspace', '🏠');
      `);

      // Add workspace_id to tasks if not exists
      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!tasksInfo.some(col => col.name === 'workspace_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to tasks');
      }

      // Add workspace_id to agents if not exists
      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
      if (!agentsInfo.some(col => col.name === 'workspace_id')) {
        db.exec(`ALTER TABLE agents ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to agents');
      }
    }
  },
  {
    id: '003',
    name: 'add_planning_tables',
    up: (db) => {
      console.log('[Migration 003] Adding planning tables...');

      // Create planning_questions table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_questions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          question TEXT NOT NULL,
          question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'text', 'yes_no')),
          options TEXT,
          answer TEXT,
          answered_at TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);

      // Create planning_specs table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_specs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          spec_markdown TEXT NOT NULL,
          locked_at TEXT NOT NULL,
          locked_by TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);

      // Create index
      db.exec(`CREATE INDEX IF NOT EXISTS idx_planning_questions_task ON planning_questions(task_id, sort_order)`);

      // Update tasks status check constraint to include 'planning'
      // SQLite doesn't support ALTER CONSTRAINT, so we check if it's needed
      const taskSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
      if (taskSchema && !taskSchema.sql.includes("'planning'")) {
        console.log('[Migration 003] Note: tasks table needs planning status - will be handled by schema recreation on fresh dbs');
      }
    }
  },
  {
    id: '004',
    name: 'add_planning_session_columns',
    up: (db) => {
      console.log('[Migration 004] Adding planning session columns to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      // Add planning_session_key column
      if (!tasksInfo.some(col => col.name === 'planning_session_key')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_session_key TEXT`);
        console.log('[Migration 004] Added planning_session_key');
      }

      // Add planning_messages column (stores JSON array of messages)
      if (!tasksInfo.some(col => col.name === 'planning_messages')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_messages TEXT`);
        console.log('[Migration 004] Added planning_messages');
      }

      // Add planning_complete column
      if (!tasksInfo.some(col => col.name === 'planning_complete')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_complete INTEGER DEFAULT 0`);
        console.log('[Migration 004] Added planning_complete');
      }

      // Add planning_spec column (stores final spec JSON)
      if (!tasksInfo.some(col => col.name === 'planning_spec')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_spec TEXT`);
        console.log('[Migration 004] Added planning_spec');
      }

      // Add planning_agents column (stores generated agents JSON)
      if (!tasksInfo.some(col => col.name === 'planning_agents')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_agents TEXT`);
        console.log('[Migration 004] Added planning_agents');
      }
    }
  },
  {
    id: '005',
    name: 'add_dispatch_metadata',
    up: (db) => {
      console.log('[Migration 005] Adding dispatch metadata to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!tasksInfo.some(col => col.name === 'dispatch_metadata')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN dispatch_metadata TEXT`);
        console.log('[Migration 005] Added dispatch_metadata');
      }
    }
  },
  {
    id: '006',
    name: 'add_github_source_identity',
    up: (db) => {
      console.log('[Migration 006] Adding GitHub source identity columns to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      const addColumnIfMissing = (columnName: string, sql: string) => {
        if (!tasksInfo.some((col) => col.name === columnName)) {
          db.exec(sql);
          console.log(`[Migration 006] Added ${columnName}`);
        }
      };

      addColumnIfMissing('source_repo_owner', 'ALTER TABLE tasks ADD COLUMN source_repo_owner TEXT');
      addColumnIfMissing('source_repo_name', 'ALTER TABLE tasks ADD COLUMN source_repo_name TEXT');
      addColumnIfMissing('source_issue_number', 'ALTER TABLE tasks ADD COLUMN source_issue_number INTEGER');
      addColumnIfMissing('source_issue_url', 'ALTER TABLE tasks ADD COLUMN source_issue_url TEXT');
      addColumnIfMissing('source_project_item_id', 'ALTER TABLE tasks ADD COLUMN source_project_item_id TEXT');

      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_source_project_item_id ON tasks(source_project_item_id)');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_github_issue_unique
          ON tasks(source_repo_owner, source_repo_name, source_issue_number)
          WHERE source_repo_owner IS NOT NULL AND source_repo_name IS NOT NULL AND source_issue_number IS NOT NULL
      `);
    }
  },
  {
    id: '007',
    name: 'add_github_writeback_logs',
    up: (db) => {
      console.log('[Migration 007] Adding GitHub write-back logs...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS github_writeback_logs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply')),
          status TEXT NOT NULL CHECK (status IN ('planned', 'applied', 'skipped', 'failed')),
          signature TEXT NOT NULL,
          issue_comment_body TEXT,
          project_updates TEXT,
          response_payload TEXT,
          error_message TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_github_writeback_logs_task ON github_writeback_logs(task_id, created_at DESC)');
    }
  },
  {
    id: '008',
    name: 'add_github_project_workspaces',
    up: (db) => {
      console.log('[Migration 008] Adding GitHub Project-backed workspaces...');

      const workspacesInfo = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[];
      const addColumnIfMissing = (columnName: string, sql: string) => {
        if (!workspacesInfo.some((col) => col.name === columnName)) {
          db.exec(sql);
          console.log(`[Migration 008] Added ${columnName}`);
        }
      };

      addColumnIfMissing('github_project_owner', 'ALTER TABLE workspaces ADD COLUMN github_project_owner TEXT');
      addColumnIfMissing('github_project_number', 'ALTER TABLE workspaces ADD COLUMN github_project_number INTEGER');
      addColumnIfMissing('github_project_title', 'ALTER TABLE workspaces ADD COLUMN github_project_title TEXT');
      addColumnIfMissing('github_project_url', 'ALTER TABLE workspaces ADD COLUMN github_project_url TEXT');
      addColumnIfMissing('github_project_auto_refresh', 'ALTER TABLE workspaces ADD COLUMN github_project_auto_refresh INTEGER DEFAULT 0');

      db.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_github_project ON workspaces(github_project_owner, github_project_number)');

      const projectWorkspaces = [
        {
          id: 'assistants',
          name: 'Assistants',
          slug: 'assistants',
          description: 'Operator cockpit mapped to GitHub Project #13.',
          icon: 'A',
          owner: 'iMelki',
          number: 13,
          title: 'Assistants',
          url: 'https://github.com/users/iMelki/projects/13',
        },
        {
          id: 'memsys',
          name: 'MemSys',
          slug: 'memsys',
          description: 'Memory-system cockpit mapped to GitHub Project #12.',
          icon: 'M',
          owner: 'iMelki',
          number: 12,
          title: 'MemSys',
          url: 'https://github.com/users/iMelki/projects/12',
        },
        {
          id: 'content-factory',
          name: 'Content Factory',
          slug: 'content-factory',
          description: 'Content Factory cockpit mapped to GitHub Project #14.',
          icon: 'C',
          owner: 'iMelki',
          number: 14,
          title: 'Content Factory',
          url: 'https://github.com/users/iMelki/projects/14',
        },
      ];

      for (const workspace of projectWorkspaces) {
        db.prepare(`
          INSERT OR IGNORE INTO workspaces (id, name, slug, description, icon)
          VALUES (?, ?, ?, ?, ?)
        `).run(workspace.id, workspace.name, workspace.slug, workspace.description, workspace.icon);

        db.prepare(`
          UPDATE workspaces
          SET name = ?,
              description = ?,
              icon = ?,
              github_project_owner = ?,
              github_project_number = ?,
              github_project_title = ?,
              github_project_url = ?,
              github_project_auto_refresh = 1,
              updated_at = datetime('now')
          WHERE slug = ?
        `).run(
          workspace.name,
          workspace.description,
          workspace.icon,
          workspace.owner,
          workspace.number,
          workspace.title,
          workspace.url,
          workspace.slug
        );
      }
    }
  },
  {
    id: '009',
    name: 'scope_github_issue_uniqueness_to_workspace',
    up: (db) => {
      console.log('[Migration 009] Scoping GitHub issue uniqueness to workspaces...');

      db.exec('DROP INDEX IF EXISTS idx_tasks_github_issue_unique');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_github_issue_unique
          ON tasks(workspace_id, source_repo_owner, source_repo_name, source_issue_number)
          WHERE source_repo_owner IS NOT NULL AND source_repo_name IS NOT NULL AND source_issue_number IS NOT NULL
      `);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_github_project_item_unique
          ON tasks(source_project_item_id)
        WHERE source_project_item_id IS NOT NULL
      `);
    }
  },
  {
    id: '010',
    name: 'add_n8n_sync_runs',
    up: (db) => {
      console.log('[Migration 010] Adding n8n MCK sync run history...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS n8n_sync_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          mode TEXT NOT NULL,
          dry_run INTEGER NOT NULL DEFAULT 1,
          ok INTEGER NOT NULL DEFAULT 0,
          alert_level TEXT NOT NULL DEFAULT 'unknown',
          alert_message TEXT,
          base_url TEXT,
          workspaces TEXT NOT NULL,
          summary TEXT,
          results TEXT,
          raw_payload TEXT NOT NULL,
          received_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_n8n_sync_runs_created ON n8n_sync_runs(created_at DESC)');
    }
  },
  {
    id: '011',
    name: 'add_mck_sync_test_workspace',
    up: (db) => {
      console.log('[Migration 011] Adding guarded MCK sync test workspace...');

      db.prepare(`
        INSERT OR IGNORE INTO workspaces (id, name, slug, description, icon)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'mck-sync-test-assistants',
        'MCK Sync Test - Assistants',
        'mck-sync-test-assistants',
        'Temporary guarded workspace for non-dry-run n8n sync validation against GitHub Project #13.',
        'T'
      );

      db.prepare(`
        UPDATE workspaces
        SET name = ?,
            description = ?,
            icon = ?,
            github_project_owner = ?,
            github_project_number = ?,
            github_project_title = ?,
            github_project_url = ?,
            github_project_auto_refresh = 0,
            updated_at = datetime('now')
        WHERE slug = ?
      `).run(
        'MCK Sync Test - Assistants',
        'Temporary guarded workspace for non-dry-run n8n sync validation against GitHub Project #13.',
        'T',
        'iMelki',
        13,
        'Assistants',
        'https://github.com/users/iMelki/projects/13',
        'mck-sync-test-assistants'
      );
    }
  },
  {
    id: '012',
    name: 'add_asimtop_project_workspace',
    up: (db) => {
      console.log('[Migration 012] Adding Asimtop GitHub Project-backed workspace...');

      db.prepare(`
        INSERT OR IGNORE INTO workspaces (id, name, slug, description, icon)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'asimtop',
        'Asimtop',
        'asimtop',
        'Asimtop cockpit mapped to GitHub Project #8.',
        'A'
      );

      db.prepare(`
        UPDATE workspaces
        SET name = ?,
            description = ?,
            icon = ?,
            github_project_owner = ?,
            github_project_number = ?,
            github_project_title = ?,
            github_project_url = ?,
            github_project_auto_refresh = 0,
            updated_at = datetime('now')
        WHERE slug = ?
      `).run(
        'Asimtop',
        'Asimtop cockpit mapped to GitHub Project #8.',
        'A',
        'iMelki',
        8,
        'Asimtop Trading Automation',
        'https://github.com/users/iMelki/projects/8',
        'asimtop'
      );
    }
  },
  {
    id: '013',
    name: 'add_agent_runtime_fields',
    up: (db) => {
      console.log('[Migration 013] Adding agent runtime dispatch fields...');

      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
      const hasColumn = (name: string) => agentsInfo.some((col) => col.name === name);

      if (!hasColumn('runtime_type')) {
        db.exec(`ALTER TABLE agents ADD COLUMN runtime_type TEXT DEFAULT 'manual' CHECK (runtime_type IN ('manual', 'openclaw', 'webhook'))`);
        console.log('[Migration 013] Added runtime_type');
      }
      if (!hasColumn('runtime_config')) {
        db.exec('ALTER TABLE agents ADD COLUMN runtime_config TEXT');
        console.log('[Migration 013] Added runtime_config');
      }
      if (!hasColumn('dispatch_enabled')) {
        db.exec('ALTER TABLE agents ADD COLUMN dispatch_enabled INTEGER DEFAULT 0');
        console.log('[Migration 013] Added dispatch_enabled');
      }

      db.exec('CREATE INDEX IF NOT EXISTS idx_agents_runtime_type ON agents(runtime_type)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_agents_dispatch_enabled ON agents(dispatch_enabled)');

      // Preserve the pre-adapter behavior for existing rows: before this migration,
      // all assigned auto-dispatch attempts were routed to OpenClaw.
      db.exec(`
        UPDATE agents
        SET runtime_type = 'openclaw',
            dispatch_enabled = 1
        WHERE runtime_type IS NULL OR runtime_type = 'manual'
      `);
    }
  },
  {
    id: '014',
    name: 'add_task_dispatch_attempts',
    up: (db) => {
      console.log('[Migration 014] Adding task dispatch attempt timeline...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_dispatch_attempts (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          agent_id TEXT REFERENCES agents(id),
          runtime_type TEXT NOT NULL CHECK (runtime_type IN ('manual', 'openclaw', 'webhook')),
          adapter_name TEXT,
          status TEXT NOT NULL CHECK (status IN ('manual', 'success', 'failed', 'timeout', 'skipped', 'retrying')),
          attempt_number INTEGER NOT NULL DEFAULT 1,
          message TEXT NOT NULL,
          http_status INTEGER,
          webhook_url TEXT,
          error_message TEXT,
          request_payload TEXT,
          response_body TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_task ON task_dispatch_attempts(task_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_status ON task_dispatch_attempts(status, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_runtime_status ON task_dispatch_attempts(runtime_type, status, created_at DESC)');
    }
  },
  {
    id: '015',
    name: 'add_workspace_runtime_policy',
    up: (db) => {
      console.log('[Migration 015] Adding workspace default runtime policy...');
      const workspacesInfo = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[];
      const hasColumn = (name: string) => workspacesInfo.some((col) => col.name === name);

      if (!hasColumn('default_runtime_type')) {
        db.exec(`ALTER TABLE workspaces ADD COLUMN default_runtime_type TEXT DEFAULT 'manual' CHECK (default_runtime_type IN ('manual', 'openclaw', 'webhook'))`);
      }
      if (!hasColumn('default_runtime_config')) {
        db.exec('ALTER TABLE workspaces ADD COLUMN default_runtime_config TEXT');
      }
      if (!hasColumn('default_dispatch_enabled')) {
        db.exec('ALTER TABLE workspaces ADD COLUMN default_dispatch_enabled INTEGER DEFAULT 0');
      }

      db.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_default_runtime ON workspaces(default_runtime_type, default_dispatch_enabled)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_runtime_status ON task_dispatch_attempts(runtime_type, status, created_at DESC)');
    }
  },

  {
    id: '016',
    name: 'add_webhook_callback_delivery_and_runtime_maintenance',
    up: (db) => {
      console.log('[Migration 016] Adding webhook callback replay and runtime maintenance tables...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS webhook_callback_deliveries (
          id TEXT PRIMARY KEY,
          delivery_id TEXT NOT NULL UNIQUE,
          task_id TEXT,
          attempt_id TEXT,
          event_type TEXT NOT NULL DEFAULT 'unknown',
          status TEXT NOT NULL CHECK (status IN ('accepted', 'duplicate', 'rejected', 'schema_invalid', 'signature_invalid')),
          reason TEXT,
          expires_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_callback_deliveries_received ON webhook_callback_deliveries(received_at DESC);
        CREATE INDEX IF NOT EXISTS idx_webhook_callback_deliveries_expires ON webhook_callback_deliveries(expires_at);

        CREATE TABLE IF NOT EXISTS runtime_maintenance_runs (
          id TEXT PRIMARY KEY,
          run_type TEXT NOT NULL,
          dry_run INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
          deleted_count INTEGER DEFAULT 0,
          summary TEXT,
          error_message TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_maintenance_runs_type ON runtime_maintenance_runs(run_type, created_at DESC);
      `);
    }
  },
];

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map(m => m.id)
  );

  // Run pending migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    console.log(`[DB] Running migration ${migration.id}: ${migration.name}`);

    try {
      // Run migration in a transaction
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(migration.id, migration.name);
      })();

      console.log(`[DB] Migration ${migration.id} completed`);
    } catch (error) {
      console.error(`[DB] Migration ${migration.id} failed:`, error);
      throw error;
    }
  }
}

/**
 * Get migration status
 */
export function getMigrationStatus(db: Database.Database): { applied: string[]; pending: string[] } {
  const applied = (db.prepare('SELECT id FROM _migrations ORDER BY id').all() as { id: string }[]).map(m => m.id);
  const appliedIds = new Set(applied);
  const pending = migrations.flatMap((m) => appliedIds.has(m.id) ? [] : [m.id]);
  return { applied, pending };
}
