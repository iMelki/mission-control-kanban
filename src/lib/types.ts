// Core types for Mission Control

import type {
  DispatchMetadata,
  DispatchReadiness,
  DispatchReviewMode,
  DispatchRiskLevel,
} from './dispatch-contract';

export type AgentStatus = 'standby' | 'working' | 'offline';

export type AgentRuntimeType = 'manual' | 'openclaw' | 'webhook';

export interface AgentRuntimeConfig {
  notes?: string;
  url?: string;
  webhook_url?: string;
  bearer_token_env?: string;
  signature_secret_env?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export type TaskStatus = 'planning' | 'inbox' | 'assigned' | 'in_progress' | 'testing' | 'review' | 'done';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type MessageType = 'text' | 'system' | 'task_update' | 'file';

export type ConversationType = 'direct' | 'group' | 'task';

export type EventType =
  | 'task_created'
  | 'task_assigned'
  | 'task_status_changed'
  | 'task_completed'
  | 'message_sent'
  | 'agent_status_changed'
  | 'agent_joined'
  | 'task_dispatched'
  | 'task_dispatch_failed'
  | 'task_dispatch_retry'
  | 'system';

export type DispatchAttemptStatus = 'manual' | 'success' | 'failed' | 'timeout' | 'skipped' | 'retrying';

export interface TaskDispatchAttempt {
  id: string;
  task_id: string;
  agent_id?: string | null;
  runtime_type: AgentRuntimeType;
  adapter_name?: string | null;
  status: DispatchAttemptStatus;
  attempt_number: number;
  message: string;
  http_status?: number | null;
  webhook_url?: string | null;
  error_message?: string | null;
  request_payload?: string | null;
  response_body?: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  description?: string;
  avatar_emoji: string;
  status: AgentStatus;
  is_master: boolean;
  runtime_type: AgentRuntimeType;
  runtime_config?: AgentRuntimeConfig | string | null;
  dispatch_enabled: boolean | number;
  workspace_id: string;
  soul_md?: string;
  user_md?: string;
  agents_md?: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubSourceIdentity {
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  issue_url: string;
  project_item_id?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_agent_id?: string;
  created_by_agent_id?: string;
  workspace_id: string;
  business_id: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
  github_source?: GitHubSourceIdentity;
  dispatch_metadata?: DispatchMetadata;
  dispatch_ready?: boolean;
  dispatch_blockers?: string[];
  // Joined fields
  assigned_agent?: Agent;
  created_by_agent?: Agent;
}

export interface Conversation {
  id: string;
  title?: string;
  type: ConversationType;
  task_id?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  participants?: Agent[];
  last_message?: Message;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_agent_id?: string;
  content: string;
  message_type: MessageType;
  metadata?: string;
  created_at: string;
  // Joined fields
  sender?: Agent;
}

export interface Event {
  id: string;
  type: EventType;
  agent_id?: string;
  task_id?: string;
  message: string;
  metadata?: string;
  created_at: string;
  // Joined fields
  agent?: Agent;
  task?: Task;
}

export interface Business {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface WorkspaceRuntimePolicy {
  default_runtime_type: AgentRuntimeType;
  default_runtime_config?: AgentRuntimeConfig | string | null;
  default_dispatch_enabled: boolean | number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon: string;
  github_project_owner?: string | null;
  github_project_number?: number | null;
  github_project_title?: string | null;
  github_project_url?: string | null;
  github_project_auto_refresh?: boolean | number | null;
  default_runtime_type?: AgentRuntimeType | string | null;
  default_runtime_config?: AgentRuntimeConfig | string | null;
  default_dispatch_enabled?: boolean | number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceStats {
  id: string;
  name: string;
  slug: string;
  icon: string;
  description?: string;
  github_project_owner?: string | null;
  github_project_number?: number | null;
  github_project_title?: string | null;
  github_project_url?: string | null;
  github_project_auto_refresh?: boolean | number | null;
  default_runtime_type?: AgentRuntimeType | string | null;
  default_runtime_config?: AgentRuntimeConfig | string | null;
  default_dispatch_enabled?: boolean | number | null;
  taskCounts: {
    planning: number;
    inbox: number;
    assigned: number;
    in_progress: number;
    testing: number;
    review: number;
    done: number;
    total: number;
  };
  agentCount: number;
}

export interface OpenClawSession {
  id: string;
  agent_id: string;
  openclaw_session_id: string;
  channel?: string;
  status: string;
  session_type: 'persistent' | 'subagent';
  task_id?: string;
  ended_at?: string;
  created_at: string;
  updated_at: string;
}

export type ActivityType =
  | 'spawned'
  | 'updated'
  | 'completed'
  | 'file_created'
  | 'status_changed'
  | 'github_writeback';

export interface TaskActivity {
  id: string;
  task_id: string;
  agent_id?: string;
  activity_type: ActivityType;
  message: string;
  metadata?: string;
  created_at: string;
  // Joined fields
  agent?: Agent;
}

export type GitHubWritebackMode = 'dry_run' | 'apply';
export type GitHubWritebackStatus = 'planned' | 'applied' | 'skipped' | 'failed';

export interface GitHubWritebackLog {
  id: string;
  task_id: string;
  mode: GitHubWritebackMode;
  status: GitHubWritebackStatus;
  signature: string;
  issue_comment_body?: string | null;
  project_updates?: string | null;
  response_payload?: string | null;
  error_message?: string | null;
  created_at: string;
}

export type MckN8nSyncAlertLevel = 'ok' | 'warning' | 'error' | 'unknown';

export interface MckN8nSyncSummary {
  scanned_items?: number;
  imported?: number;
  updated?: number;
  moved?: number;
  skipped?: number;
  skipped_closed?: number;
  status_reconciled?: number;
  upstream_drift_warnings?: number;
  errors?: number;
  failed?: number;
  [key: string]: unknown;
}

export interface MckN8nSyncRun {
  id: string;
  workflow_id: string;
  workflow_name: string;
  mode: string;
  dry_run: boolean;
  ok: boolean;
  alert_level: MckN8nSyncAlertLevel;
  alert_message?: string | null;
  base_url?: string | null;
  workspaces: string[];
  summary?: MckN8nSyncSummary | null;
  results?: unknown[] | null;
  raw_payload?: Record<string, unknown> | null;
  received_at: string;
  created_at: string;
}

export interface MckN8nSyncStatusResponse {
  ok: boolean;
  latest: MckN8nSyncRun | null;
  history: MckN8nSyncRun[];
}

export type DeliverableType = 'file' | 'url' | 'artifact';

export interface TaskDeliverable {
  id: string;
  task_id: string;
  deliverable_type: DeliverableType;
  title: string;
  path?: string;
  description?: string;
  created_at: string;
}

// Planning types
export type PlanningQuestionType = 'multiple_choice' | 'text' | 'yes_no';

export type PlanningCategory =
  | 'goal'
  | 'audience'
  | 'scope'
  | 'design'
  | 'content'
  | 'technical'
  | 'timeline'
  | 'constraints';

export interface PlanningQuestionOption {
  id: string;
  label: string;
}

export interface PlanningQuestion {
  id: string;
  task_id: string;
  category: PlanningCategory;
  question: string;
  question_type: PlanningQuestionType;
  options?: PlanningQuestionOption[];
  answer?: string;
  answered_at?: string;
  sort_order: number;
  created_at: string;
}

export interface PlanningSpec {
  id: string;
  task_id: string;
  spec_markdown: string;
  locked_at: string;
  locked_by?: string;
  created_at: string;
}

export interface PlanningState {
  questions: PlanningQuestion[];
  spec?: PlanningSpec;
  progress: {
    total: number;
    answered: number;
    percentage: number;
  };
  isLocked: boolean;
}

// API request/response types
export interface UpdateWorkspaceRuntimePolicyRequest {
  default_runtime_type?: AgentRuntimeType;
  default_runtime_config?: AgentRuntimeConfig | string | null;
  default_dispatch_enabled?: boolean;
}

export interface CreateAgentRequest {
  name: string;
  role: string;
  description?: string;
  avatar_emoji?: string;
  is_master?: boolean;
  runtime_type?: AgentRuntimeType;
  runtime_config?: AgentRuntimeConfig | string | null;
  dispatch_enabled?: boolean;
  soul_md?: string;
  user_md?: string;
  agents_md?: string;
}

export interface UpdateAgentRequest extends Partial<CreateAgentRequest> {
  status?: AgentStatus;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigned_agent_id?: string;
  created_by_agent_id?: string;
  business_id?: string;
  due_date?: string;
  github_source?: GitHubSourceIdentity | null;
  dispatch_metadata?: DispatchMetadata;
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: TaskStatus;
  github_source?: GitHubSourceIdentity | null;
}

export interface SendMessageRequest {
  conversation_id: string;
  sender_agent_id: string;
  content: string;
  message_type?: MessageType;
  metadata?: string;
}

// OpenClaw WebSocket message types
export interface OpenClawMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface OpenClawSessionInfo {
  id: string;
  channel: string;
  peer?: string;
  model?: string;
  status: string;
}

// OpenClaw history message format (from Gateway)
export interface OpenClawHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

// Agent with OpenClaw session info (extended for UI use)
export interface AgentWithOpenClaw extends Agent {
  openclawSession?: OpenClawSession | null;
}

// Real-time SSE event types
export type SSEEventType =
  | 'task_updated'
  | 'task_created'
  | 'task_deleted'
  | 'activity_logged'
  | 'deliverable_added'
  | 'agent_spawned'
  | 'agent_completed';

export interface SSEEvent {
  type: SSEEventType;
  payload: Task | TaskActivity | TaskDeliverable | {
    taskId: string;
    sessionId: string;
    agentName?: string;
    summary?: string;
    deleted?: boolean;
  } | {
    id: string;  // For task_deleted events
  };
}

export type { DispatchMetadata, DispatchReadiness, DispatchReviewMode, DispatchRiskLevel };
