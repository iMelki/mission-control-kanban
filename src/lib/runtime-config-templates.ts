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

export interface RuntimeConfigTemplateDiagnostic {
  template_id: RuntimeConfigTemplateId;
  template_label: string;
  env_name: string;
  kind: 'webhook_url' | 'bearer_token' | 'signature_secret';
  configured: boolean;
  valid?: boolean;
  severity: 'ok' | 'warning' | 'blocked';
  message: string;
}

function envDiagnostic({
  template,
  envName,
  kind,
  value,
}: {
  template: RuntimeConfigTemplate;
  envName?: unknown;
  kind: RuntimeConfigTemplateDiagnostic['kind'];
  value?: string;
}): RuntimeConfigTemplateDiagnostic[] {
  if (typeof envName !== 'string' || !envName.trim()) return [];
  const name = envName.trim();
  const configured = Boolean(value && value.trim());
  const isUrl = kind === 'webhook_url';
  const valid = isUrl && configured ? /^https?:\/\//.test(value || '') : configured;
  const severity = !configured
    ? (kind === 'webhook_url' ? 'blocked' : 'warning')
    : valid ? 'ok' : 'blocked';
  const label = kind === 'webhook_url' ? 'Webhook URL' : kind === 'bearer_token' ? 'Bearer token' : 'Signature secret';
  return [{
    template_id: template.id,
    template_label: template.label,
    env_name: name,
    kind,
    configured,
    valid,
    severity,
    message: !configured
      ? `${label} env var ${name} is not configured.`
      : valid
        ? `${label} env var ${name} is configured.`
        : `${label} env var ${name} is configured but does not look valid.`,
  }];
}

export function diagnoseRuntimeConfigTemplate(template: RuntimeConfigTemplate, env: Record<string, string | undefined> = process.env): RuntimeConfigTemplateDiagnostic[] {
  return [
    ...envDiagnostic({ template, envName: template.config.webhook_url_env, kind: 'webhook_url', value: env[String(template.config.webhook_url_env || '')] }),
    ...envDiagnostic({ template, envName: template.config.bearer_token_env, kind: 'bearer_token', value: env[String(template.config.bearer_token_env || '')] }),
    ...envDiagnostic({ template, envName: template.config.signature_secret_env, kind: 'signature_secret', value: env[String(template.config.signature_secret_env || '')] }),
  ];
}

export function getRuntimeConfigTemplateDiagnostics(env: Record<string, string | undefined> = process.env) {
  return RUNTIME_CONFIG_TEMPLATES.map((template) => ({
    template_id: template.id,
    template_label: template.label,
    diagnostics: diagnoseRuntimeConfigTemplate(template, env),
  }));
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
