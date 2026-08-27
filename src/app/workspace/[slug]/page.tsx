'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronLeft, Loader2, RefreshCw, SearchX } from 'lucide-react';
import { Header } from '@/components/Header';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { MissionQueue } from '@/components/MissionQueue';
import { LiveFeed } from '@/components/LiveFeed';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { WorkspaceRuntimePolicyPanel } from '@/components/WorkspaceRuntimePolicyPanel';
import { DispatchFailureQueue } from '@/components/DispatchFailureQueue';
import { RuntimeAuditPanel } from '@/components/RuntimeAuditPanel';
import { WorkspaceSectionTabs, type WorkspaceSection } from '@/components/workspace/WorkspaceSectionTabs';
import { useMissionControl } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import { debug } from '@/lib/debug';
import { presentMckN8nSyncRun } from '@/lib/n8n-sync-presentation';
import type { MckN8nSyncStatusResponse, Task, Workspace } from '@/lib/types';

const SYNC_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatSyncTimestamp(value?: string): string {
  if (!value) {
    return 'never';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'unknown time';
  }

  // react-doctor-disable-next-line -- Client-only operator page; sync timestamps render in the operator's locale on purpose.
  return SYNC_TIMESTAMP_FORMATTER.format(parsed);
}

function formatSyncCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatReconciliationSuffix(summary: Record<string, unknown>): string {
  const statusReconciled = formatSyncCount(summary.status_reconciled);
  const driftWarnings = formatSyncCount(summary.upstream_drift_warnings);
  if (statusReconciled === 0 && driftWarnings === 0) {
    return '';
  }

  return `, ${statusReconciled} status reconciled, ${driftWarnings} upstream drift warning${driftWarnings === 1 ? '' : 's'}`;
}

function extractGitHubSyncStatusNotes(payload: Record<string, unknown>): string[] {
  const details = Array.isArray(payload.details) ? payload.details : [];
  const notes: string[] = [];

  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const detailRecord = detail as Record<string, unknown>;
    if (detailRecord.action !== 'status_reconcile' && detailRecord.action !== 'drift') continue;

    const issue = typeof detailRecord.issue === 'string' ? `${detailRecord.issue}: ` : '';
    const reason = typeof detailRecord.reason === 'string'
      ? detailRecord.reason
      : String(detailRecord.action);
    notes.push(`${issue}${reason}`);

    if (notes.length === 3) break;
  }

  return notes;
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


type WorkspacePageState = {
  workspace: Workspace | null;
  notFound: boolean;
  githubSyncState: {
    state: 'idle' | 'syncing' | 'success' | 'error';
    message?: string;
    statusNotes?: string[];
  };
  n8nSyncStatus: MckN8nSyncStatusResponse | null;
  section: WorkspaceSection;
};

const initialWorkspacePageState: WorkspacePageState = {
  workspace: null,
  notFound: false,
  githubSyncState: { state: 'idle' },
  n8nSyncStatus: null,
  section: 'board',
};

