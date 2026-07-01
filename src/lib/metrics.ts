import { queryAll, queryOne } from '@/lib/db';

function promEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function line(name: string, labels: Record<string, string>, value: number) {
  const renderedLabels = Object.entries(labels)
    .map(([key, labelValue]) => `${key}="${promEscape(labelValue)}"`)
    .join(',');
  return `${name}{${renderedLabels}} ${value}`;
}

export function buildMckMetricsText() {
  const lines: string[] = [
    '# HELP mck_tasks_total MCK tasks by status and workspace.',
    '# TYPE mck_tasks_total gauge',
  ];

  const taskCounts = queryAll<{ workspace_id: string; status: string; count: number }>(
    'SELECT workspace_id, status, COUNT(*) as count FROM tasks GROUP BY workspace_id, status'
  );
  for (const row of taskCounts) {
    lines.push(line('mck_tasks_total', { workspace: row.workspace_id || 'default', status: row.status }, row.count));
  }

  lines.push('# HELP mck_agents_total MCK agents by runtime and dispatch toggle.');
  lines.push('# TYPE mck_agents_total gauge');
  const agentCounts = queryAll<{ runtime_type: string; dispatch_enabled: number; count: number }>(
    'SELECT runtime_type, dispatch_enabled, COUNT(*) as count FROM agents GROUP BY runtime_type, dispatch_enabled'
  );
  for (const row of agentCounts) {
    lines.push(line('mck_agents_total', {
      runtime: row.runtime_type || 'manual',
      dispatch_enabled: row.dispatch_enabled ? 'true' : 'false',
    }, row.count));
  }

  lines.push('# HELP mck_dispatch_attempts_total Dispatch attempt rows by runtime and status.');
  lines.push('# TYPE mck_dispatch_attempts_total gauge');
  const attemptCounts = queryAll<{ runtime_type: string; status: string; count: number }>(
    'SELECT runtime_type, status, COUNT(*) as count FROM task_dispatch_attempts GROUP BY runtime_type, status'
  );
  for (const row of attemptCounts) {
    lines.push(line('mck_dispatch_attempts_total', { runtime: row.runtime_type, status: row.status }, row.count));
  }

  const pendingWebhookConfig = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM agents
     WHERE runtime_type = 'webhook'
       AND dispatch_enabled = 1
       AND (runtime_config IS NULL OR (runtime_config NOT LIKE '%webhook_url%' AND runtime_config NOT LIKE '%url%'))`
  )?.count ?? 0;
  lines.push('# HELP mck_webhook_agents_missing_config Webhook agents enabled for dispatch without a configured URL.');
  lines.push('# TYPE mck_webhook_agents_missing_config gauge');
  lines.push(`mck_webhook_agents_missing_config ${pendingWebhookConfig}`);

  lines.push('# HELP mck_runtime_secret_configured Runtime secret presence flags; values are booleans as 0/1, never secret values.');
  lines.push('# TYPE mck_runtime_secret_configured gauge');
  lines.push(line('mck_runtime_secret_configured', { name: 'webhook_signature_outbound' }, process.env.MCK_WEBHOOK_SIGNATURE_SECRET ? 1 : 0));
  lines.push(line('mck_runtime_secret_configured', { name: 'webhook_callback_inbound' }, process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET ? 1 : 0));

  return `${lines.join('\n')}\n`;
}
