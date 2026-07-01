'use client';

import type { ComponentType } from 'react';
import { Activity, Bot, KanbanSquare, RadioTower, Settings } from 'lucide-react';

export type WorkspaceSection = 'board' | 'agents' | 'dispatch' | 'settings' | 'activity';

const sections: Array<{ id: WorkspaceSection; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'dispatch', label: 'Dispatch', icon: RadioTower },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'activity', label: 'Activity', icon: Activity },
];

export function WorkspaceSectionTabs({ section, onSectionChange }: { section: WorkspaceSection; onSectionChange: (section: WorkspaceSection) => void }) {
  return (
    <nav className="border-b border-mc-border bg-mc-bg px-4 py-2" aria-label="Workspace sections">
      <div className="flex flex-wrap gap-2">
        {sections.map((item) => {
          const Icon = item.icon;
          const active = item.id === section;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm transition-colors ${active ? 'border-mc-accent bg-mc-accent/10 text-mc-accent' : 'border-mc-border text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text'}`}
              aria-pressed={active}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
