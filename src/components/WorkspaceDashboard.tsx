'use client';

import { useState, useEffect } from 'react';
import { Plus, ArrowRight, Folder, Users, CheckSquare, Trash2 } from 'lucide-react';
import { Github } from '@/components/icons/BrandIcons';
import { EntityEmoji } from '@/components/ui/EntityEmoji';
import Link from 'next/link';
import { LocalControlPanel } from '@/components/LocalControlPanel';
import { ActionReviewDialog } from '@/components/ui/action-review-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WorkspaceStats } from '@/lib/types';

const WORKSPACE_ICON_OPTIONS = ['📁', '💼', '🏢', '🚀', '💡', '🎯', '📊', '🔧', '🌟', '🏠'];

export function WorkspaceDashboard() {
  const [workspaces, setWorkspaces] = useState<WorkspaceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const res = await fetch('/api/workspaces?stats=true');
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data);
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-mc-bg">
        <header className="border-b border-mc-border bg-mc-bg-secondary">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="h-7 w-48 rounded bg-mc-bg-tertiary" />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="max-w-7xl mx-auto px-6 py-8 outline-none">
          <div className="mb-8 space-y-2">
            <div className="h-7 w-56 rounded bg-mc-bg-tertiary" />
            <div className="h-4 w-80 max-w-full rounded bg-mc-bg-tertiary" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {['a', 'b', 'c'].map((slot) => (
              <div
                key={slot}
                className="min-h-[200px] rounded-xl border border-mc-border bg-mc-bg-secondary p-6"
              >
                <div className="mb-4 h-6 w-2/3 rounded bg-mc-bg-tertiary" />
                <div className="h-4 w-1/2 rounded bg-mc-bg-tertiary" />
                <div className="mt-6 h-4 w-1/3 rounded bg-mc-bg-tertiary" />
              </div>
            ))}
          </div>
          <p className="sr-only">Loading workspaces</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mc-bg">
      {/* Header */}
      <header className="border-b border-mc-border bg-mc-bg-secondary">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🦞</span>
              <h1 className="text-xl font-bold">Mission Control</h1>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-4 h-4" />
              New Workspace
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="max-w-7xl mx-auto px-6 py-8 outline-none">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">All Workspaces</h2>
          <p className="text-mc-text-secondary">
            Select a cockpit workspace. Project-backed workspaces mirror GitHub Projects into local MCK tasks.
          </p>
        </div>

        <LocalControlPanel />

        {workspaces.length === 0 ? (
          <div className="text-center py-16">
            <Folder className="w-16 h-16 mx-auto text-mc-text-secondary mb-4" />
            <h3 className="text-lg font-medium mb-2">No workspaces yet</h3>
            <p className="text-mc-text-secondary mb-6">
              Create your first workspace to get started
            </p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
            >
              Create Workspace
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                onDelete={(id) => setWorkspaces(workspaces.filter(w => w.id !== id))}
              />
            ))}

            {/* Add workspace card */}
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="border-2 border-dashed border-mc-border rounded-xl p-6 hover:border-mc-accent/50 transition-colors flex flex-col items-center justify-center gap-3 min-h-[200px]"
            >
              <div className="w-12 h-12 rounded-full bg-mc-bg-tertiary flex items-center justify-center">
                <Plus className="w-6 h-6 text-mc-text-secondary" />
              </div>
              <span className="text-mc-text-secondary font-medium">Add Workspace</span>
            </button>
          </div>
        )}
      </main>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadWorkspaces();
          }}
        />
      )}
    </div>
  );
}