function workspacePageReducer(state: WorkspacePageState, patch: Partial<WorkspacePageState>): WorkspacePageState {
  return { ...state, ...patch };
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

  const [pageState, setPageState] = useReducer(workspacePageReducer, initialWorkspacePageState);
  const { workspace: loadedWorkspace, notFound, githubSyncState, n8nSyncStatus, section } = pageState;
  const setWorkspace = useCallback((nextWorkspace: Workspace | null) => setPageState({ workspace: nextWorkspace }), []);
  const setNotFound = useCallback((nextNotFound: boolean) => setPageState({ notFound: nextNotFound }), []);
  const setGitHubSyncState = useCallback((nextGitHubSyncState: WorkspacePageState['githubSyncState']) => setPageState({ githubSyncState: nextGitHubSyncState }), []);
  const setN8nSyncStatus = useCallback((nextN8nSyncStatus: MckN8nSyncStatusResponse | null) => setPageState({ n8nSyncStatus: nextN8nSyncStatus }), []);
  const setSection = useCallback((nextSection: WorkspaceSection) => setPageState({ section: nextSection }), []);
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
      message: trigger === 'auto' ? 'Auto-syncing workspace from GitHub Project...' : 'Syncing workspace now...',
    });

    try {
      const res = await fetch(`/api/workspaces/${workspaceToSync.id}/github-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        throw new Error(errorPayload?.error || 'GitHub Project refresh failed');
      }

      const syncPayload = await res.json() as Record<string, unknown>;
      const imported = formatSyncCount(syncPayload.imported);
      const updated = formatSyncCount(syncPayload.updated);
      const moved = formatSyncCount(syncPayload.moved);
      const statusReconciled = formatSyncCount(syncPayload.status_reconciled);
      const driftWarnings = formatSyncCount(syncPayload.upstream_drift_warnings);
      const statusSuffix = statusReconciled > 0 || driftWarnings > 0
        ? ` ${statusReconciled} status reconciled, ${driftWarnings} upstream drift warning${driftWarnings === 1 ? '' : 's'}.`
        : '';

      await loadWorkspaceTasks(workspaceToSync.id);
      setGitHubSyncState({
        state: 'success',
        message: `Workspace sync complete: ${imported} imported, ${updated} updated, ${moved} moved.${statusSuffix}`,
        statusNotes: extractGitHubSyncStatusNotes(syncPayload),
      });
    } catch (error) {
      setGitHubSyncState({
        state: 'error',
        message: error instanceof Error ? error.message : 'GitHub Project refresh failed',
      });
    }
  }, [loadWorkspaceTasks, setGitHubSyncState]);

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
  }, [setN8nSyncStatus]);

  // Connect to SSE for real-time updates
  useSSE();

  // Load workspace data
  // react-doctor-disable-next-line -- Client-only operator shell keeps live workspace state and local interactions hydrated after the initial route render.
  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch(`/api/workspaces/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setWorkspace(data);
          setIsLoading(false);
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
  }, [slug, setIsLoading, setNotFound, setWorkspace]);

  // Load workspace-specific data
  // react-doctor-disable-next-line -- Every polling interval created here is cleared in the returned cleanup; the OpenClaw abort timeout is bounded and cleared inline.
  useEffect(() => {
    if (!loadedWorkspace) return;

    const currentWorkspace = loadedWorkspace;
    const workspaceId = currentWorkspace.id;

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
  }, [loadedWorkspace, setAgents, setTasks, setEvents, setIsOnline, setIsLoading, loadWorkspaceTasks, runGitHubProjectSync, loadN8nSyncStatus]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <main id="main-content" tabIndex={-1} className="text-center outline-none">
          <SearchX aria-hidden="true" className="w-14 h-14 mx-auto mb-4 text-mc-text-secondary" />
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
        </main>
      </div>
    );
  }

  const workspace = loadedWorkspace ?? {
    id: slug,
    name: `${slug} Workspace`,
    slug,
    description: 'Loading workspace metadata…',
    icon: '🦞',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    github_project_owner: null,
    github_project_number: null,
    github_project_title: null,
    github_project_url: null,
    github_project_auto_refresh: 0,
    default_runtime_type: 'manual',
    default_runtime_config: null,
    default_dispatch_enabled: 0,
  } satisfies Workspace;

  const latestN8nSync = n8nSyncStatus?.latest ?? null;
  const n8nSummary = (latestN8nSync?.summary ?? {}) as Record<string, unknown>;
  const n8nSyncPresentation = latestN8nSync ? presentMckN8nSyncRun(latestN8nSync) : null;
  const n8nSyncCounts = latestN8nSync
    ? `${formatSyncCount(n8nSummary.scanned_items)} scanned, ${formatSyncCount(n8nSummary.updated)} updated, ${formatSyncCount(n8nSummary.errors)} errors${formatReconciliationSuffix(n8nSummary)}`
    : 'no recorded runs yet';

  return (
    <div
      className="min-h-[100dvh] max-h-[100dvh] flex flex-col bg-mc-bg overflow-hidden"
      data-workspace-ready={loadedWorkspace ? 'true' : 'false'}
    >
      <Header workspace={workspace} />
      <WorkspaceSectionTabs section={section} onSectionChange={setSection} />
      {section === 'settings' && <WorkspaceRuntimePolicyPanel workspace={workspace} onWorkspaceUpdated={setWorkspace} />}

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
              {githubSyncState.statusNotes && githubSyncState.statusNotes.length > 0 && (
                <div className="flex items-start gap-2 text-amber-200">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    <span className="block">GitHub/MCK status reconciliation is visible for this sync.</span>
                    {githubSyncState.statusNotes.map((note: string) => (
                      <span key={note} className="block text-xs text-amber-100/90">{note}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className={n8nSyncPresentation?.state === 'error'
                ? 'flex flex-wrap items-center gap-2 text-rose-200'
                : n8nSyncPresentation?.state === 'warning'
                  ? 'flex flex-wrap items-center gap-2 text-amber-200'
                  : 'flex flex-wrap items-center gap-2 text-mc-text-secondary/70'}>
                {n8nSyncPresentation?.state === 'error' ? (
                  <AlertTriangle className="size-4 shrink-0" />
                ) : n8nSyncPresentation?.state === 'warning' ? (
                  <AlertTriangle className="size-4 shrink-0 text-amber-300" />
                ) : n8nSyncPresentation ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
                ) : (
                  <RefreshCw className="size-4 shrink-0" />
                )}
                <span>
                  n8n sync: {n8nSyncPresentation?.label ?? 'waiting for first scheduled run'}
                </span>
                <span>
                  Last run {formatSyncTimestamp(latestN8nSync?.received_at)} - {n8nSyncCounts} - {formatSyncCadence(latestN8nSync)}
                </span>
                <Link href="/n8n-sync-history" className="text-mc-accent-cyan hover:text-mc-accent">
                  View history
                </Link>
                {latestN8nSync?.alert_message && n8nSyncPresentation?.showMessage && (
                  <span>{latestN8nSync.alert_message}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void runGitHubProjectSync(workspace, 'manual')}
              disabled={githubSyncState.state === 'syncing'}
              aria-label="Sync workspace now from GitHub Project"
              title="Sync workspace now from GitHub Project"
              className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-1.5 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
            >
              {githubSyncState.state === 'syncing' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Sync now
            </button>
          </div>
        </div>
      )}

      <main id="main-content" tabIndex={-1} className="flex flex-1 min-h-0 flex-col overflow-hidden outline-none">
        {section === 'board' && (
          // Below lg the two fixed-width rails (w-64 + w-80 = 576px) exceed a 390px
          // viewport and squeeze MissionQueue to a 0px content box, so the cockpit
          // stacks into a single scrolling column instead (#142, WCAG 1.4.10).
          <div className="flex flex-col lg:flex-row flex-1 min-w-0 min-h-0 overflow-y-auto lg:overflow-hidden">
            <AgentsSidebar workspaceId={workspace.id} />
            <MissionQueue workspaceId={workspace.id} />
            <LiveFeed />
          </div>
        )}
        {section === 'agents' && (
          <div className="flex flex-col lg:flex-row h-full min-w-0 overflow-y-auto lg:overflow-hidden">
            <AgentsSidebar workspaceId={workspace.id} />
            <div className="flex-1 min-w-0 overflow-auto p-4">
              <RuntimeAuditPanel />
            </div>
          </div>
        )}
        {section === 'dispatch' && <DispatchFailureQueue workspaceId={workspace.id} />}
        {section === 'settings' && (
          <div className="h-full overflow-auto p-4">
            <RuntimeAuditPanel />
          </div>
        )}
        {section === 'activity' && (
          <div className="flex flex-col lg:flex-row h-full min-w-0 overflow-y-auto lg:overflow-hidden">
            <div className="flex-1 min-w-0 overflow-auto p-4">
              <DispatchFailureQueue workspaceId={workspace.id} />
            </div>
            <LiveFeed />
          </div>
        )}
      </main>

      {/* Debug Panel - only shows when debug mode enabled */}
      <SSEDebugPanel />
    </div>
  );
}
