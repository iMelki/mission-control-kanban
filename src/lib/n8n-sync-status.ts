import { v4 as uuidv4 } from 'uuid';
import { mkdir, appendFile } from 'fs/promises';
import { dirname } from 'path';
import { queryAll, queryOne, run } from './db';
import type {
  MckN8nSyncAlertLevel,
  MckN8nSyncRun,
  MckN8nSyncStatusResponse,
  MckN8nSyncSummary,
} from './types';

const DEFAULT_WORKFLOW_ID = 'PrjOpsMckSync001';
const DEFAULT_WORKFLOW_NAME = 'Projects Ops - MCK Project Workspace Sync';
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 500;
const DEFAULT_ALERT_LOG_PATH = '.logs/mck-n8n-sync-alerts.jsonl';

interface N8nSyncRunRow {
  id: string;
  workflow_id: string;
  workflow_name: string;
  mode: string;
  dry_run: number;
  ok: number;
  alert_level: MckN8nSyncAlertLevel;
  alert_message: string | null;
  base_url: string | null;
  workspaces: string;
  summary: string | null;
  results: string | null;
  raw_payload: string;
  received_at: string;
  created_at: string;
}

interface NormalizedMckN8nSyncPayload {
  workflow_id: string;
  workflow_name: string;
  mode: string;
  dry_run: boolean;
  ok: boolean;
  alert_level: MckN8nSyncAlertLevel;
  alert_message: string;
  base_url: string | null;
  workspaces: string[];
  summary: MckN8nSyncSummary;
  results: unknown[];
  raw_payload: Record<string, unknown>;
  received_at: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeTimestamp(value: unknown, now: Date): string {
  const candidate = asString(value).trim();
  if (!candidate) {
    return now.toISOString();
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return now.toISOString();
  }

  return parsed.toISOString();
}

function normalizeWorkspaces(raw: Record<string, unknown>, results: unknown[]): string[] {
  const explicitWorkspaces = raw.workspaces ?? raw.workspace;
  let candidates: unknown[] = [];

  if (Array.isArray(explicitWorkspaces)) {
    candidates = explicitWorkspaces;
  } else if (typeof explicitWorkspaces === 'string') {
    candidates = explicitWorkspaces.split(',');
  } else {
    candidates = results.map((item) => asRecord(item).workspace);
  }

  return Array.from(new Set(
    candidates.flatMap((workspace) => {
      const normalized = asString(workspace).trim();
      return normalized ? [normalized] : [];
    })
  ));
}

function normalizeAlertLevel(value: unknown, ok: boolean): MckN8nSyncAlertLevel {
  const candidate = asString(value).trim().toLowerCase();
  if (candidate === 'ok' || candidate === 'warning' || candidate === 'error' || candidate === 'unknown') {
    return candidate;
  }

  return ok ? 'ok' : 'error';
}

export function getMckN8nSyncHistoryLimit(): number {
  const rawLimit = Number(process.env.MCK_N8N_SYNC_HISTORY_LIMIT ?? DEFAULT_HISTORY_LIMIT);
  if (!Number.isFinite(rawLimit)) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(rawLimit)));
}

export function shouldNotifyMckN8nSyncAlert(run: Pick<MckN8nSyncRun, 'ok' | 'alert_level'>): boolean {
  return !run.ok || run.alert_level === 'error';
}

export function normalizeMckN8nSyncPayload(payload: unknown, now = new Date()): NormalizedMckN8nSyncPayload {
  const raw = cloneJson(asRecord(payload));
  const summary = cloneJson(asRecord(raw.summary)) as MckN8nSyncSummary;
  const results = Array.isArray(raw.results) ? cloneJson(raw.results) : [];
  const alert = asRecord(raw.alert);
  const dryRun = asBoolean(raw.dryRun ?? raw.dry_run, false);
  const summaryHasErrors = asNumber(summary.errors) > 0 || asNumber(summary.failed) > 0;
  const ok = asBoolean(raw.ok, !summaryHasErrors) && !summaryHasErrors;
  const alertLevel = normalizeAlertLevel(alert.level ?? raw.alert_level, ok);
  const alertMessage = asString(
    alert.message ?? raw.alert_message,
    ok ? 'MCK sync completed without errors.' : 'MCK sync returned errors; inspect the run history.'
  );

  return {
    workflow_id: asString(raw.workflowId ?? raw.workflow_id, DEFAULT_WORKFLOW_ID),
    workflow_name: asString(raw.workflowName ?? raw.workflow_name, DEFAULT_WORKFLOW_NAME),
    mode: asString(raw.mode, dryRun ? 'local-mck-sync-dry-run' : 'local-mck-sync'),
    dry_run: dryRun,
    ok,
    alert_level: alertLevel,
    alert_message: alertMessage,
    base_url: asString(raw.baseUrl ?? raw.base_url, '') || null,
    workspaces: normalizeWorkspaces(raw, results),
    summary,
    results,
    raw_payload: raw,
    received_at: normalizeTimestamp(raw.receivedAt ?? raw.received_at, now),
  };
}

