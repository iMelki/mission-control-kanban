'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import type { Task, TaskDependencySummary } from '@/lib/types';
import { DependencyBadges } from './DependencyBadges';

interface CandidateTask {
  id: string;
  title: string;
  status: string;
}

function statusTone(status?: string) {
  if (status === 'done') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (status === 'review' || status === 'testing') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-mc-border bg-mc-bg-tertiary text-mc-text-secondary';
}

function NodeCard({ title, status, note, active }: { title?: string; status?: string; note?: string | null; active?: boolean }) {
  return (
    <div className={`rounded border p-2 text-sm ${active ? 'border-mc-accent/50 bg-mc-accent/10' : 'border-mc-border bg-mc-bg'}`}>
      <div className="line-clamp-2 font-medium text-mc-text">{title || 'Untitled task'}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-mc-text-secondary">
        {status && <span className={`rounded border px-1.5 py-0.5 ${statusTone(status)}`}>{status.replace('_', ' ')}</span>}
        {note && <span className="line-clamp-1">{note}</span>}
      </div>
    </div>
  );
}

function DependencyGraph({ task, blockedBy, blocking }: { task: Pick<Task, 'id' | 'title' | 'status'>; blockedBy: TaskDependencySummary[]; blocking: TaskDependencySummary[] }) {
  return (
    <div className="rounded border border-mc-border bg-mc-bg-secondary/60 p-3" data-testid="dependency-graph">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-mc-text-secondary">Dependency graph</div>
        <DependencyBadges blockedBy={blockedBy} blocking={blocking} compact />
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase text-mc-text-secondary">Blockers</div>
          {blockedBy.length > 0 ? blockedBy.map((row) => (
            <NodeCard key={row.id} title={row.blocked_by_title} status={row.blocked_by_status} note={row.note} />
          )) : <div className="rounded border border-dashed border-mc-border p-2 text-xs text-mc-text-secondary">No local blockers</div>}
        </div>
        <div className="hidden text-mc-text-secondary md:block">→</div>
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase text-mc-text-secondary">Current task</div>
          <NodeCard title={task.title} status={task.status} active />
          {blocking.length > 0 && <div className="text-center text-mc-text-secondary">↓</div>}
          {blocking.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase text-mc-text-secondary">This task blocks</div>
              {blocking.map((row) => <NodeCard key={row.id} title={row.blocking_title} status={row.blocking_status} note={row.note} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TaskDependenciesPanel({ task }: { task: Pick<Task, 'id' | 'title' | 'status'> }) {
  const taskId = task.id;
  const [blockedBy, setBlockedBy] = useState<TaskDependencySummary[]>([]);
  const [blocking, setBlocking] = useState<TaskDependencySummary[]>([]);
  const [candidates, setCandidates] = useState<CandidateTask[]>([]);
  const [selectedTask, setSelectedTask] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/tasks/${taskId}/dependencies`, { cache: 'no-store' });
    const payload = await response.json();
    setBlockedBy(payload.blocked_by || []);
    setBlocking(payload.blocking || []);
    setCandidates(payload.candidates || []);
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const addDependency = async () => {
    if (!selectedTask) return;
    setError(null);
    const response = await fetch(`/api/tasks/${taskId}/dependencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocked_by_task_id: selectedTask, note }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || 'Could not add dependency');
      return;
    }
    setSelectedTask('');
    setNote('');
    await load();
  };

  const removeDependency = async (dependencyId: string) => {
    await fetch(`/api/tasks/${taskId}/dependencies?dependency_id=${encodeURIComponent(dependencyId)}`, { method: 'DELETE' });
    await load();
  };

  return (
    <section className="rounded border border-mc-border bg-mc-bg-secondary p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Link2 className="mt-0.5 size-4 text-mc-accent" />
          <div>
            <h3 className="text-sm font-semibold">Task dependencies / blocked-by</h3>
            <p className="text-xs text-mc-text-secondary">Track local dependency edges before multi-agent work starts. The compact graph keeps DAG navigation visible without adding a heavy graph dependency.</p>
          </div>
        </div>
        <DependencyBadges blockedBy={blockedBy} blocking={blocking} compact />
      </div>
      {error && <div className="rounded border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</div>}
      <DependencyGraph task={task} blockedBy={blockedBy} blocking={blocking} />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <select value={selectedTask} onChange={(event) => setSelectedTask(event.target.value)} className="w-full rounded border border-mc-border bg-mc-bg px-3 py-2 text-sm">
          <option value="">Select a task that blocks this one…</option>
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title} · {candidate.status}</option>)}
        </select>
        <button type="button" onClick={() => void addDependency()} disabled={!selectedTask} className="rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50">Add blocker</button>
      </div>
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional dependency note" className="w-full rounded border border-mc-border bg-mc-bg px-3 py-2 text-sm" />

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-mc-text-secondary">Blocked by ({blockedBy.length})</div>
          <div className="space-y-2">
            {blockedBy.map((row) => (
              <div key={row.id} className="rounded border border-mc-border bg-mc-bg p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div><div>{row.blocked_by_title}</div><div className="text-xs text-mc-text-secondary">{row.blocked_by_status}{row.note ? ` · ${row.note}` : ''}</div></div>
                  <button type="button" onClick={() => void removeDependency(row.id)} aria-label="Remove blocker" className="rounded p-1 hover:bg-mc-bg-tertiary"><Trash2 className="size-3" /></button>
                </div>
              </div>
            ))}
            {blockedBy.length === 0 && <div className="text-xs text-mc-text-secondary">No blockers recorded.</div>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-mc-text-secondary">Blocking ({blocking.length})</div>
          <div className="space-y-2">
            {blocking.map((row) => (
              <div key={row.id} className="rounded border border-mc-border bg-mc-bg p-2 text-sm">
                <div>{row.blocking_title}</div>
                <div className="text-xs text-mc-text-secondary">{row.blocking_status}{row.note ? ` · ${row.note}` : ''}</div>
              </div>
            ))}
            {blocking.length === 0 && <div className="text-xs text-mc-text-secondary">This task is not blocking other local tasks.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
