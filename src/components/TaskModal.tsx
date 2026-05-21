'use client';

import { useState } from 'react';
import { X, Save, Trash2, Activity, Package, Bot, ClipboardList, Plus, AlertTriangle } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { ActivityLog } from './ActivityLog';
import { DeliverablesList } from './DeliverablesList';
import { SessionsList } from './SessionsList';
import { PlanningTab } from './PlanningTab';
import { AgentModal } from './AgentModal';
import { GitHubWritebackPanel } from './GitHubWritebackPanel';
import { READINESS_LABELS, REVIEW_MODE_LABELS, RISK_LEVEL_LABELS } from '@/lib/dispatch-contract';
import type {
  Task,
  TaskPriority,
  TaskStatus,
  DispatchReadiness,
  DispatchReviewMode,
  DispatchRiskLevel,
} from '@/lib/types';

type TabType = 'overview' | 'planning' | 'activity' | 'deliverables' | 'sessions';

interface TaskModalProps {
  task?: Task;
  onClose: () => void;
  workspaceId?: string;
}

function joinLines(values?: string[]) {
  return values?.join('\n') ?? '';
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function TaskModal({ task, onClose, workspaceId }: TaskModalProps) {
  const { agents, addTask, updateTask, addEvent } = useMissionControl();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [usePlanningMode, setUsePlanningMode] = useState(false);
  // Auto-switch to planning tab if task is in planning status
  const [activeTab, setActiveTab] = useState<TabType>(task?.status === 'planning' ? 'planning' : 'overview');

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    priority: task?.priority || 'normal' as TaskPriority,
    status: task?.status || 'inbox' as TaskStatus,
    assigned_agent_id: task?.assigned_agent_id || '',
    due_date: task?.due_date || '',
    dispatch_source_issue_url: task?.dispatch_metadata?.source_issue_url || '',
    dispatch_target_repo: task?.dispatch_metadata?.target_repo || '',
    dispatch_project_workstream: task?.dispatch_metadata?.project_workstream || '',
    dispatch_allowed_file_scope: joinLines(task?.dispatch_metadata?.allowed_file_scope),
    dispatch_acceptance_criteria: joinLines(task?.dispatch_metadata?.acceptance_criteria),
    dispatch_test_requirements: joinLines(task?.dispatch_metadata?.test_requirements),
    dispatch_risk_level: task?.dispatch_metadata?.risk_level || 'medium' as DispatchRiskLevel,
    dispatch_readiness: task?.dispatch_metadata?.readiness || 'needs_grooming' as DispatchReadiness,
    dispatch_review_mode: task?.dispatch_metadata?.review_mode || 'human_required' as DispatchReviewMode,
    dispatch_impact: task?.dispatch_metadata?.impact || '',
    dispatch_rollback_plan: task?.dispatch_metadata?.rollback_plan || '',
    dispatch_safety_rules: joinLines(task?.dispatch_metadata?.safety_rules),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = task ? `/api/tasks/${task.id}` : '/api/tasks';
      const method = task ? 'PATCH' : 'POST';

      const dispatchMetadata = {
        source_issue_url: form.dispatch_source_issue_url,
        target_repo: form.dispatch_target_repo,
        project_workstream: form.dispatch_project_workstream,
        allowed_file_scope: splitLines(form.dispatch_allowed_file_scope),
        acceptance_criteria: splitLines(form.dispatch_acceptance_criteria),
        test_requirements: splitLines(form.dispatch_test_requirements),
        risk_level: form.dispatch_risk_level,
        readiness: form.dispatch_readiness,
        review_mode: form.dispatch_review_mode,
        impact: form.dispatch_impact,
        rollback_plan: form.dispatch_rollback_plan,
        safety_rules: splitLines(form.dispatch_safety_rules),
      };

      const payload = {
        ...form,
        // If planning mode is enabled for new tasks, override status to 'planning'
        status: (!task && usePlanningMode) ? 'planning' : form.status,
        assigned_agent_id: form.assigned_agent_id || null,
        due_date: form.due_date || null,
        workspace_id: workspaceId || task?.workspace_id || 'default',
        dispatch_metadata: dispatchMetadata,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const savedTask = await res.json();

        if (task) {
          updateTask(savedTask);
          onClose();
        } else {
          addTask(savedTask);
          addEvent({
            id: crypto.randomUUID(),
            type: 'task_created',
            task_id: savedTask.id,
            message: `New task: ${savedTask.title}`,
            created_at: new Date().toISOString(),
          });

          // If planning mode is enabled, auto-generate questions and keep modal open
          if (usePlanningMode) {
            // Trigger question generation in background
            fetch(`/api/tasks/${savedTask.id}/planning`, { method: 'POST' })
              .then(() => {
                // Update our local task reference and switch to planning tab
                updateTask({ ...savedTask, status: 'planning' });
              })
              .catch(console.error);

            // Log the planning start
            addEvent({
              id: crypto.randomUUID(),
              type: 'task_status_changed',
              task_id: savedTask.id,
              message: `📋 Planning started for: ${savedTask.title}`,
              created_at: new Date().toISOString(),
            });
          }
          onClose();
        }
      }
    } catch (error) {
      console.error('Failed to save task:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!task || !confirm(`Delete \"${task.title}\"?`)) return;

    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (res.ok) {
        useMissionControl.setState((state) => ({
          tasks: state.tasks.filter((t) => t.id !== task.id),
        }));
        onClose();
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const statuses: TaskStatus[] = ['planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'done'];
  const priorities: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
  const readinessOptions: DispatchReadiness[] = ['raw', 'needs_grooming', 'ready_for_agent', 'needs_human'];
  const reviewModeOptions: DispatchReviewMode[] = ['human_required', 'auto_checks_only', 'pair_review'];
  const riskOptions: DispatchRiskLevel[] = ['low', 'medium', 'high', 'critical'];

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: null },
    { id: 'planning' as TabType, label: 'Planning', icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'activity' as TabType, label: 'Activity', icon: <Activity className="w-4 h-4" /> },
    { id: 'deliverables' as TabType, label: 'Deliverables', icon: <Package className="w-4 h-4" /> },
    { id: 'sessions' as TabType, label: 'Sessions', icon: <Bot className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border flex-shrink-0">
          <h2 className="text-lg font-semibold">
            {task ? task.title : 'Create New Task'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs - only show for existing tasks */}
        {task && (
          <div className="flex border-b border-mc-border flex-shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-mc-accent border-b-2 border-mc-accent'
                    : 'text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              placeholder="What needs to be done?"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
              placeholder="Add details..."
            />
          </div>

          {task?.dispatch_blockers && task.dispatch_blockers.length > 0 && (
            <div className="p-3 rounded-lg border border-rose-500/20 bg-rose-500/10">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-300 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-rose-200">Dispatch is currently blocked</p>
                  <p className="mt-1 text-xs text-rose-100">
                    The task can stay in <strong>Inbox</strong>, but moving it into active states like
                    <strong> Assigned</strong>, <strong>In Progress</strong>, <strong>Testing</strong>,
                    <strong> Review</strong>, or <strong>Done</strong> is blocked until the dispatch contract below is complete.
                  </p>
                  <ul className="mt-1 text-xs text-rose-100 space-y-1 list-disc list-inside">
                    {task.dispatch_blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Planning Mode Toggle - only for new tasks */}
          {!task && (
            <div className="p-3 bg-mc-bg rounded-lg border border-mc-border">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={usePlanningMode}
                  onChange={(e) => setUsePlanningMode(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-mc-border"
                />
                <div>
                  <span className="font-medium text-sm flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-mc-accent" />
                    Enable Planning Mode
                  </span>
                  <p className="text-xs text-mc-text-secondary mt-1">
                    Best for complex projects that need detailed requirements.
                    You&apos;ll answer a few questions to define scope, goals, and constraints
                    before work begins. Skip this for quick, straightforward tasks.
                  </p>
                </div>
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Status */}
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ').toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Assigned Agent */}
          <div>
            <label className="block text-sm font-medium mb-1">Assign to</label>
            <select
              value={form.assigned_agent_id}
              onChange={(e) => {
                if (e.target.value === '__add_new__') {
                  setShowAgentModal(true);
                } else {
                  setForm({ ...form, assigned_agent_id: e.target.value });
                }
              }}
              className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
            >
              <option value="">Unassigned</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.avatar_emoji} {agent.name} - {agent.role}
                </option>
              ))}
              <option value="__add_new__" className="text-mc-accent">
                ➕ Add new agent...
              </option>
            </select>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-sm font-medium mb-1">Due Date</label>
            <input
              type="datetime-local"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
            />
          </div>

          <div className="pt-2 border-t border-mc-border space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Dispatch Contract</h3>
              <p className="text-xs text-mc-text-secondary mt-1">
                These fields mirror the GitHub-native readiness contract used to decide whether auto-dispatch is safe.
              </p>
              {task?.status === 'inbox' && task.dispatch_blockers && task.dispatch_blockers.length > 0 && (
                <p className="text-xs text-amber-200 mt-2">
                  Why this task is still in Inbox: it is missing one or more required dispatch fields. Fill the scope,
                  acceptance criteria, tests, review mode, impact, and rollback plan here, then save before moving it forward.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Source Issue URL</label>
              <input
                type="url"
                value={form.dispatch_source_issue_url}
                onChange={(e) => setForm({ ...form, dispatch_source_issue_url: e.target.value })}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                placeholder="https://github.com/owner/repo/issues/123"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Target Repo</label>
                <input
                  type="text"
                  value={form.dispatch_target_repo}
                  onChange={(e) => setForm({ ...form, dispatch_target_repo: e.target.value })}
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  placeholder="iMelki/mission-control"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Project / Workstream</label>
                <input
                  type="text"
                  value={form.dispatch_project_workstream}
                  onChange={(e) => setForm({ ...form, dispatch_project_workstream: e.target.value })}
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  placeholder="projects-ops rollout"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Readiness</label>
                <select
                  value={form.dispatch_readiness}
                  onChange={(e) => setForm({ ...form, dispatch_readiness: e.target.value as DispatchReadiness })}
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                >
                  {readinessOptions.map((value) => (
                    <option key={value} value={value}>{READINESS_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Review Mode</label>
                <select
                  value={form.dispatch_review_mode}
                  onChange={(e) => setForm({ ...form, dispatch_review_mode: e.target.value as DispatchReviewMode })}
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                >
                  {reviewModeOptions.map((value) => (
                    <option key={value} value={value}>{REVIEW_MODE_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Risk Level</label>
                <select
                  value={form.dispatch_risk_level}
                  onChange={(e) => setForm({ ...form, dispatch_risk_level: e.target.value as DispatchRiskLevel })}
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                >
                  {riskOptions.map((value) => (
                    <option key={value} value={value}>{RISK_LEVEL_LABELS[value]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Impact</label>
              <input
                type="text"
                value={form.dispatch_impact}
                onChange={(e) => setForm({ ...form, dispatch_impact: e.target.value })}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                placeholder="Docs only / code / infra / security"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Allowed File Scope</label>
              <textarea
                value={form.dispatch_allowed_file_scope}
                onChange={(e) => setForm({ ...form, dispatch_allowed_file_scope: e.target.value })}
                rows={3}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
                placeholder="One file or path per line"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Acceptance Criteria</label>
              <textarea
                value={form.dispatch_acceptance_criteria}
                onChange={(e) => setForm({ ...form, dispatch_acceptance_criteria: e.target.value })}
                rows={3}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
                placeholder="One acceptance criterion per line"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Test Requirements</label>
              <textarea
                value={form.dispatch_test_requirements}
                onChange={(e) => setForm({ ...form, dispatch_test_requirements: e.target.value })}
                rows={3}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
                placeholder="One verification command or expected test per line"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Safety Rules</label>
              <textarea
                value={form.dispatch_safety_rules}
                onChange={(e) => setForm({ ...form, dispatch_safety_rules: e.target.value })}
                rows={2}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
                placeholder="One guardrail per line"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Rollback / Fallback Plan</label>
              <textarea
                value={form.dispatch_rollback_plan}
                onChange={(e) => setForm({ ...form, dispatch_rollback_plan: e.target.value })}
                rows={3}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
                placeholder="How to contain or revert the change if dispatch goes wrong"
              />
            </div>

            {task?.github_source && (
              <GitHubWritebackPanel task={task} />
            )}
          </div>
            </form>
          )}

          {/* Planning Tab */}
          {activeTab === 'planning' && task && (
            <PlanningTab
              taskId={task.id}
              onSpecLocked={() => {
                // Refresh task data when spec is locked
                window.location.reload();
              }}
            />
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && task && (
            <ActivityLog taskId={task.id} />
          )}

          {/* Deliverables Tab */}
          {activeTab === 'deliverables' && task && (
            <DeliverablesList taskId={task.id} />
          )}

          {/* Sessions Tab */}
          {activeTab === 'sessions' && task && (
            <SessionsList taskId={task.id} />
          )}
        </div>

        {/* Footer - only show on overview tab */}
        {activeTab === 'overview' && (
          <div className="flex items-center justify-between p-4 border-t border-mc-border flex-shrink-0">
            <div className="flex gap-2">
              {task && (
                <>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="flex items-center gap-2 px-3 py-2 text-mc-accent-red hover:bg-mc-accent-red/10 rounded text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nested Agent Modal for inline agent creation */}
      {showAgentModal && (
        <AgentModal
          workspaceId={workspaceId}
          onClose={() => setShowAgentModal(false)}
          onAgentCreated={(agentId) => {
            // Auto-select the newly created agent
            setForm({ ...form, assigned_agent_id: agentId });
            setShowAgentModal(false);
          }}
        />
      )}
    </div>
  );
}
