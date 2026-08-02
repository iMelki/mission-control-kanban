'use client';

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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent/60',
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
