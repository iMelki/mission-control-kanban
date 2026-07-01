'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, WandSparkles } from 'lucide-react';
import {
  RUNTIME_CONFIG_TEMPLATES,
  formatRuntimeConfigTemplate,
  type RuntimeConfigTemplateDiagnostic,
  type RuntimeConfigTemplateId,
} from '@/lib/runtime-config-templates';

interface DiagnosticsPayload {
  templates?: Array<{
    template_id: RuntimeConfigTemplateId;
    diagnostics: RuntimeConfigTemplateDiagnostic[];
  }>;
}

function diagnosticTone(severity: RuntimeConfigTemplateDiagnostic['severity']) {
  if (severity === 'ok') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (severity === 'blocked') return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
}

export function RuntimeConfigTemplateGallery({
  onApply,
  onCopy,
  compact = false,
}: {
  onApply: (configJson: string, templateId: RuntimeConfigTemplateId) => void;
  onCopy?: (configJson: string, templateId: RuntimeConfigTemplateId) => void | Promise<void>;
  compact?: boolean;
}) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);

  useEffect(() => {
    fetch('/api/runtime/config-template-diagnostics', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setDiagnostics(payload))
      .catch(() => setDiagnostics(null));
  }, []);

  const diagnosticsByTemplate = useMemo(() => new Map(
    diagnostics?.templates?.map((entry) => [entry.template_id, entry.diagnostics]) || []
  ), [diagnostics]);

  return (
    <div className="rounded border border-mc-border bg-mc-bg-secondary p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <WandSparkles className="size-4 text-mc-accent" /> Runtime config templates
      </div>
      <div className={compact ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
        {RUNTIME_CONFIG_TEMPLATES.map((template) => {
          const json = formatRuntimeConfigTemplate(template);
          const templateDiagnostics = diagnosticsByTemplate.get(template.id) || [];
          return (
            <div key={template.id} className="rounded border border-mc-border bg-mc-bg p-3">
              <div className="text-sm font-medium text-mc-text">{template.label}</div>
              <p className="mt-1 min-h-8 text-xs text-mc-text-secondary">{template.description}</p>
              {templateDiagnostics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${template.label} env diagnostics`}>
                  {templateDiagnostics.map((diagnostic) => (
                    <span key={`${diagnostic.env_name}-${diagnostic.kind}`} className={`rounded border px-1.5 py-0.5 text-[10px] ${diagnosticTone(diagnostic.severity)}`} title={diagnostic.message}>
                      {diagnostic.env_name}: {diagnostic.severity}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onApply(json, template.id)} className="rounded border border-mc-border px-2 py-1 text-xs hover:bg-mc-bg-tertiary">Apply</button>
                <button type="button" onClick={() => void onCopy?.(json, template.id)} className="inline-flex items-center gap-1 rounded border border-mc-border px-2 py-1 text-xs hover:bg-mc-bg-tertiary"><Copy className="size-3" /> Copy</button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-mc-text-secondary">
        Templates store endpoint and secret references as environment-variable names. Diagnostics show presence/shape only; secret values are never exposed.
      </p>
    </div>
  );
}
