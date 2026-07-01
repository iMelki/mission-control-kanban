'use client';

import { useState } from 'react';
import { X, Save, Trash2, RadioTower } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import {
  AGENT_RUNTIME_DESCRIPTIONS,
  AGENT_RUNTIME_LABELS,
  AGENT_RUNTIME_TYPES,
  parseAgentRuntimeConfig,
  serializeAgentRuntimeConfig,
} from '@/lib/agent-runtimes';
import type { Agent, AgentRuntimeType, AgentStatus } from '@/lib/types';

interface AgentModalProps {
  agent?: Agent;
  onClose: () => void;
  workspaceId?: string;
  onAgentCreated?: (agentId: string) => void;
}

const EMOJI_OPTIONS = ['🤖', '🦞', '💻', '🔍', '✍️', '🎨', '📊', '🧠', '⚡', '🚀', '🎯', '🔧'];

function formatRuntimeConfig(value: Agent['runtime_config']) {
  const parsed = parseAgentRuntimeConfig(value);
  return Object.keys(parsed).length ? JSON.stringify(parsed, null, 2) : '';
}

type AgentFormState = {
  name: string;
  role: string;
  description: string;
  avatar_emoji: string;
  status: AgentStatus;
  is_master: boolean;
  runtime_type: AgentRuntimeType;
  runtime_config: string;
  dispatch_enabled: boolean;
  soul_md: string;
  user_md: string;
  agents_md: string;
};

