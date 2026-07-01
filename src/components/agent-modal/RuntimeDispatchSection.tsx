'use client';

import { RadioTower } from 'lucide-react';
import {
  AGENT_RUNTIME_DESCRIPTIONS,
  AGENT_RUNTIME_LABELS,
  AGENT_RUNTIME_TYPES,
} from '@/lib/agent-runtimes';
import type { AgentRuntimeType, AgentStatus } from '@/lib/types';

export type AgentFormState = {
  name: string;
  role: string;
  description: string;
  avatar_emoji: string;
  status: AgentStatus;
  is_master: boolean;
  runtime_type: AgentRuntimeType;
  runtime_config: string;
  dispatch_enabled: boolean;
  soul_md: string;
  user_md: string;
  agents_md: string;
};

export function RuntimeDispatchSection({
  form,
  setForm,
}: {
  form: AgentFormState;
  setForm: React.Dispatch<React.SetStateAction<AgentFormState>>;
}) {
  const dispatchDisabledReason = form.runtime_type === 'manual'
    ? 'Manual agents cannot auto-dispatch; they receive copyable handoff prompts.'
    : !form.dispatch_enabled
      ? `${AGENT_RUNTIME_LABELS[form.runtime_type]} is selected but disabled, so task assignment falls back to manual handoff.`
      : `${AGENT_RUNTIME_LABELS[form.runtime_type]} will auto-dispatch when the task contract is complete.`;

  return (
    <section className="rounded-lg border border-mc-border bg-mc-bg/60 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <RadioTower className="w-4 h-4 text-mc-accent mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">Runtime & dispatch</h3>
          <p className="text-xs text-mc-text-secondary">
            Controls whether assignment only tracks ownership or can launch work through a runtime adapter.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label htmlFor="agent-runtime-type" className="block text-sm font-medium mb-1">Runtime type</label>
          <select
            id="agent-runtime-type"
            value={form.runtime_type}
            onChange={(e) => setForm({
              ...form,
              runtime_type: e.target.value as AgentRuntimeType,
              dispatch_enabled: e.target.value === 'manual' ? false : form.dispatch_enabled,
            })}
            className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
          >
            {AGENT_RUNTIME_TYPES.map((runtimeType) => (
              <option key={runtimeType} value={runtimeType}>{AGENT_RUNTIME_LABELS[runtimeType]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-mc-text-secondary">
            {AGENT_RUNTIME_DESCRIPTIONS[form.runtime_type]}
          </p>
        </div>

        <div className="rounded border border-mc-border bg-mc-bg-secondary p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.dispatch_enabled}
              disabled={form.runtime_type === 'manual'}
              onChange={(e) => setForm({ ...form, dispatch_enabled: e.target.checked })}
              className="w-4 h-4 mt-0.5"
            />
            <span>
              <span className="block font-medium">Enable auto-dispatch</span>
              <span className="block text-xs text-mc-text-secondary">
                Manual agents always require handoff. OpenClaw/webhook agents only auto-launch when this is enabled.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
        {dispatchDisabledReason}
      </div>

      <div>
        <label htmlFor="agent-runtime-config" className="block text-sm font-medium mb-1">Runtime config JSON</label>
        <textarea
          id="agent-runtime-config"
          value={form.runtime_config}
          onChange={(e) => setForm({ ...form, runtime_config: e.target.value })}
          rows={4}
          className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-mc-accent resize-y"
          placeholder={form.runtime_type === 'webhook' ? '{\n  "webhook_url": "https://example.test/mck",\n  "bearer_token_env": "MCK_WEBHOOK_TOKEN",\n  "signature_secret_env": "MCK_WEBHOOK_SIGNATURE_SECRET"\n}' : '{\n  "notes": "Optional runtime notes"\n}'}
        />
        <p className="mt-1 text-xs text-mc-text-secondary">
          Store env-var names such as <code>bearer_token_env</code> or <code>signature_secret_env</code>, not raw secrets.
        </p>
      </div>
    </section>
  );
}