function pruneMckN8nSyncHistory(): void {
  run(
    `
      DELETE FROM n8n_sync_runs
      WHERE id NOT IN (
        SELECT id
        FROM n8n_sync_runs
        ORDER BY datetime(created_at) DESC, received_at DESC
        LIMIT ?
      )
    `,
    [getMckN8nSyncHistoryLimit()]
  );
}

function getAlertLogPath(): string | null {
  const configured = process.env.MCK_N8N_ALERT_LOG_PATH;
  if (configured && ['off', 'none', 'disabled'].includes(configured.trim().toLowerCase())) {
    return null;
  }

  return configured?.trim() || DEFAULT_ALERT_LOG_PATH;
}

export async function notifyMckN8nSyncAlert(run: MckN8nSyncRun): Promise<void> {
  if (!shouldNotifyMckN8nSyncAlert(run)) {
    return;
  }

  const payload = {
    event: 'mck_n8n_sync_alert',
    emitted_at: new Date().toISOString(),
    run,
  };
  const webhookUrl = process.env.MCK_N8N_ALERT_WEBHOOK_URL?.trim();

  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`MCK n8n alert webhook returned HTTP ${response.status}.`);
      }
    } catch (error) {
      console.error('Failed to send MCK n8n alert webhook:', error);
    }
  }

  const alertLogPath = getAlertLogPath();
  if (!alertLogPath) {
    return;
  }

  try {
    await mkdir(dirname(alertLogPath), { recursive: true });
    await appendFile(alertLogPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write MCK n8n alert log:', error);
  }
}

function mapRun(row: N8nSyncRunRow): MckN8nSyncRun {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    workflow_name: row.workflow_name,
    mode: row.mode,
    dry_run: Boolean(row.dry_run),
    ok: Boolean(row.ok),
    alert_level: row.alert_level,
    alert_message: row.alert_message,
    base_url: row.base_url,
    workspaces: parseJson<string[]>(row.workspaces, []),
    summary: parseJson<MckN8nSyncSummary | null>(row.summary, null),
    results: parseJson<unknown[] | null>(row.results, null),
    raw_payload: parseJson<Record<string, unknown> | null>(row.raw_payload, null),
    received_at: row.received_at,
    created_at: row.created_at,
  };
}

export function recordMckN8nSyncPayload(payload: unknown): MckN8nSyncRun {
  const normalized = normalizeMckN8nSyncPayload(payload);
  const id = uuidv4();

  run(
    `
      INSERT INTO n8n_sync_runs (
        id,
        workflow_id,
        workflow_name,
        mode,
        dry_run,
        ok,
        alert_level,
        alert_message,
        base_url,
        workspaces,
        summary,
        results,
        raw_payload,
        received_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      normalized.workflow_id,
      normalized.workflow_name,
      normalized.mode,
      normalized.dry_run ? 1 : 0,
      normalized.ok ? 1 : 0,
      normalized.alert_level,
      normalized.alert_message,
      normalized.base_url,
      JSON.stringify(normalized.workspaces),
      JSON.stringify(normalized.summary),
      JSON.stringify(normalized.results),
      JSON.stringify(normalized.raw_payload),
      normalized.received_at,
    ]
  );

  pruneMckN8nSyncHistory();

  const row = queryOne<N8nSyncRunRow>('SELECT * FROM n8n_sync_runs WHERE id = ?', [id]);
  if (!row) {
    throw new Error('Failed to record n8n sync run.');
  }

  return mapRun(row);
}

export function getMckN8nSyncStatus(limit = 5): MckN8nSyncStatusResponse {
  const boundedLimit = Math.max(1, Math.min(50, Number.isFinite(limit) ? Math.floor(limit) : 5));
  const rows = queryAll<N8nSyncRunRow>(
    'SELECT * FROM n8n_sync_runs ORDER BY datetime(created_at) DESC, received_at DESC LIMIT ?',
    [boundedLimit]
  );
  const history = rows.map(mapRun);

  return {
    ok: true,
    latest: history[0] ?? null,
    history,
  };
}
