'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, PlayCircle, ShieldAlert, Wrench } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';

interface AuditAgent {
  id: string;
  name: string;
  role: string;
  workspace_id: string;
  runtime_type: string;
  dispatch_enabled: boolean;
  needs_config: boolean;
  dispatch_blocked: boolean;
  reason: string;
  recommended_action: string;
}

interface AuditPayload {
  summary: Record<string, number>;
  agents: AuditAgent[];
}

const columns: DataTableColumn<AuditAgent>[] = [
  { key: 'agent', header: 'Agent', render: (row) => <div><div className="font-medium">{row.name}</div><div className="text-xs text-mc-text-secondary">{row.workspace_id} · {row.role}</div></div> },
  { key: 'runtime', header: 'Runtime', render: (row) => <span className="rounded border border-mc-border px-2 py-1 text-xs">{row.runtime_type}</span> },
  { key: 'dispatch', header: 'Dispatch', render: (row) => row.dispatch_enabled ? <span className="text-emerald-300">enabled</span> : <span className="text-mc-text-secondary">manual/off</span> },
  { key: 'reason', header: 'Why', render: (row) => <span className={row.dispatch_blocked ? 'text-amber-100' : 'text-mc-text-secondary'}>{row.reason}</span> },
  { key: 'action', header: 'Recommended action', render: (row) => <span className="text-xs text-mc-text-secondary">{row.recommended_action}</span> },
];

export function RuntimeAuditPanel() {
  const [payload, setPayload] = useState<AuditPayload | null>(null);
  const [migration, setMigration] = useState<Record<string, unknown> | null>(null);
  const [healthTest, setHealthTest] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const response = await fetch('/api/agents/runtime-audit');
    setPayload(await response.json());
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const previewMigration = async (apply: boolean, agentIds?: string[]) => {
    const response = await fetch('/api/agents/runtime-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: !apply, agent_ids: agentIds }),
    });
    setMigration(await response.json());
    await load();
  };

  const testFirstWebhook = async () => {
    const agent = payload?.agents.find((item) => item.runtime_type === 'webhook');
    if (!agent) {
      setHealthTest({ ok: false, reason: 'No webhook agents to test.' });
      return;
    }
    const response = await fetch('/api/runtime/webhook-health-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agent.id }),
    });
    setHealthTest(await response.json());
  };

  const summary = payload?.summary || {};

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Wrench className="size-5 text-mc-accent" />Runtime audit & migration</h2>
          <p className="text-sm text-mc-text-secondary">Preview existing agents, normalize unsafe runtime states, and test webhook signature config without sending a real task payload.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void previewMigration(false)} className="rounded border border-mc-border px-3 py-1.5 text-sm hover:bg-mc-bg-tertiary">Preview migration</button>
          <button type="button" onClick={() => void previewMigration(true)} className="rounded border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-500/20">Apply safe normalize</button>
          <button type="button" onClick={() => void testFirstWebhook()} className="inline-flex items-center gap-2 rounded border border-mc-border px-3 py-1.5 text-sm hover:bg-mc-bg-tertiary"><PlayCircle className="size-4" /> Test first webhook</button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {['total', 'manual', 'openclaw', 'webhook'].map((key) => (
          <div key={key} className="rounded border border-mc-border bg-mc-bg-secondary p-3">
            <div className="text-xs uppercase text-mc-text-secondary">{key}</div>
            <div className="text-2xl font-semibold">{summary[key] || 0}</div>
          </div>
        ))}
      </div>
      {migration && <div className="rounded border border-mc-border bg-mc-bg-secondary p-3 text-sm"><ShieldAlert className="mr-2 inline size-4 text-amber-300" />Migration result: {JSON.stringify(migration)}</div>}
      {healthTest && <div className="rounded border border-mc-border bg-mc-bg-secondary p-3 text-sm"><CheckCircle2 className="mr-2 inline size-4 text-mc-accent" />Webhook test: {JSON.stringify(healthTest)}</div>}
      {loading ? <div className="text-sm text-mc-text-secondary">Loading runtime audit…</div> : (
        <DataTable
          columns={columns}
          rows={payload?.agents || []}
          empty="No agents found."
          enableRowSelection={(row) => row.dispatch_blocked || row.needs_config}
          bulkActions={[
            { label: 'Preview selected migration', onClick: (rows) => previewMigration(false, rows.map((row) => row.id)) },
            { label: 'Apply selected migration', variant: 'danger', onClick: (rows) => previewMigration(true, rows.map((row) => row.id)) },
          ]}
          selectedRowsLabel={(selected, total) => `${selected}/${total} agents selected for migration diff`}
        />
      )}
    </section>
  );
}
