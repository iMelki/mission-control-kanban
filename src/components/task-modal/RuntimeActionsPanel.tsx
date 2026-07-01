import type { ReactNode } from 'react';

export function RuntimeActionsPanel({
  onApplyReadyChecklist,
  onDispatchDryRun,
  isPreviewingDispatch,
  dispatchDryRun,
  disabled,
}: {
  onApplyReadyChecklist: () => void;
  onDispatchDryRun: () => void | Promise<void>;
  isPreviewingDispatch: boolean;
  dispatchDryRun: Record<string, unknown> | null;
  disabled?: boolean;
}) {
  return (
    <section className="space-y-3" aria-label="Runtime actions">
      <div className="grid gap-3 md:grid-cols-2">
        <ActionButton onClick={onApplyReadyChecklist} title="Apply ready-for-agent checklist">
          Seed tests, safety, rollback, and readiness fields.
        </ActionButton>
        <ActionButton onClick={() => void onDispatchDryRun()} title="Dry-run dispatch preview" disabled={disabled || isPreviewingDispatch}>
          Preview manual/OpenClaw/webhook payloads without side effects.
        </ActionButton>
      </div>
      {dispatchDryRun && (
        <details open className="rounded border border-mc-border bg-mc-bg-secondary p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-mc-text">Dispatch dry-run preview</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-mc-bg p-3">{JSON.stringify(dispatchDryRun, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}

function ActionButton({ title, children, onClick, disabled }: { title: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-mc-border px-3 py-2 text-left text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
    >
      <span className="block font-medium">{title}</span>
      <span className="text-xs text-mc-text-secondary">{children}</span>
    </button>
  );
}
