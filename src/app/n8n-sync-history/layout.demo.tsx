// Demo build only (see next.config.mjs): this page reads n8n run history from a
// live install, so the demo shows a calm placeholder instead.
import type { Metadata } from 'next';
import { NotInDemoPage } from '@/demo/NotInDemoPage';

export const metadata: Metadata = { title: 'n8n sync history' };

export default function DemoN8nSyncHistoryLayout() {
  return (
    <NotInDemoPage
      title="n8n sync history"
      detail="In the full app this page lists the scheduled n8n runs that sync GitHub Projects into the board"
    />
  );
}
