'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Plus, Bot, ChevronLeft, ChevronRight, Zap, ZapOff, Loader2, X } from 'lucide-react';
import { EntityEmoji } from '@/components/ui/EntityEmoji';
import { useMissionControl } from '@/lib/store';
import type { Agent, AgentRuntimeType, AgentStatus, OpenClawSession } from '@/lib/types';
import { AGENT_RUNTIME_LABELS, resolveAgentRuntime } from '@/lib/agent-runtimes';
import { AgentModal } from './AgentModal';

type FilterTab = 'all' | 'working' | 'standby';

interface AgentsSidebarProps {
  workspaceId?: string;
}

const COLLAPSED_STORAGE_KEY = 'mck:agents-sidebar-collapsed';
const COLLAPSED_CHANGE_EVENT = 'mck:agents-sidebar-collapsed-change';

function readCollapsedPreference() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
}

function persistCollapsedPreference(value: boolean) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(value));
    window.dispatchEvent(new Event(COLLAPSED_CHANGE_EVENT));
  }
}

function subscribeCollapsedPreference(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;

  window.addEventListener(COLLAPSED_CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(COLLAPSED_CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function getServerCollapsedPreference() {
  return false;
}

export function AgentsSidebar({ workspaceId }: AgentsSidebarProps) {
  const { agents, selectedAgent, setSelectedAgent, agentOpenClawSessions, setAgentOpenClawSession } = useMissionControl();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [connectingAgentId, setConnectingAgentId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<{ agentName: string; message: string } | null>(null);
  const [activeSubAgents, setActiveSubAgents] = useState(0);
  const isCollapsed = useSyncExternalStore(
    subscribeCollapsedPreference,
    readCollapsedPreference,
    getServerCollapsedPreference
  );

  const setIsCollapsed = useCallback((value: boolean) => {
    persistCollapsedPreference(value);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadOpenClawSessions = async () => {
      for (const agent of agents) {
        try {
          const res = await fetch(`/api/agents/${agent.id}/openclaw`);
          if (res.ok) {
            const data = await res.json();
            if (!cancelled && data.linked && data.session) {
              setAgentOpenClawSession(agent.id, data.session as OpenClawSession);
            }
          }
        } catch (error) {
          console.error(`Failed to load OpenClaw session for ${agent.name}:`, error);
        }
      }
    };

    if (agents.length > 0) {
      void loadOpenClawSessions();
    }

    return () => {
      cancelled = true;
    };
  }, [agents, setAgentOpenClawSession]);

  useEffect(() => {
    const loadSubAgentCount = async () => {
      try {
        const res = await fetch('/api/openclaw/sessions?session_type=subagent&status=active');
        if (res.ok) {
          const sessions = await res.json();
          setActiveSubAgents(sessions.length);
        }
      } catch (error) {
        console.error('Failed to load sub-agent count:', error);
      }
    };

    loadSubAgentCount();

    const interval = setInterval(loadSubAgentCount, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectToOpenClaw = async (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    setConnectingAgentId(agent.id);
    setConnectError(null);

    try {
      const existingSession = agentOpenClawSessions[agent.id];

      if (existingSession) {
        const res = await fetch(`/api/agents/${agent.id}/openclaw`, { method: 'DELETE' });
        if (res.ok) {
          setAgentOpenClawSession(agent.id, null);
        } else {
          const error = await res.json().catch(() => null);
          console.error('Failed to disconnect from OpenClaw:', error);
          setConnectError({ agentName: agent.name, message: error?.error || 'Failed to disconnect OpenClaw session' });
        }
      } else {
        const res = await fetch(`/api/agents/${agent.id}/openclaw`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          setAgentOpenClawSession(agent.id, data.session as OpenClawSession);
        } else {
          const error = await res.json();
          console.error('Failed to connect to OpenClaw:', error);
          setConnectError({ agentName: agent.name, message: error.error || 'Unknown error' });
        }
      }
    } catch (error) {
      console.error('OpenClaw connection error:', error);
      setConnectError({ agentName: agent.name, message: 'Connection request failed' });
    } finally {
      setConnectingAgentId(null);
    }
  };

  const filteredAgents = agents.filter((agent) => {
    if (filter === 'all') return true;
    return agent.status === filter;
  });

  return (
    <>
      {/*
        Below lg this rail is a full-width stacked section with a bounded height;
        from lg up it returns to the fixed-width side rail (#142).
      */}
      <aside
        className={`shrink-0 bg-mc-bg-secondary border-b lg:border-b-0 lg:border-r border-mc-border flex flex-col overflow-hidden w-full max-h-[45vh] lg:max-h-none ${
          isCollapsed ? 'lg:w-12' : 'lg:w-64'
        }`}
        aria-label="Agents sidebar"
      >
        {isCollapsed ? (
          <AgentsCollapsedRail
            agentCount={agents.length}
            activeSubAgents={activeSubAgents}
            onExpand={() => setIsCollapsed(false)}
            onAddAgent={() => setShowCreateModal(true)}
          />
        ) : (
          <>
            {connectError && (
              <div
                role="alert"
                className="m-2 flex items-start gap-2 rounded border border-mc-accent-red/40 bg-mc-accent-red/10 p-2 text-xs text-mc-text"
              >
                <p className="m-0 flex-1">
                  Failed to connect {connectError.agentName} to OpenClaw: {connectError.message}
                </p>
                <button
                  type="button"
                  aria-label="Dismiss connection error"
                  onClick={() => setConnectError(null)}
                  className="rounded p-0.5 text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <AgentsExpandedPanel
              agents={filteredAgents}
              allAgents={agents}
              allAgentCount={agents.length}
              activeSubAgents={activeSubAgents}
              filter={filter}
              selectedAgent={selectedAgent}
              connectingAgentId={connectingAgentId}
              agentOpenClawSessions={agentOpenClawSessions}
              onFilterChange={setFilter}
              onCollapse={() => setIsCollapsed(true)}
              onAddAgent={() => setShowCreateModal(true)}
              onSelectAgent={(agent) => {
                setSelectedAgent(agent);
                setEditingAgent(agent);
              }}
              onConnectToOpenClaw={handleConnectToOpenClaw}
            />
          </>
        )}
      </aside>

      {showCreateModal && (
        <AgentModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} />
      )}
      {editingAgent && (
        <AgentModal
          agent={editingAgent}
          onClose={() => setEditingAgent(null)}
          workspaceId={workspaceId}
        />
      )}
    </>
  );
}

function AgentsCollapsedRail({
  agentCount,
  activeSubAgents,
  onExpand,
  onAddAgent,
}: {
  agentCount: number;
  activeSubAgents: number;
  onExpand: () => void;
  onAddAgent: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center gap-3 py-3">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand agents sidebar"
        title="Expand agents sidebar"
        className="rounded p-2 text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <Bot aria-hidden="true" className="w-5 h-5 text-mc-text-secondary" />
      <span className="rounded bg-mc-bg-tertiary px-2 py-0.5 text-xs text-mc-text-secondary">
        {agentCount}
      </span>
      {activeSubAgents > 0 && (
        <span
          className="rounded bg-green-500/20 px-2 py-0.5 text-xs font-bold text-green-400"
          title={`${activeSubAgents} active sub-agents`}
        >
          {activeSubAgents}
        </span>
      )}
      <button
        type="button"
        onClick={onAddAgent}
        aria-label="Add agent"
        title="Add agent"
        className="mt-auto rounded p-2 text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

function AgentsExpandedPanel({
  agents,
  allAgents,
  allAgentCount,
  activeSubAgents,
  filter,
  selectedAgent,
  connectingAgentId,
  agentOpenClawSessions,
  onFilterChange,
  onCollapse,
  onAddAgent,
  onSelectAgent,
  onConnectToOpenClaw,
}: {
  agents: Agent[];
  allAgents: Agent[];
  allAgentCount: number;
  activeSubAgents: number;
  filter: FilterTab;
  selectedAgent: Agent | null;
  connectingAgentId: string | null;
  agentOpenClawSessions: Record<string, OpenClawSession | null>;
  onFilterChange: (filter: FilterTab) => void;
  onCollapse: () => void;
  onAddAgent: () => void;
  onSelectAgent: (agent: Agent) => void;
  onConnectToOpenClaw: (agent: Agent, e: React.MouseEvent) => void;
}) {
  return (
    <>
      <AgentsPanelHeader
        activeSubAgents={activeSubAgents}
        agentCount={allAgentCount}
        agents={allAgents}
        filter={filter}
        onCollapse={onCollapse}
        onFilterChange={onFilterChange}
      />
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            isSelected={selectedAgent?.id === agent.id}
            isConnecting={connectingAgentId === agent.id}
            openclawSession={agentOpenClawSessions[agent.id]}
            onSelect={() => onSelectAgent(agent)}
            onConnectToOpenClaw={(event) => onConnectToOpenClaw(agent, event)}
          />
        ))}
      </div>
      <div className="p-3 border-t border-mc-border">
        <button
          type="button"
          onClick={onAddAgent}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-mc-bg-tertiary hover:bg-mc-border rounded text-sm text-mc-text-secondary hover:text-mc-text transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Agent
        </button>
      </div>
    </>
  );
}


function getRuntimeAuditCounts(agents: Agent[]) {
  const counts: Record<AgentRuntimeType | 'dispatch_off', number> = {
    manual: 0,
    openclaw: 0,
    webhook: 0,
    dispatch_off: 0,
  };

  for (const agent of agents) {
    const runtime = resolveAgentRuntime(agent);
    counts[runtime.requested_type] += 1;
    if (runtime.reason) counts.dispatch_off += 1;
  }

  return counts;
}

function getRuntimeHealth(agent: Agent, openclawSession?: OpenClawSession | null) {
  const runtime = resolveAgentRuntime(agent);
  if (runtime.effective_type === 'manual') {
    return { label: runtime.reason ? 'Manual / off' : 'Manual', className: 'bg-mc-bg text-mc-text-secondary border-mc-border' };
  }
  if (runtime.effective_type === 'openclaw') {
    return openclawSession
      ? { label: 'OpenClaw ready', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' }
      : { label: 'OpenClaw link?', className: 'bg-amber-500/10 text-amber-300 border-amber-500/30' };
  }
  return { label: 'Webhook ready', className: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' };
}

function AgentsPanelHeader({
  activeSubAgents,
  agentCount,
  agents,
  filter,
  onCollapse,
  onFilterChange,
}: {
  activeSubAgents: number;
  agentCount: number;
  agents: Agent[];
  filter: FilterTab;
  onCollapse: () => void;
  onFilterChange: (filter: FilterTab) => void;
}) {
  return (
    <div className="p-3 border-b border-mc-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
          <span className="text-sm font-medium uppercase tracking-wider">Agents</span>
          <span className="bg-mc-bg-tertiary text-mc-text-secondary text-xs px-2 py-0.5 rounded">
            {agentCount}
          </span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse agents sidebar"
          title="Collapse agents sidebar"
          className="rounded p-1 text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
      {activeSubAgents > 0 && (
        <div className="mb-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-400">●</span>
            <span className="text-mc-text">Active Sub-Agents:</span>
            <span className="font-bold text-green-400">{activeSubAgents}</span>
          </div>
        </div>
      )}
      <RuntimeAuditSummary agents={agents} />
      <div className="flex gap-1">
        {(['all', 'working', 'standby'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onFilterChange(tab)}
            className={`px-3 py-1 text-xs rounded uppercase ${
              filter === tab
                ? 'bg-mc-accent text-mc-bg font-medium'
                : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}


function RuntimeAuditSummary({ agents }: { agents: Agent[] }) {
  const counts = getRuntimeAuditCounts(agents);
  return (
    <div className="mb-3 rounded-lg border border-mc-border/60 bg-mc-bg/70 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-mc-text-secondary">Runtime audit</span>
        <span className="text-[10px] text-mc-text-secondary">post-migration</span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <span className="rounded border border-mc-border/50 px-2 py-1 text-mc-text-secondary">Manual {counts.manual}</span>
        <span className="rounded border border-emerald-500/30 px-2 py-1 text-emerald-300">OpenClaw {counts.openclaw}</span>
        <span className="rounded border border-cyan-500/30 px-2 py-1 text-cyan-300">Webhook {counts.webhook}</span>
        <span className="rounded border border-amber-500/30 px-2 py-1 text-amber-300">Off {counts.dispatch_off}</span>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  isSelected,
  isConnecting,
  openclawSession,
  onSelect,
  onConnectToOpenClaw,
}: {
  agent: Agent;
  isSelected: boolean;
  isConnecting: boolean;
  openclawSession?: OpenClawSession | null;
  onSelect: () => void;
  onConnectToOpenClaw: (e: React.MouseEvent) => void;
}) {
  const runtime = resolveAgentRuntime(agent);
  const runtimeHealth = getRuntimeHealth(agent, openclawSession);

  return (
    <div
      className={`w-full rounded hover:bg-mc-bg-tertiary transition-colors ${
        isSelected ? 'bg-mc-bg-tertiary' : ''
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full flex items-center gap-3 p-2 text-left">
        <div className="text-2xl relative">
          <EntityEmoji emoji={agent.avatar_emoji} hidden />
          {openclawSession && (
            <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-mc-bg-secondary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{agent.name}</span>
            {!!agent.is_master && <span className="text-xs text-mc-accent-yellow">★</span>}
          </div>
          <div className="text-xs text-mc-text-secondary truncate">{agent.role}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className={`rounded border px-2 py-0.5 text-[10px] ${runtimeHealth.className}`}>
              {runtimeHealth.label}
            </span>
            <span className="rounded border border-mc-border/50 px-2 py-0.5 text-[10px] text-mc-text-secondary">
              {AGENT_RUNTIME_LABELS[runtime.requested_type]}
            </span>
          </div>
          {runtime.reason && (
            <div className="mt-1 rounded border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
              Why off: {runtime.reason}
            </div>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded uppercase ${getStatusBadge(agent.status)}`}>
          {agent.status}
        </span>
      </button>
      {!!agent.is_master && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={onConnectToOpenClaw}
            disabled={isConnecting}
            className={`w-full flex items-center justify-center gap-2 px-2 py-1 rounded text-xs transition-colors ${
              openclawSession
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-mc-bg text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text'
            }`}
          >
            <OpenClawButtonContent isConnecting={isConnecting} openclawSession={openclawSession} />
          </button>
        </div>
      )}
    </div>
  );
}

function OpenClawButtonContent({
  isConnecting,
  openclawSession,
}: {
  isConnecting: boolean;
  openclawSession?: OpenClawSession | null;
}) {
  if (isConnecting) {
    return (
      <>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Connecting...</span>
      </>
    );
  }

  if (openclawSession) {
    return (
      <>
        <Zap className="w-3 h-3" />
        <span>OpenClaw Connected</span>
      </>
    );
  }

  return (
    <>
      <ZapOff className="w-3 h-3" />
      <span>Connect to OpenClaw</span>
    </>
  );
}

function getStatusBadge(status: AgentStatus) {
  const styles = {
    standby: 'status-standby',
    working: 'status-working',
    offline: 'status-offline',
  };
  return styles[status] || styles.standby;
}
