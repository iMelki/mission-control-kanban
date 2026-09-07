'use client';

/**
 * shadcn/ui Tabs over `@radix-ui/react-tabs`.
 *
 * CONTRACT: a `TabsList` of `TabsTrigger`s is only accessible when the matching
 * `TabsContent` panels are rendered. Radix gives every trigger `role="tab"` and
 * an `aria-controls` pointing at its panel's generated id; with no `TabsContent`
 * that id never enters the document, and the reference is invalid under
 * WAI-ARIA 1.2 ID Reference Error Processing. The WAI-ARIA APG Tabs pattern is
 * explicit that "Each element with role `tab` has the property `aria-controls`
 * referring to its associated `tabpanel` element".
 *
 * That is exactly how mission-control-kanban#152's one critical finding was
 * created: `WorkspaceSectionTabs` imported Tabs/TabsList/TabsTrigger and never
 * TabsContent, so five triggers announced as tabs and controlled nothing. Note
 * axe-core only FAILS the selected trigger -- it exempts `aria-selected="false"`
 * nodes from the dangling-reference check (axe-core 4.11.1, `aria-controls`
 * preCheck) -- so a broken widget of N tabs shows up as ONE node, not N. A low
 * node count here is not evidence that the widget is nearly right.
 *
 * If you only need to switch between sections that are already on the page, use
 * navigation semantics instead: see `@/components/workspace/WorkspaceSectionTabs`.
 */
import type { ComponentProps } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex flex-wrap items-center gap-2', className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex items-center gap-2 rounded border border-mc-border px-3 py-1.5 text-sm text-mc-text-secondary transition-colors',
        'hover:bg-mc-bg-tertiary hover:text-mc-text',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:border-mc-accent data-[state=active]:bg-mc-accent/10 data-[state=active]:text-mc-accent',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
