'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, SearchX } from 'lucide-react';
import { CockpitLoadingShell } from '@/components/CockpitLoadingShell';
import { Header } from '@/components/Header';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { MissionQueue } from '@/components/MissionQueue';
import { LiveFeed } from '@/components/LiveFeed';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { WorkspaceRuntimePolicyPanel } from '@/components/WorkspaceRuntimePolicyPanel';
import { DispatchFailureQueue } from '@/components/DispatchFailureQueue';
import { RuntimeAuditPanel } from '@/components/RuntimeAuditPanel';
import { WorkspaceSectionTabs, type WorkspaceSection } from '@/components/workspace/WorkspaceSectionTabs';
import { WorkspaceStatusBar, type GitHubSyncState } from '@/components/workspace/WorkspaceStatusBar';
import { isCockpitSettled } from '@/lib/cockpit-load-state';
import { fetchWithBudget } from '@/lib/fetch-budget';
import { useMissionControl } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import { debug } from '@/lib/debug';
import { extractGitHubSyncNoteGroups, formatSyncCount } from '@/lib/workspace-sync-summary';
import type { MckN8nSyncStatusResponse, Task, Workspace } from '@/lib/types';

type WorkspacePageState = {
  workspace: Workspace | null;
  notFound: boolean;
  githubSyncState: GitHubSyncState;
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
    setBoardLoadStatus,
    setEventsLoadStatus,
    resetCockpitData,
    boardLoadStatus,
    tasks,
  } = useMissionControl();

  const [pageState, setPageState] = useReducer(workspacePageReducer, initialWorkspacePageState);
  const { workspace: loadedWorkspace, notFound, githubSyncState, n8nSyncStatus, section } = pageState;
  const setWorkspace = useCallback((nextWorkspace: Workspace | null) => setPageState({ workspace: nextWorkspace }), []);
  const setNotFound = useCallback((nextNotFound: boolean) => setPageState({ notFound: nextNotFound }), []);
  const setGitHubSyncState = useCallback((nextGitHubSyncState: WorkspacePageState['githubSyncState']) => setPageState({ githubSyncState: nextGitHubSyncState }), []);
  const setN8nSyncStatus = useCallback((nextN8nSyncStatus: MckN8nSyncStatusResponse | null) => setPageState({ n8nSyncStatus: nextN8nSyncStatus }), []);
  const setSection = useCallback((nextSection: WorkspaceSection) => setPageState({ section: nextSection }), []);
  const autoSyncedWorkspaceRef = useRef<string | null>(null);

  const loadWorkspaceTasks = useCallback(async (
    workspaceIdToLoad: string,
    signal?: AbortSignal,
  ) => {
    const tasksRequest = await fetchWithBudget(
      `/api/tasks?workspace_id=${workspaceIdToLoad}`,
      { signal },
    );
    if (!tasksRequest.response.ok) {
      tasksRequest.release();
      throw new Error(`Task load failed (${tasksRequest.response.status})`);
    }
    const tasksData = await tasksRequest.json<Task[]>();
    debug.api('Loaded tasks', { count: tasksData.length });
    setTasks(tasksData);
    setBoardLoadStatus('ready');
  }, [setBoardLoadStatus, setTasks]);

  const retryBoardLoad = useCallback(async (workspaceIdToLoad: string) => {
    setBoardLoadStatus('pending');
    try {
      await loadWorkspaceTasks(workspaceIdToLoad);
    } catch (error) {
      console.error('Failed to retry task load:', error);
      setBoardLoadStatus('error');
    }
  }, [loadWorkspaceTasks, setBoardLoadStatus]);

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
        noteGroups: extractGitHubSyncNoteGroups(syncPayload),
        counts: { imported, updated, moved, statusReconciled, driftWarnings },
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

  // Load workspace metadata only. Board data is a second phase — do not mark
  // the cockpit settled here (2026-08-31 stuck-load class).
  // react-doctor-disable-next-line -- Client-only operator shell keeps live workspace state and local interactions hydrated after the initial route render.
  useEffect(() => {
    const controller = new AbortController();
    resetCockpitData();
    autoSyncedWorkspaceRef.current = null;

    async function loadWorkspace() {
      try {
        const workspaceRequest = await fetchWithBudget(`/api/workspaces/${slug}`, { signal: controller.signal });
        if (workspaceRequest.response.ok) {
          const data = await workspaceRequest.json<Workspace>();
          setWorkspace(data);
          return;
        }
        workspaceRequest.release();
        if (workspaceRequest.response.status === 404) {
          setNotFound(true);
          setBoardLoadStatus('error');
          return;
        }
        setNotFound(true);
        setBoardLoadStatus('error');
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Failed to load workspace:', error);
        setNotFound(true);
        setBoardLoadStatus('error');
      }
    }

    void loadWorkspace();
    return () => controller.abort();
  }, [resetCockpitData, setBoardLoadStatus, setNotFound, setWorkspace, slug]);

  // Load workspace-specific data
  // react-doctor-disable-next-line -- Every polling interval created here is cleared in the returned cleanup; the OpenClaw abort timeout is bounded and cleared inline.
  useEffect(() => {
    if (!loadedWorkspace) return;

    const currentWorkspace = loadedWorkspace;
    const workspaceId = currentWorkspace.id;
    const controller = new AbortController();

    async function loadData() {
      try {
        debug.api('Loading workspace data...', { workspaceId });
        await loadWorkspaceTasks(workspaceId, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Failed to load tasks:', error);
        setBoardLoadStatus('error');
      }

      try {
        const [agentsRequest, eventsRequest] = await Promise.all([
          fetchWithBudget(`/api/agents?workspace_id=${workspaceId}`, { signal: controller.signal }),
          fetchWithBudget('/api/events', { signal: controller.signal }),
        ]);

        if (agentsRequest.response.ok) {
          setAgents(await agentsRequest.json());
        } else {
          agentsRequest.release();
        }
        if (eventsRequest.response.ok) {
          setEvents(await eventsRequest.json());
          setEventsLoadStatus('ready');
        } else {
          eventsRequest.release();
          setEventsLoadStatus('error');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Failed to load agents/events:', error);
          setEventsLoadStatus('error');
        }
      }

      if (currentWorkspace.github_project_owner && currentWorkspace.github_project_number) {
        void loadN8nSyncStatus();
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
          return;
        }
        setIsOnline(false);
      } catch {
        if (!controller.signal.aborted) {
          setIsOnline(false);
        }
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
          setEventsLoadStatus('ready');
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

          if (hasChanges || useMissionControl.getState().boardLoadStatus !== 'ready') {
            debug.api('[FALLBACK] Task changes detected, updating store');
            setTasks(newTasks);
            setBoardLoadStatus('ready');
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
      controller.abort();
      clearInterval(eventPoll);
      clearInterval(connectionCheck);
      clearInterval(taskPoll);
      if (n8nStatusPoll) {
        clearInterval(n8nStatusPoll);
      }
    };
  }, [loadedWorkspace, setAgents, setTasks, setEvents, setIsOnline, setBoardLoadStatus, setEventsLoadStatus, loadWorkspaceTasks, runGitHubProjectSync, loadN8nSyncStatus]);

  if (!loadedWorkspace && !notFound) {
    return <CockpitLoadingShell slug={slug} />;
  }

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

  const workspace = loadedWorkspace;
  if (!workspace) {
    return <CockpitLoadingShell slug={slug} />;
  }

  const gatedInboxCount = tasks.filter((task) => task.status === 'inbox' && (task.dispatch_blockers?.length ?? 0) > 0).length;

  return (
    <div
      className="min-h-[100dvh] max-h-[100dvh] flex flex-col bg-mc-bg overflow-hidden"
      data-workspace-ready={isCockpitSettled({ workspaceReady: true, boardPhase: boardLoadStatus }) ? 'true' : 'false'}
      data-cockpit-load={boardLoadStatus}
    >
      <Header workspace={workspace} />
      <WorkspaceSectionTabs section={section} onSectionChange={setSection} />
      {boardLoadStatus === 'error' && (
        <div
          role="alert"
          className="border-b border-mc-danger/40 bg-mc-danger/10 px-4 py-2 text-sm text-mc-text flex flex-wrap items-center gap-3"
        >
          <span>Board data failed to load. The empty columns are not a settled count.</span>
          <button
            type="button"
            onClick={() => void retryBoardLoad(workspace.id)}
            className="rounded border border-mc-border px-2 py-1 text-xs hover:bg-mc-bg-tertiary"
          >
            Retry board load
          </button>
        </div>
      )}
      {section === 'settings' && <WorkspaceRuntimePolicyPanel workspace={workspace} onWorkspaceUpdated={setWorkspace} />}

      <WorkspaceStatusBar
        workspace={workspace}
        githubSync={githubSyncState}
        n8nSync={n8nSyncStatus}
        gatedInboxCount={gatedInboxCount}
        onSyncNow={() => void runGitHubProjectSync(workspace, 'manual')}
      />

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
