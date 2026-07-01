'use client';

import { useState } from 'react';
import { CheckCircle2, PlayCircle, RadioTower, ShieldAlert } from 'lucide-react';
import {
  AGENT_RUNTIME_DESCRIPTIONS,
  AGENT_RUNTIME_LABELS,
  AGENT_RUNTIME_TYPES,
} from '@/lib/agent-runtimes';
import { RuntimeConfigTemplateGallery } from '@/components/runtime/RuntimeConfigTemplateGallery';
import type { RuntimeConfigTemplateId } from '@/lib/runtime-config-templates';
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
  agentId,
}: {
  form: AgentFormState;
  setForm: React.Dispatch<React.SetStateAction<AgentFormState>>;
  agentId?: string;
}) {
  const [validation, setValidation] = useState<Record<string, unknown> | null>(null);
  const [validationKey, setValidationKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const currentValidationKey = `${form.runtime_type}:${form.runtime_config}`;
  const webhookValidationOk = form.runtime_type !== 'webhook' || (validationKey === currentValidationKey && validation?.ok === true);

  const dispatchDisabledReason = form.runtime_type === 'manual'
    ? 'Manual agents cannot auto-dispatch; they receive copyable handoff prompts.'
    : form.runtime_type === 'webhook' && form.dispatch_enabled && !webhookValidationOk
      ? 'Webhook dispatch is selected, but this config must pass the validation wizard before auto-dispatch can be enabled.'
      : !form.dispatch_enabled
        ? `${AGENT_RUNTIME_LABELS[form.runtime_type]} is selected but disabled, so task assignment falls back to manual handoff.`
        : `${AGENT_RUNTIME_LABELS[form.runtime_type]} will auto-dispatch when the task contract is complete.`;

  const resetValidation = () => {
    setValidation(null);
    setValidationKey('');
  };

  const updateRuntimeConfig = (runtime_config: string) => {
    resetValidation();
    setForm((prev) => ({ ...prev, runtime_config, dispatch_enabled: prev.runtime_type === 'webhook' ? false : prev.dispatch_enabled }));
  };

  const applyTemplate = (configJson: string, _templateId: RuntimeConfigTemplateId) => {
    resetValidation();
    setForm((prev) => ({ ...prev, runtime_type: 'webhook', runtime_config: configJson, dispatch_enabled: false }));
  };

  const copyTemplate = async (configJson: string) => {
    try {
      await navigator.clipboard.writeText(configJson);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
    }
  };

  const runWebhookValidation = async () => {
    setIsValidating(true);
    try {
      const response = await fetch('/api/runtime/webhook-health-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          runtime_type: form.runtime_type,
          runtime_config: form.runtime_config,
        }),
      });
      const payload = await response.json();
      setValidation(payload);
      setValidationKey(currentValidationKey);
      if (payload.ok) {
        setForm((prev) => ({ ...prev, dispatch_enabled: true }));
      }
    } finally {
      setIsValidating(false);
    }
  };

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
              onChange={(e) => {
                const nextRuntime = e.target.value as AgentRuntimeType;
                resetValidation();
                setForm((prev) => ({
                  ...prev,
                  runtime_type: nextRuntime,
                  dispatch_enabled: nextRuntime === 'manual' || nextRuntime === 'webhook' ? false : prev.dispatch_enabled,
                }));
              }}
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
              disabled={form.runtime_type === 'manual' || (form.runtime_type === 'webhook' && !webhookValidationOk)}
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

      <RuntimeConfigTemplateGallery
        compact
        onApply={applyTemplate}
        onCopy={(configJson) => copyTemplate(configJson)}
      />
      {copyState !== 'idle' && (
        <div className={`rounded border px-3 py-2 text-xs ${copyState === 'copied' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-rose-400/30 bg-rose-500/10 text-rose-100'}`}>
          {copyState === 'copied' ? 'Template copied to clipboard.' : 'Could not copy template.'}
        </div>
      )}

      <div className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
        {dispatchDisabledReason}
      </div>

      {form.runtime_type === 'webhook' && (
        <div className="rounded border border-mc-border bg-mc-bg-secondary p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="font-medium text-mc-text">Webhook validation wizard</div>
              <div className="text-mc-text-secondary">Validate endpoint/env/secret settings with a signed non-task ping before enabling dispatch.</div>
            </div>
            <button
              type="button"
              onClick={() => void runWebhookValidation()}
              disabled={isValidating}
              className="inline-flex items-center gap-1 rounded border border-mc-border px-2 py-1 text-xs hover:bg-mc-bg-tertiary disabled:opacity-50"
            >
              <PlayCircle className="size-3" /> {isValidating ? 'Validating…' : 'Validate endpoint'}
            </button>
          </div>
          {validation && (
            <div className={`rounded border px-3 py-2 ${validation.ok ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-rose-400/30 bg-rose-500/10 text-rose-100'}`}>
              {validation.ok ? <CheckCircle2 className="mr-1 inline size-3" /> : <ShieldAlert className="mr-1 inline size-3" />}
              {String(validation.message || validation.reason || (validation.ok ? 'Validation passed.' : 'Validation failed.'))}
            </div>
          )}
        </div>
      )}

      <div>
        <label htmlFor="agent-runtime-config" className="block text-sm font-medium mb-1">Runtime config JSON</label>
        <textarea
          id="agent-runtime-config"
          value={form.runtime_config}
          onChange={(e) => updateRuntimeConfig(e.target.value)}
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
