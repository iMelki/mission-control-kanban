'use client';

import { useSyncExternalStore } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';

interface RuntimeHealthSummary {
  ok: boolean;
  webhook?: { ready?: number; total?: number; missing_secret?: number; configured?: number; needs_config?: number };
  openclaw?: { enabled: number; sessions: number };
  secrets?: { callback_signature_secret?: boolean };
  callback_signature?: { outbound_secret_configured?: boolean; inbound_secret_configured?: boolean };
}

type Listener = () => void;

let snapshot: RuntimeHealthSummary | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let loading = false;
const listeners = new Set<Listener>();

function emit() {
  Array.from(listeners).forEach((listener) => listener());
}

async function refreshRuntimeHealth() {
  if (loading || typeof window === 'undefined') return;
  loading = true;
  try {
    const response = await fetch('/api/runtime/health', { cache: 'no-store' });
    if (response.ok) {
      snapshot = await response.json();
      emit();
    }
  } finally {
    loading = false;
  }
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  void refreshRuntimeHealth();
  if (!intervalId) {
    intervalId = setInterval(() => void refreshRuntimeHealth(), 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return null;
}

export function RuntimeHealthBadges() {
  const health = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!health) {
    return <span className="rounded border border-mc-border px-2 py-1 text-xs text-mc-text-secondary">Runtime health…</span>;
  }

  const webhookTotal = health.webhook?.total ?? ((health.webhook?.configured ?? 0) + (health.webhook?.needs_config ?? 0));
  const webhookReady = health.webhook?.ready ?? health.webhook?.configured ?? 0;
  const webhookMissing = health.webhook?.missing_secret ?? health.webhook?.needs_config ?? 0;
  const webhookOk = webhookTotal === 0 || webhookMissing === 0;
  const callbackOk = Boolean(health.secrets?.callback_signature_secret ?? health.callback_signature?.inbound_secret_configured);

  return (
    <div className="hidden items-center gap-2 text-xs text-mc-text-secondary 2xl:flex" aria-label="Runtime health summary">
      <span className={health.ok ? 'inline-flex items-center gap-1 rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-emerald-200' : 'inline-flex items-center gap-1 rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-amber-200'}>
        {health.ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
        Runtime {health.ok ? 'ok' : 'attention'}
      </span>
      <span className="inline-flex items-center gap-1 rounded border border-mc-border px-2 py-1">
        <Activity className="size-3" /> Webhooks {webhookReady}/{webhookTotal}
      </span>
      <span className="inline-flex items-center gap-1 rounded border border-mc-border px-2 py-1">
        <ShieldCheck className="size-3" /> Callback sig {callbackOk ? 'on' : 'off'}
      </span>
      {!webhookOk && <span className="text-amber-200">missing webhook secrets</span>}
    </div>
  );
}
