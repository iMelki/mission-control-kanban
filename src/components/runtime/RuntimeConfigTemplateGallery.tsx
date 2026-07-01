'use client';

import { Copy, WandSparkles } from 'lucide-react';
import {
  RUNTIME_CONFIG_TEMPLATES,
  formatRuntimeConfigTemplate,
  type RuntimeConfigTemplateId,
} from '@/lib/runtime-config-templates';

export function RuntimeConfigTemplateGallery({
  onApply,
  onCopy,
  compact = false,
}: {
  onApply: (configJson: string, templateId: RuntimeConfigTemplateId) => void;
  onCopy?: (configJson: string, templateId: RuntimeConfigTemplateId) => void | Promise<void>;
  compact?: boolean;
}) {
  return (
    <div className="rounded border border-mc-border bg-mc-bg-secondary p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <WandSparkles className="size-4 text-mc-accent" /> Runtime config templates
      </div>
      <div className={compact ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
        {RUNTIME_CONFIG_TEMPLATES.map((template) => {
          const json = formatRuntimeConfigTemplate(template);
          return (
            <div key={template.id} className="rounded border border-mc-border bg-mc-bg p-3">
              <div className="text-sm font-medium text-mc-text">{template.label}</div>
              <p className="mt-1 min-h-8 text-xs text-mc-text-secondary">{template.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onApply(json, template.id)}
                  className="rounded border border-mc-border px-2 py-1 text-xs hover:bg-mc-bg-tertiary"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => void onCopy?.(json, template.id)}
                  className="inline-flex items-center gap-1 rounded border border-mc-border px-2 py-1 text-xs hover:bg-mc-bg-tertiary"
                >
                  <Copy className="size-3" /> Copy
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-mc-text-secondary">
        Templates store endpoint and secret references as environment-variable names. Provider names stay in config metadata; the runtime type remains webhook.
      </p>
    </div>
  );
}
