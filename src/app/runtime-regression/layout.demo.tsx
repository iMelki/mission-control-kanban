// Demo build only (see next.config.mjs): this page reads smoke-test artifacts
// from a live install, so the demo shows a calm placeholder instead.
import type { Metadata } from 'next';
import { NotInDemoPage } from '@/demo/NotInDemoPage';

export const metadata: Metadata = { title: 'Runtime regression' };

export default function DemoRuntimeRegressionLayout() {
  return (
    <NotInDemoPage
      title="Runtime regression evidence"
      detail="In the full app this page shows the latest browser smoke-test run and its screenshots"
    />
  );
}