function RuntimeDispatchSection({
  form,
  setForm,
}: {
  form: AgentFormState;
  setForm: React.Dispatch<React.SetStateAction<AgentFormState>>;
}) {
  return (
    <section className="rounded-lg border border-mc-border bg-mc-bg/60 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <RadioTower className="w-4 h-4 text-mc-accent mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">Runtime & dispatch</h3>
          <p className="text-xs text-mc-text-secondary">
            Controls whether assignment only tracks ownership or can launch work through a runtime adapter.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label htmlFor="agent-runtime-type" className="block text-sm font-medium mb-1">Runtime type</label>
          <select
            id="agent-runtime-type"
            value={form.runtime_type}
            onChange={(e) => setForm({
              ...form,
              runtime_type: e.target.value as AgentRuntimeType,
              dispatch_enabled: e.target.value === 'manual' ? false : form.dispatch_enabled,
            })}
            className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
          >
            {AGENT_RUNTIME_TYPES.map((runtimeType) => (
              <option key={runtimeType} value={runtimeType}>{AGENT_RUNTIME_LABELS[runtimeType]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-mc-text-secondary">
            {AGENT_RUNTIME_DESCRIPTIONS[form.runtime_type]}
          </p>
        </div>

        <div className="rounded border border-mc-border bg-mc-bg-secondary p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.dispatch_enabled}
              disabled={form.runtime_type === 'manual'}
              onChange={(e) => setForm({ ...form, dispatch_enabled: e.target.checked })}
              className="w-4 h-4 mt-0.5"
            />
            <span>
              <span className="block font-medium">Enable auto-dispatch</span>
              <span className="block text-xs text-mc-text-secondary">
                Manual agents always require handoff. OpenClaw/webhook agents only auto-launch when this is enabled.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div>
        <label htmlFor="agent-runtime-config" className="block text-sm font-medium mb-1">Runtime config JSON</label>
        <textarea
          id="agent-runtime-config"
          value={form.runtime_config}
          onChange={(e) => setForm({ ...form, runtime_config: e.target.value })}
          rows={4}
          className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-mc-accent resize-y"
          placeholder={form.runtime_type === 'webhook' ? '{\n  "webhook_url": "https://example.test/mck",\n  "bearer_token_env": "MCK_WEBHOOK_TOKEN"\n}' : '{\n  "notes": "Optional runtime notes"\n}'}
        />
        <p className="mt-1 text-xs text-mc-text-secondary">
          Store env-var names such as <code>bearer_token_env</code>, not raw secrets.
        </p>
      </div>
    </section>
  );
}

export function AgentModal({ agent, onClose, workspaceId, onAgentCreated }: AgentModalProps) {
  const { addAgent, updateAgent, agents } = useMissionControl();
  const [activeTab, setActiveTab] = useState<'info' | 'soul' | 'user' | 'agents'>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState<AgentFormState>({
    name: agent?.name || '',
    role: agent?.role || '',
    description: agent?.description || '',
    avatar_emoji: agent?.avatar_emoji || '🤖',
    status: agent?.status || 'standby' as AgentStatus,
    is_master: agent?.is_master || false,
    runtime_type: agent?.runtime_type || 'manual' as AgentRuntimeType,
    runtime_config: formatRuntimeConfig(agent?.runtime_config),
    dispatch_enabled: Boolean(agent?.dispatch_enabled),
    soul_md: agent?.soul_md || '',
    user_md: agent?.user_md || '',
    agents_md: agent?.agents_md || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = agent ? `/api/agents/${agent.id}` : '/api/agents';
      const method = agent ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          runtime_config: serializeAgentRuntimeConfig(form.runtime_config),
          workspace_id: workspaceId || agent?.workspace_id || 'default',
        }),
      });

      if (res.ok) {
        const savedAgent = await res.json();
        if (agent) {
          updateAgent(savedAgent);
        } else {
          addAgent(savedAgent);
          // Notify parent if callback provided (e.g., for inline agent creation)
          if (onAgentCreated) {
            onAgentCreated(savedAgent.id);
          }
        }
        onClose();
      }
    } catch (error) {
      console.error('Failed to save agent:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!agent || !confirm(`Delete ${agent.name}?`)) return;

    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
      if (res.ok) {
        // Remove from store
        useMissionControl.setState((state) => ({
          agents: state.agents.filter((a) => a.id !== agent.id),
          selectedAgent: state.selectedAgent?.id === agent.id ? null : state.selectedAgent,
        }));
        onClose();
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  };

  const tabs = [
    { id: 'info', label: 'Info' },
    { id: 'soul', label: 'SOUL.md' },
    { id: 'user', label: 'USER.md' },
    { id: 'agents', label: 'AGENTS.md' },
  ] as const;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border">
          <h2 className="text-lg font-semibold">
            {agent ? `Edit ${agent.name}` : 'Create New Agent'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-mc-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-mc-accent text-mc-accent'
                  : 'border-transparent text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4">
          {activeTab === 'info' && (
            <div className="space-y-4">
              {/* Avatar Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">Avatar</label>
                <div className="flex flex-wrap gap-2">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setForm({ ...form, avatar_emoji: emoji })}
                      className={`text-2xl p-2 rounded hover:bg-mc-bg-tertiary ${
                        form.avatar_emoji === emoji
                          ? 'bg-mc-accent/20 ring-2 ring-mc-accent'
                          : ''
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  placeholder="Agent name"
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  required
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  placeholder="e.g., Code & Automation"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
                  placeholder="What does this agent do?"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as AgentStatus })}
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                >
                  <option value="standby">Standby</option>
                  <option value="working">Working</option>
                  <option value="offline">Offline</option>
                </select>
              </div>

              {/* Master Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_master"
                  checked={form.is_master}
                  onChange={(e) => setForm({ ...form, is_master: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="is_master" className="text-sm">
                  Master Orchestrator (can coordinate other agents)
                </label>
              </div>

              {/* Runtime & dispatch */}
              <RuntimeDispatchSection form={form} setForm={setForm} />
            </div>
          )}

          {activeTab === 'soul' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                SOUL.md - Agent Personality & Identity
              </label>
              <textarea
                value={form.soul_md}
                onChange={(e) => setForm({ ...form, soul_md: e.target.value })}
                rows={15}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent resize-none"
                placeholder="# Agent Name&#10;&#10;Define this agent's personality, values, and communication style..."
              />
            </div>
          )}

          {activeTab === 'user' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                USER.md - Context About the Human
              </label>
              <textarea
                value={form.user_md}
                onChange={(e) => setForm({ ...form, user_md: e.target.value })}
                rows={15}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent resize-none"
                placeholder="# User Context&#10;&#10;Information about the human this agent works with..."
              />
            </div>
          )}

          {activeTab === 'agents' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                AGENTS.md - Team Awareness
              </label>
              <textarea
                value={form.agents_md}
                onChange={(e) => setForm({ ...form, agents_md: e.target.value })}
                rows={15}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent resize-none"
                placeholder="# Team Roster&#10;&#10;Information about other agents this agent works with..."
              />
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-mc-border">
          <div>
            {agent && (
              <button
                type="button"
                onClick={handleDelete}
                className="flex items-center gap-2 px-3 py-2 text-mc-accent-red hover:bg-mc-accent-red/10 rounded text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
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
      </div>
    </div>
  );
}
