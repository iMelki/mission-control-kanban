import type { AgentRuntimeConfig } from './types';

export type RuntimeConfigTemplateId =
  | 'hermes'
  | 'codex'
  | 'copilot'
  | 'claude-code'
  | 'n8n'
  | 'generic-webhook';

export interface RuntimeConfigTemplate {
  id: RuntimeConfigTemplateId;
  label: string;
  description: string;
  runtime_type: 'webhook';
  config: AgentRuntimeConfig;
}

export const RUNTIME_CONFIG_TEMPLATES: RuntimeConfigTemplate[] = [
  {
    id: 'hermes',
    label: 'Hermes Agent',
    description: 'Webhook bridge for Hermes-run agents. Keep endpoint and secrets in env vars.',
    runtime_type: 'webhook',
    config: {
      provider: 'hermes',
      webhook_url_env: 'MCK_HERMES_WEBHOOK_URL',
      bearer_token_env: 'MCK_HERMES_WEBHOOK_TOKEN',
      signature_secret_env: 'MCK_WEBHOOK_SIGNATURE_SECRET',
      timeout_ms: 30000,
      headers: { 'X-MCK-Runtime': 'hermes' },
    },
  },
  {
    id: 'codex',
    label: 'Codex CLI bridge',
    description: 'Generic webhook worker that launches local/remote Codex jobs out-of-band.',
    runtime_type: 'webhook',
    config: {
      provider: 'codex',
      webhook_url_env: 'MCK_CODEX_WEBHOOK_URL',
      bearer_token_env: 'MCK_CODEX_WEBHOOK_TOKEN',
      signature_secret_env: 'MCK_WEBHOOK_SIGNATURE_SECRET',
      timeout_ms: 45000,
      headers: { 'X-MCK-Runtime': 'codex' },
    },
  },
  {
    id: 'copilot',
    label: 'Copilot agent worker',
    description: 'Webhook worker for Copilot/ACP handoff jobs.',
    runtime_type: 'webhook',
    config: {
      provider: 'copilot',
      webhook_url_env: 'MCK_COPILOT_WEBHOOK_URL',
      bearer_token_env: 'MCK_COPILOT_WEBHOOK_TOKEN',
      signature_secret_env: 'MCK_WEBHOOK_SIGNATURE_SECRET',
      timeout_ms: 45000,
      headers: { 'X-MCK-Runtime': 'copilot' },
    },
  },
  {
    id: 'claude-code',
    label: 'Claude Code worker',
    description: 'Webhook bridge that queues Claude Code tasks and reports back through callbacks.',
    runtime_type: 'webhook',
    config: {
      provider: 'claude-code',
      webhook_url_env: 'MCK_CLAUDE_CODE_WEBHOOK_URL',
      bearer_token_env: 'MCK_CLAUDE_CODE_WEBHOOK_TOKEN',
      signature_secret_env: 'MCK_WEBHOOK_SIGNATURE_SECRET',
      timeout_ms: 45000,
      headers: { 'X-MCK-Runtime': 'claude-code' },
    },
  },
  {
    id: 'n8n',
    label: 'n8n workflow worker',
    description: 'n8n webhook receiver for queueing tasks into workflow automations.',
    runtime_type: 'webhook',
    config: {
      provider: 'n8n',
      webhook_url_env: 'MCK_N8N_AGENT_WEBHOOK_URL',
      bearer_token_env: 'MCK_N8N_AGENT_WEBHOOK_TOKEN',
      signature_secret_env: 'MCK_WEBHOOK_SIGNATURE_SECRET',
      timeout_ms: 30000,
      headers: { 'X-MCK-Runtime': 'n8n' },
    },
  },
  {
    id: 'generic-webhook',
    label: 'Generic webhook worker',
    description: 'Portable webhook worker template for any runtime that accepts the canonical MCK payload.',
    runtime_type: 'webhook',
    config: {
      provider: 'generic-webhook',
      webhook_url_env: 'MCK_AGENT_WEBHOOK_URL',
      bearer_token_env: 'MCK_AGENT_WEBHOOK_TOKEN',
      signature_secret_env: 'MCK_WEBHOOK_SIGNATURE_SECRET',
      timeout_ms: 30000,
      headers: { 'X-MCK-Runtime': 'generic-webhook' },
    },
  },
];

export function getRuntimeConfigTemplate(id: RuntimeConfigTemplateId) {
  return RUNTIME_CONFIG_TEMPLATES.find((template) => template.id === id);
}

export function formatRuntimeConfigTemplate(template: RuntimeConfigTemplate) {
  return JSON.stringify(template.config, null, 2);
}
