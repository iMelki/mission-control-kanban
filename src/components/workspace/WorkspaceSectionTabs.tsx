'use client';

import type { ComponentType } from 'react';
import { Activity, Bot, KanbanSquare, RadioTower, Settings } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
      <Tabs value={section} onValueChange={(value) => onSectionChange(value as WorkspaceSection)}>
        <TabsList>
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <TabsTrigger key={item.id} value={item.id}>
                <Icon className="size-4" />
                {item.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </nav>
  );
}
