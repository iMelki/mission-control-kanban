import type { Database as SqliteDatabase, RunResult } from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { schema } from './schema';
import { runMigrations } from './migrations';

const require = createRequire(__filename);
let db: SqliteDatabase | null = null;

type DatabaseConstructor = new (filename: string) => SqliteDatabase;

function getDbPath() {
  return process.env.DATABASE_PATH || 'mission-control.db';
}

function loadDatabase(): DatabaseConstructor {
  const required = require('better-sqlite3') as { default?: DatabaseConstructor } | DatabaseConstructor;
  return typeof required === 'function' ? required : required.default as DatabaseConstructor;
}

export function getDb(): SqliteDatabase {
  if (!db) {
    const dbPath = getDbPath();
    const isNewDb = !existsSync(dbPath);
    const Database = loadDatabase();

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Initialize base schema (creates tables if they don't exist)
    db.exec(schema);

    // Run migrations for schema updates
    // This handles both new and existing databases
    runMigrations(db);

    if (isNewDb) {
      console.log('[DB] New database created at:', dbPath);
    }
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Type-safe query helpers
export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return stmt.all(...params) as T[];
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = getDb().prepare(sql);
  return stmt.get(...params) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): RunResult {
  const stmt = getDb().prepare(sql);
  return stmt.run(...params);
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  return db.transaction(fn)();
}

// Export migration utilities for CLI use
export { runMigrations, getMigrationStatus } from './migrations';
