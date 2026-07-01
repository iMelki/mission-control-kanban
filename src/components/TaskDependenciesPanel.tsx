'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';

interface DependencyRow {
  id: string;
  blocked_by_task_id: string;
  blocked_by_title?: string;
  blocked_by_status?: string;
  blocking_title?: string;
  blocking_status?: string;
  note?: string | null;
}

interface CandidateTask {
  id: string;
  title: string;
  status: string;
}

export function TaskDependenciesPanel({ taskId }: { taskId: string }) {
  const [blockedBy, setBlockedBy] = useState<DependencyRow[]>([]);
  const [blocking, setBlocking] = useState<DependencyRow[]>([]);
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
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 size-4 text-mc-accent" />
        <div>
          <h3 className="text-sm font-semibold">Task dependencies / blocked-by</h3>
          <p className="text-xs text-mc-text-secondary">Track dependency edges before multi-agent work starts. This list-based view is the first step before graph rendering.</p>
        </div>
      </div>
      {error && <div className="rounded border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</div>}
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
