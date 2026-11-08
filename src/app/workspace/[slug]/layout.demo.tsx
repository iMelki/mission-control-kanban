// Demo build only (see next.config.mjs): replaces the database-backed layout.
// The static export prerenders one page per sample workspace.
import type { Metadata } from 'next';
import { DEMO_WORKSPACE_SLUGS, buildDemoState } from '@/demo/fixtures';

export const dynamicParams = false;

export function generateStaticParams() {
  return DEMO_WORKSPACE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const workspace = buildDemoState(0).workspaces.find((item) => item.slug === slug);
  return { title: workspace ? `${workspace.name} board` : `${slug} board` };
}

export default function DemoWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
