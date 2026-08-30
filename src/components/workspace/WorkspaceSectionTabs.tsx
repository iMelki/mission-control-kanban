'use client';

import type { ComponentType, ReactNode } from 'react';
import { Activity, Bot, KanbanSquare, RadioTower, Settings } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type WorkspaceSection = 'board' | 'agents' | 'dispatch' | 'settings' | 'activity';

const sections: Array<{ id: WorkspaceSection; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'dispatch', label: 'Dispatch', icon: RadioTower },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'activity', label: 'Activity', icon: Activity },
];

interface WorkspaceSectionTabsProps {
  section: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
  children: ReactNode;
}

export function WorkspaceSectionTabs({
  section,
  onSectionChange,
  children,
}: WorkspaceSectionTabsProps) {
  return (
    <Tabs
      value={section}
      onValueChange={(value) => onSectionChange(value as WorkspaceSection)}
      className="min-h-0 flex-1 gap-0"
    >
      <nav className="border-b border-mc-border bg-mc-bg px-4 py-2" aria-label="Workspace sections">
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
      </nav>
      {children}
    </Tabs>
  );
}

interface WorkspaceSectionContentProps {
  section: WorkspaceSection;
  value: WorkspaceSection;
  children: ReactNode;
}

export function WorkspaceSectionContent({
  section,
  value,
  children,
}: WorkspaceSectionContentProps) {
  const active = section === value;

  return (
    <TabsContent
      value={value}
      forceMount
      hidden={!active}
      tabIndex={active ? 0 : -1}
      className="min-h-0 flex-1 overflow-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mc-accent"
    >
      {active ? children : null}
    </TabsContent>
  );
}
