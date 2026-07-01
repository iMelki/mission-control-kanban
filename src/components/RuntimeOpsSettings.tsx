'use client';

import { useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';

export function RuntimeOpsSettings() {
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const runRetention = async (dryRun: boolean) => {
    setLoading(true);
    try {
      const response = await fetch('/api/dispatch-attempts/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      setResult(await response.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mb-8 rounded-lg border border-mc-border bg-mc-bg-secondary p-6">
      <div className="mb-4 flex items-center gap-2">
        <Clock className="h-5 w-5 text-mc-accent" />
        <h2 className="text-xl font-semibold text-mc-text">Runtime retention policy</h2>
      </div>
      <p className="mb-4 text-sm text-mc-text-secondary">
        Dispatch attempts use server-side env defaults: success/manual 30 days, failed/timeout 90 days, batch size 500 unless overridden. Secrets are never shown here.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={loading} onClick={() => void runRetention(true)} className="rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50">Dry-run cleanup</button>
        <button type="button" disabled={loading} onClick={() => void runRetention(false)} className="inline-flex items-center gap-2 rounded border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 hover:bg-rose-500/20 disabled:opacity-50"><Trash2 className="size-4" /> Apply cleanup</button>
      </div>
      {result && <pre className="mt-4 overflow-auto rounded border border-mc-border bg-mc-bg p-3 text-xs text-mc-text-secondary">{JSON.stringify(result, null, 2)}</pre>}
    </section>
  );
}
