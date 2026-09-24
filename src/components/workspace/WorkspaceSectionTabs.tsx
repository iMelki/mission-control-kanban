'use client';

import type { ComponentType } from 'react';
import { Activity, Bot, KanbanSquare, RadioTower, Settings } from 'lucide-react';

import { cn } from '@/lib/utils';

export type WorkspaceSection = 'board' | 'agents' | 'dispatch' | 'settings' | 'activity';

const sections: Array<{ id: WorkspaceSection; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'dispatch', label: 'Dispatch', icon: RadioTower },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'activity', label: 'Activity', icon: Activity },
];

/**
 * These five controls are NAVIGATION, not a tab widget.
 *
 * They used to be a Radix `Tabs` root: `role="tablist"` with five `role="tab"`
 * buttons. There was never a `role="tabpanel"` anywhere in this app -- the sole
 * consumer imported `Tabs`, `TabsList` and `TabsTrigger` and never `TabsContent`,
 * so every `aria-controls` pointed at an id that does not exist in the document.
 * A screen-reader user was told "tab, 1 of 5, selected" and handed a control
 * that resolves to nothing. That is `aria-valid-attr-value` (critical) in
 * mission-control-kanban#152, and it is worse than plain navigation: an
 * announced-but-broken widget promises panel semantics the app cannot honour.
 *
 * The WAI-ARIA APG Tabs pattern makes the panel a requirement of the role --
 * "Each element with role `tab` has the property `aria-controls` referring to
 * its associated `tabpanel` element" -- and WAI-ARIA 1.2 treats an ID reference
 * that does not resolve as invalid. The section bodies here live inside
 * `<main id="main-content">` on `workspace/[slug]/page.tsx`, and one of them
 * (`WorkspaceRuntimePolicyPanel`) renders OUTSIDE `<main>` entirely, so there is
 * no single element that could honestly carry `role="tabpanel"`.
 *
 * So the roles are gone rather than papered over. The wrapper already declared
 * `<nav aria-label="Workspace sections">`; these are now plain buttons in a list
 * inside that landmark, and the selected one carries `aria-current="true"`
 * ("represents the current item within a set" -- the switch is local component
 * state, not a page or a location change, so `page`/`location` would both
 * overstate it).
 *
 * Consequences, recorded so nobody rediscovers them as surprises:
 *  - All five are Tab stops now. Radix's roving tabindex parked `tabindex="-1"`
 *    on the four unselected triggers and made them arrow-key-only. Five stops in
 *    a nav landmark is the ordinary behaviour for navigation.
 *  - The `focus-visible:ring-2 focus-visible:ring-mc-accent` indicator hardened
 *    under #150 is carried over verbatim, so the focus evidence there still holds.
 *  - The a11y probe's sample-destruction hazard goes with it: focusing an
 *    inactive Radix trigger SELECTED it and collapsed the focusable population
 *    from 490 to 19 mid-measurement (see `scripts/probe-surface-a11y.mjs`,
 *    TAB_REACHABLE_NOTE). Plain buttons do not activate on focus.
 *
 * If a real tab widget is ever wanted here, use `@/components/ui/tabs` and render
 * `TabsContent` panels. Do not re-add `role="tab"` without them.
 */
export function WorkspaceSectionTabs({ section, onSectionChange }: { section: WorkspaceSection; onSectionChange: (section: WorkspaceSection) => void }) {
  return (
    <nav className="border-b border-mc-border bg-mc-bg px-4 py-2" aria-label="Workspace sections">
      <ul className="inline-flex flex-wrap items-center gap-2">
        {sections.map((item) => {
          const Icon = item.icon;
          const isCurrent = item.id === section;
          return (
            <li key={item.id}>
              <button
                type="button"
                data-slot="workspace-section-link"
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => onSectionChange(item.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded border border-mc-border px-3 py-1.5 text-sm text-mc-text-secondary transition-colors',
                  'hover:bg-mc-bg-tertiary hover:text-mc-text',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent',
                  'disabled:pointer-events-none disabled:opacity-50',
                  isCurrent && 'border-mc-accent bg-mc-accent/10 text-mc-accent',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