function WorkspaceCard({ workspace, onDelete }: { workspace: WorkspaceStats; onDelete: (id: string) => void }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Server-side delete refuses non-empty workspaces; state the reason up front
  // and refuse in place instead of shipping a silently disabled confirm button.
  const deleteBlockers = [
    workspace.taskCounts.total > 0
      ? `This workspace still has ${workspace.taskCounts.total} task(s). Delete or move them first.`
      : null,
    workspace.agentCount > 0
      ? `This workspace still has ${workspace.agentCount} agent(s). Delete or move them first.`
      : null,
  ].filter((blocker): blocker is string => blocker !== null);

  // Runs inside ActionReviewDialog: a thrown error keeps the dialog open with
  // the failure message instead of closing on a delete that never happened.
  const handleDelete = async () => {
    if (deleteBlockers.length > 0) {
      throw new Error(deleteBlockers.join(' '));
    }

    const res = await fetch(`/api/workspaces/${workspace.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete workspace');
    }
    onDelete(workspace.id);
  };

  return (
    <>
    <Link href={`/workspace/${workspace.slug}`}>
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-6 hover:border-mc-accent/50 transition-[border-color,box-shadow] hover:shadow-lg cursor-pointer group relative">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <EntityEmoji emoji={workspace.icon} kind="workspace" hidden className="text-3xl" />
            <div>
              <h3 className="font-semibold text-lg group-hover:text-mc-accent transition-colors">
                {workspace.name}
              </h3>
              <p className="text-sm text-mc-text-secondary">/{workspace.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {workspace.id !== 'default' && !workspace.github_project_number && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="p-1.5 rounded hover:bg-mc-accent-red/20 text-mc-text-secondary hover:text-mc-accent-red transition-colors opacity-0 group-hover:opacity-100"
                aria-label={`Delete ${workspace.name} workspace`}
                title="Delete workspace"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <ArrowRight className="w-5 h-5 text-mc-text-secondary group-hover:text-mc-accent transition-colors" />
          </div>
        </div>

        {/* Simple task/agent counts */}
        <div className="flex items-center gap-4 text-sm text-mc-text-secondary mt-4">
          <div className="flex items-center gap-1">
            <CheckSquare className="w-4 h-4" />
            <span>{workspace.taskCounts.total} tasks</span>
          </div>
          <div className="flex items-center gap-1">
            <Users className="w-4 h-4" />
            <span>{workspace.agentCount} agents</span>
          </div>
        </div>

        {workspace.github_project_owner && workspace.github_project_number && (
          <div className="mt-4 rounded border border-mc-border/70 bg-mc-bg px-3 py-2 text-xs text-mc-text-secondary">
            <div className="flex items-center gap-2">
              <Github className="size-3.5 text-mc-accent-cyan" />
              <span className="font-medium text-mc-text">
                GitHub Project #{workspace.github_project_number}
              </span>
            </div>
            <p className="mt-1">
              {workspace.github_project_auto_refresh ? 'Auto-refreshes' : 'Manual refresh'} from {workspace.github_project_title || workspace.name}; GitHub remains the task source of truth.
            </p>
          </div>
        )}
      </div>
    </Link>

    <ActionReviewDialog
      open={showDeleteConfirm}
      onOpenChange={setShowDeleteConfirm}
      title={`Delete workspace ${workspace.name}?`}
      tone="destructive"
      confirmLabel="Delete workspace"
      pendingLabel="Deleting..."
      description={
        deleteBlockers.length > 0
          ? `Blocked: ${deleteBlockers.join(' ')}`
          : 'This workspace is empty, so deleting it removes only the workspace record itself.'
      }
      consequences={{
        immediateEffect: 'The workspace card disappears from this dashboard.',
        confirmedEffect:
          'MCK deletes the workspace record and its local runtime/sync settings from the local database.',
        resultLocation: `This dashboard; the /workspace/${workspace.slug} route stops resolving.`,
        willNotHappen:
          'No GitHub repository, GitHub Project, or file on disk is touched, and other workspaces are unaffected.',
      }}
      onConfirm={handleDelete}
    />
    </>
  );
}

function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon }),
      });

      if (res.ok) {
        onCreated();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create workspace');
      }
    } catch {
      setError('Failed to create workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="w-[calc(100vw-2rem)] max-w-md gap-0 rounded-xl p-0"
      >
        <DialogHeader className="p-6 border-b border-mc-border">
          <DialogTitle>Create New Workspace</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Icon selector */}
          <fieldset>
            <legend className="block text-sm font-medium mb-2">Icon</legend>
            <div className="flex flex-wrap gap-2">
              {WORKSPACE_ICON_OPTIONS.map((workspaceIcon) => (
                <button
                  key={workspaceIcon}
                  type="button"
                  onClick={() => setIcon(workspaceIcon)}
                  aria-pressed={icon === workspaceIcon}
                  aria-label={`Select ${workspaceIcon} workspace icon`}
                  className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors ${
                    icon === workspaceIcon
                      ? 'bg-mc-accent/20 border-2 border-mc-accent'
                      : 'bg-mc-bg border border-mc-border hover:border-mc-accent/50'
                  }`}
                >
                  {workspaceIcon}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Name input */}
          <div>
            <label htmlFor="workspace-name" className="block text-sm font-medium mb-2">Name</label>
            <input
              id="workspace-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Assistants"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
            />
          </div>

          {error && (
            <div className="text-mc-accent-red text-sm">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="px-6 py-2 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
