'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import { Header } from '@/components/Header';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { MissionQueue } from '@/components/MissionQueue';
import { LiveFeed } from '@/components/LiveFeed';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { useMissionControl } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import { debug } from '@/lib/debug';
import type { MckN8nSyncStatusResponse, Task, Workspace } from '@/lib/types';

function formatSyncTimestamp(value?: string): string {
  if (!value) {
    return 'never';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'unknown time';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function formatSyncCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSyncCadence(status: MckN8nSyncStatusResponse['latest']): string {
  const cadence = status?.raw_payload?.scheduleCadence;
  if (!cadence || typeof cadence !== 'object' || Array.isArray(cadence)) {
    return 'configured schedule';
  }

  const cadenceRecord = cadence as Record<string, unknown>;
  const schedule = Array.isArray(cadenceRecord.schedule)
    ? cadenceRecord.schedule.map((item) => String(item)).join(', ')
    : '';
  const timezone = typeof cadenceRecord.timezone === 'string' ? cadenceRecord.timezone : '';

  return [schedule, timezone].filter(Boolean).join(' ') || 'configured schedule';
}

export default function WorkspacePage() {
  const params = useParams();
  const slug = params.slug as string;

  const {
    setAgents,
    setTasks,
    setEvents,
    setIsOnline,
    setIsLoading,
    isLoading,
  } = useMissionControl();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [githubSyncState, setGitHubSyncState] = useState<{
    state: 'idle' | 'syncing' | 'success' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const [n8nSyncStatus, setN8nSyncStatus] = useState<MckN8nSyncStatusResponse | null>(null);
  const autoSyncedWorkspaceRef = useRef<string | null>(null);

  const loadWorkspaceTasks = useCallback(async (workspaceIdToLoad: string) => {
    const tasksRes = await fetch(`/api/tasks?workspace_id=${workspaceIdToLoad}`);
    if (tasksRes.ok) {
      const tasksData = await tasksRes.json();
      debug.api('Loaded tasks', { count: tasksData.length });
      setTasks(tasksData);
    }
  }, [setTasks]);

  const runGitHubProjectSync = useCallback(async (
    workspaceToSync: Workspace,
    trigger: 'auto' | 'manual'
  ) => {
    if (!workspaceToSync.github_project_owner || !workspaceToSync.github_project_number) {
      return;
    }

    setGitHubSyncState({
      state: 'syncing',
      message: trigger === 'auto' ? 'Auto-refreshing from GitHub Project...' : 'Refreshing from GitHub Project...',
    });

    try {
      const res = await fetch(`/api/workspaces/${workspaceToSync.id}/github-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'GitHub Project refresh failed');
      }

      await loadWorkspaceTasks(workspaceToSync.id);
      setGitHubSyncState({
        state: 'success',
        message: `GitHub Project refreshed: ${payload.imported} imported, ${payload.updated} updated, ${payload.moved} moved.`,
      });
    } catch (error) {
      setGitHubSyncState({
        state: 'error',
        message: error instanceof Error ? error.message : 'GitHub Project refresh failed',
      });
    }
  }, [loadWorkspaceTasks]);

  const loadN8nSyncStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/n8n/mck-sync-status?limit=5');
      if (!res.ok) {
        return;
      }

      setN8nSyncStatus(await res.json());
    } catch (error) {
      console.error('Failed to load n8n sync status:', error);
    }
  }, []);

  // Connect to SSE for real-time updates
  useSSE();

  // Load workspace data
  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch(`/api/workspaces/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setWorkspace(data);
        } else if (res.status === 404) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }
      } catch (error) {
        console.error('Failed to load workspace:', error);
        setNotFound(true);
        setIsLoading(false);
        return;
      }
    }

    loadWorkspace();
  }, [slug, setIsLoading]);

  // Load workspace-specific data
  useEffect(() => {
    if (!workspace) return;

    const currentWorkspace = workspace;
    const workspaceId = workspace.id;

    async function loadData() {
      try {
        debug.api('Loading workspace data...', { workspaceId });

        // Fetch workspace-scoped data
        const [agentsRes, eventsRes] = await Promise.all([
          fetch(`/api/agents?workspace_id=${workspaceId}`),
          fetch('/api/events'),
        ]);

        if (agentsRes.ok) setAgents(await agentsRes.json());
        await loadWorkspaceTasks(workspaceId);
        if (eventsRes.ok) setEvents(await eventsRes.json());
        if (currentWorkspace.github_project_owner && currentWorkspace.github_project_number) {
          void loadN8nSyncStatus();
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }

      if (
        currentWorkspace.github_project_auto_refresh &&
        currentWorkspace.github_project_owner &&
        currentWorkspace.github_project_number &&
        autoSyncedWorkspaceRef.current !== workspaceId
      ) {
        autoSyncedWorkspaceRef.current = workspaceId;
        void runGitHubProjectSync(currentWorkspace, 'auto');
      }
    }

    // Check OpenClaw connection separately (non-blocking)
    async function checkOpenClaw() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const openclawRes = await fetch('/api/openclaw/status', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (openclawRes.ok) {
          const status = await openclawRes.json();
          setIsOnline(status.connected);
        }
      } catch {
        setIsOnline(false);
      }
    }

    loadData();
    checkOpenClaw();

    // Poll for events every 5 seconds
    const eventPoll = setInterval(async () => {
      try {
        const res = await fetch('/api/events?limit=20');
        if (res.ok) {
          setEvents(await res.json());
        }
      } catch (error) {
        console.error('Failed to poll events:', error);
      }
    }, 5000);

    // Poll tasks as SSE fallback (every 10 seconds)
    const taskPoll = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks?workspace_id=${workspaceId}`);
        if (res.ok) {
          const newTasks: Task[] = await res.json();
          const currentTasks = useMissionControl.getState().tasks;

          const hasChanges = newTasks.length !== currentTasks.length ||
            newTasks.some((t) => {
              const current = currentTasks.find(ct => ct.id === t.id);
              return !current || current.status !== t.status;
            });

          if (hasChanges) {
            debug.api('[FALLBACK] Task changes detected, updating store');
            setTasks(newTasks);
          }
        }
      } catch (error) {
        console.error('Failed to poll tasks:', error);
      }
    }, 10000);

    // Check OpenClaw connection every 30 seconds
    const connectionCheck = setInterval(async () => {
      try {
        const res = await fetch('/api/openclaw/status');
        if (res.ok) {
          const status = await res.json();
          setIsOnline(status.connected);
        }
      } catch {
        setIsOnline(false);
      }
    }, 30000);

    const n8nStatusPoll = currentWorkspace.github_project_owner && currentWorkspace.github_project_number
      ? setInterval(() => {
        void loadN8nSyncStatus();
      }, 60000)
      : null;

    return () => {
      clearInterval(eventPoll);
      clearInterval(connectionCheck);
      clearInterval(taskPoll);
      if (n8nStatusPoll) {
        clearInterval(n8nStatusPoll);
      }
    };
  }, [workspace, setAgents, setTasks, setEvents, setIsOnline, setIsLoading, loadWorkspaceTasks, runGitHubProjectSync, loadN8nSyncStatus]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold mb-2">Workspace Not Found</h1>
          <p className="text-mc-text-secondary mb-6">
            The workspace &ldquo;{slug}&rdquo; doesn&apos;t exist.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !workspace) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading {slug}...</p>
        </div>
      </div>
    );
  }

  const latestN8nSync = n8nSyncStatus?.latest ?? null;
  const n8nSummary = (latestN8nSync?.summary ?? {}) as Record<string, unknown>;
  const n8nSyncHasAlert = Boolean(
    latestN8nSync && (!latestN8nSync.ok || latestN8nSync.alert_level === 'error')
  );
  const n8nSyncCounts = latestN8nSync
    ? `${formatSyncCount(n8nSummary.scanned_items)} scanned, ${formatSyncCount(n8nSummary.updated)} updated, ${formatSyncCount(n8nSummary.errors)} errors`
    : 'no recorded runs yet';

  return (
    <div className="h-screen flex flex-col bg-mc-bg overflow-hidden">
      <Header workspace={workspace} />

      {workspace.github_project_owner && workspace.github_project_number && (
        <div className="border-b border-mc-border bg-mc-bg-secondary px-4 py-2">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-1 text-sm text-mc-text-secondary">
              <div className="flex flex-wrap items-center gap-2">
                {githubSyncState.state === 'syncing' ? (
                  <Loader2 className="size-4 animate-spin text-mc-accent-cyan" />
                ) : githubSyncState.state === 'error' ? (
                  <AlertTriangle className="size-4 text-rose-300" />
                ) : githubSyncState.state === 'success' ? (
                  <CheckCircle2 className="size-4 text-emerald-300" />
                ) : (
                  <RefreshCw className="size-4 text-mc-accent-cyan" />
                )}
                <span>
                  GitHub Project #{workspace.github_project_number}
                  {workspace.github_project_title ? ` (${workspace.github_project_title})` : ''} is the source for this workspace.
                </span>
                {githubSyncState.message && (
                  <span className={githubSyncState.state === 'error' ? 'text-rose-200' : 'text-mc-text-secondary'}>
                    {githubSyncState.message}
                  </span>
                )}
              </div>
              <div className={n8nSyncHasAlert ? 'flex flex-wrap items-center gap-2 text-rose-200' : 'flex flex-wrap items-center gap-2 text-mc-text-secondary/70'}>
                {n8nSyncHasAlert ? (
                  <AlertTriangle className="size-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
                )}
                <span>
                  n8n sync: {latestN8nSync ? (n8nSyncHasAlert ? 'attention needed' : 'ok') : 'waiting for first scheduled run'}
                </span>
                <span>
                  Last run {formatSyncTimestamp(latestN8nSync?.received_at)} - {n8nSyncCounts} - {formatSyncCadence(latestN8nSync)}
                </span>
                <Link href="/n8n-sync-history" className="text-mc-accent-cyan hover:text-mc-accent">
                  View history
                </Link>
                {latestN8nSync?.alert_message && n8nSyncHasAlert && (
                  <span>{latestN8nSync.alert_message}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void runGitHubProjectSync(workspace, 'manual')}
              disabled={githubSyncState.state === 'syncing'}
              className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-1.5 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
            >
              {githubSyncState.state === 'syncing' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh Project
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Agents Sidebar */}
        <AgentsSidebar workspaceId={workspace.id} />

        {/* Main Content Area */}
        <MissionQueue workspaceId={workspace.id} />

        {/* Live Feed */}
        <LiveFeed />
      </div>

      {/* Debug Panel - only shows when debug mode enabled */}
      <SSEDebugPanel />
    </div>
  );
}
