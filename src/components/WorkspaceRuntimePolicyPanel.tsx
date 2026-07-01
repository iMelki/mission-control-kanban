'use client';

import { useState } from 'react';
import { RadioTower, Save } from 'lucide-react';
import {
  AGENT_RUNTIME_DESCRIPTIONS,
  AGENT_RUNTIME_LABELS,
  AGENT_RUNTIME_TYPES,
  normalizeAgentRuntimeType,
  normalizeDispatchEnabled,
  parseAgentRuntimeConfig,
  serializeAgentRuntimeConfig,
} from '@/lib/agent-runtimes';
import type { AgentRuntimeType, Workspace } from '@/lib/types';

function formatConfig(value: Workspace['default_runtime_config']) {
  const parsed = parseAgentRuntimeConfig(value);
  return Object.keys(parsed).length ? JSON.stringify(parsed, null, 2) : '';
}

export function WorkspaceRuntimePolicyPanel({
  workspace,
  onWorkspaceUpdated,
}: {
  workspace: Workspace;
  onWorkspaceUpdated: (workspace: Workspace) => void;
}) {
  const [runtimeType, setRuntimeType] = useState<AgentRuntimeType>(() => normalizeAgentRuntimeType(workspace.default_runtime_type));
  const [dispatchEnabled, setDispatchEnabled] = useState(() => normalizeDispatchEnabled(workspace.default_dispatch_enabled));
  const [runtimeConfig, setRuntimeConfig] = useState(() => formatConfig(workspace.default_runtime_config));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const savePolicy = async () => {
    setState('saving');
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_runtime_type: runtimeType,
          default_runtime_config: serializeAgentRuntimeConfig(runtimeConfig),
          default_dispatch_enabled: runtimeType === 'manual' ? false : dispatchEnabled,
        }),
      });
      if (!response.ok) throw new Error(`Policy save failed with HTTP ${response.status}`);
      onWorkspaceUpdated(await response.json());
      setState('saved');
      setTimeout(() => setState('idle'), 2000);
    } catch (error) {
      console.error('Failed to save workspace runtime policy:', error);
      setState('error');
    }
  };

  const effectiveDispatchEnabled = runtimeType !== 'manual' && dispatchEnabled;

  return (
    <section className="border-b border-mc-border bg-mc-bg-secondary/70 px-4 py-2" aria-label="Workspace runtime policy">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <RadioTower className="mt-0.5 size-4 shrink-0 text-mc-accent" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Workspace runtime defaults</h2>
              <span className="rounded border border-mc-border bg-mc-bg px-2 py-0.5 text-[10px] uppercase text-mc-text-secondary">
                New agents inherit this unless overridden
              </span>
            </div>
            <p className="text-xs text-mc-text-secondary">
              {AGENT_RUNTIME_DESCRIPTIONS[runtimeType]} {runtimeType !== 'manual' && !effectiveDispatchEnabled ? 'Default auto-dispatch is off, so new agents fall back to manual handoff until enabled.' : ''}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(160px,220px)_auto_minmax(220px,360px)_auto] md:items-center">
          <label className="sr-only" htmlFor="workspace-default-runtime">Default runtime</label>
          <select
            id="workspace-default-runtime"
            value={runtimeType}
            onChange={(event) => {
              const value = event.target.value as AgentRuntimeType;
              setRuntimeType(value);
              if (value === 'manual') setDispatchEnabled(false);
            }}
            className="rounded border border-mc-border bg-mc-bg px-3 py-2 text-sm focus:border-mc-accent focus:outline-none"
          >
            {AGENT_RUNTIME_TYPES.map((type) => (
              <option key={type} value={type}>{AGENT_RUNTIME_LABELS[type]}</option>
            ))}
          </select>

          <label className="flex items-center gap-2 rounded border border-mc-border bg-mc-bg px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={effectiveDispatchEnabled}
              disabled={runtimeType === 'manual'}
              onChange={(event) => setDispatchEnabled(event.target.checked)}
            />
            Default dispatch enabled
          </label>

          <label className="sr-only" htmlFor="workspace-default-runtime-config">Default runtime config JSON</label>
          <input
            id="workspace-default-runtime-config"
            value={runtimeConfig}
            onChange={(event) => setRuntimeConfig(event.target.value)}
            className="rounded border border-mc-border bg-mc-bg px-3 py-2 font-mono text-xs focus:border-mc-accent focus:outline-none"
            placeholder={runtimeType === 'webhook' ? '{"webhook_url":"https://...","signature_secret_env":"MCK_WEBHOOK_SIGNATURE_SECRET"}' : '{"notes":"optional"}'}
          />

          <button
            type="button"
            onClick={savePolicy}
            disabled={state === 'saving'}
            className="inline-flex items-center justify-center gap-2 rounded border border-mc-border px-3 py-2 text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
          >
            <Save className="size-4" />
            {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save defaults'}
          </button>
        </div>
      </div>
      {state === 'error' && (
        <p className="mt-2 text-xs text-rose-200">Could not save runtime defaults. Check the JSON config and retry.</p>
      )}
    </section>
  );
}
