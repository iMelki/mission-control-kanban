/**
 * Database Schema for Mission Control
 *
 * This defines the current desired schema state.
 * For existing databases, migrations handle schema updates.
 *
 * IMPORTANT: When adding new tables or columns:
 * 1. Add them here for new databases
 * 2. Create a migration in migrations.ts for existing databases
 */

export const schema = `
-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT DEFAULT '📁',
  github_project_owner TEXT,
  github_project_number INTEGER,
  github_project_title TEXT,
  github_project_url TEXT,
  github_project_auto_refresh INTEGER DEFAULT 0,
  default_runtime_type TEXT DEFAULT 'manual' CHECK (default_runtime_type IN ('manual', 'openclaw', 'webhook')),
  default_runtime_config TEXT,
  default_dispatch_enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT,
  avatar_emoji TEXT DEFAULT '🤖',
  status TEXT DEFAULT 'standby' CHECK (status IN ('standby', 'working', 'offline')),
  is_master INTEGER DEFAULT 0,
  runtime_type TEXT DEFAULT 'manual' CHECK (runtime_type IN ('manual', 'openclaw', 'webhook')),
  runtime_config TEXT,
  dispatch_enabled INTEGER DEFAULT 0,
  workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
  soul_md TEXT,
  user_md TEXT,
  agents_md TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tasks table (Mission Queue)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'inbox' CHECK (status IN ('planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'done')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_agent_id TEXT REFERENCES agents(id),
  created_by_agent_id TEXT REFERENCES agents(id),
  workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
  business_id TEXT DEFAULT 'default',
  due_date TEXT,
  source_repo_owner TEXT,
  source_repo_name TEXT,
  source_issue_number INTEGER,
  source_issue_url TEXT,
  source_project_item_id TEXT,
  dispatch_metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Planning questions table
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

-- Planning specs table (locked specifications)
CREATE TABLE IF NOT EXISTS planning_specs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  spec_markdown TEXT NOT NULL,
  locked_at TEXT NOT NULL,
  locked_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Conversations table (agent-to-agent or task-related)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  type TEXT DEFAULT 'direct' CHECK (type IN ('direct', 'group', 'task')),
  task_id TEXT REFERENCES tasks(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Conversation participants
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, agent_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  sender_agent_id TEXT REFERENCES agents(id),
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'system', 'task_update', 'file')),
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Events table (for live feed)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id),
  task_id TEXT REFERENCES tasks(id),
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Businesses/Workspaces table (legacy - kept for compatibility)
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- OpenClaw session mapping
CREATE TABLE IF NOT EXISTS openclaw_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  openclaw_session_id TEXT NOT NULL,
  channel TEXT,
  status TEXT DEFAULT 'active',
  session_type TEXT DEFAULT 'persistent',
  task_id TEXT REFERENCES tasks(id),
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Task activities table (for real-time activity log)
CREATE TABLE IF NOT EXISTS task_activities (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id),
  activity_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Dispatch attempt timeline (runtime adapter outcomes and retry trail)
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
);


-- Inbound webhook callback delivery replay/idempotency trail
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

-- Runtime maintenance runs, including dispatch-retention cleanup evidence
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

-- Task deliverables table (files, URLs, artifacts)
CREATE TABLE IF NOT EXISTS task_deliverables (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  deliverable_type TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- GitHub write-back logs (bounded sync audit trail)
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
);

-- n8n MCK sync run history (local automation health trail)
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
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source_project_item_id ON tasks(source_project_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_github_issue_unique
  ON tasks(workspace_id, source_repo_owner, source_repo_name, source_issue_number)
  WHERE source_repo_owner IS NOT NULL AND source_repo_name IS NOT NULL AND source_issue_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_github_project_item_unique
  ON tasks(source_project_item_id)
  WHERE source_project_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_activities_task ON task_activities(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_task ON task_dispatch_attempts(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_status ON task_dispatch_attempts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_callback_deliveries_received ON webhook_callback_deliveries(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_callback_deliveries_expires ON webhook_callback_deliveries(expires_at);
CREATE INDEX IF NOT EXISTS idx_runtime_maintenance_runs_type ON runtime_maintenance_runs(run_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliverables_task ON task_deliverables(task_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_sessions_task ON openclaw_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_planning_questions_task ON planning_questions(task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_github_writeback_logs_task ON github_writeback_logs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_n8n_sync_runs_created ON n8n_sync_runs(created_at DESC);
`;
