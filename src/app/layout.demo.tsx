// Demo build only (see next.config.mjs): wraps the real root layout with the
// demo notice. Normal builds use layout.tsx and ignore this file.
import type { Metadata } from 'next';
import RootLayout, { metadata as baseMetadata } from './layout';
import { DemoBanner } from '@/demo/DemoBanner';
import '@/demo/demo.css';

export const metadata: Metadata = {
  ...baseMetadata,
  title: {
    default: 'Workspaces · Mission Control demo',
    template: '%s · Mission Control demo',
  },
  description: 'Interactive demo of a kanban board for AI agent teams, with fictional sample data.',
};

export default function DemoRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootLayout>
      {children}
      <DemoBanner />
    </RootLayout>
  );
}
