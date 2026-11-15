import type { Metadata } from 'next';
import { queryOne } from '@/lib/db';

/**
 * The workspace page is a client component, so its document title comes from
 * this segment. A missing workspace or an unreadable database falls back to the
 * slug instead of claiming "not found": the page itself decides that (#189).
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const row = queryOne<{ name: string }>('SELECT name FROM workspaces WHERE slug = ? OR id = ?', [slug, slug]);
    // A miss here is a real answer from the database, not a timeout.
    return { title: row?.name ? `${row.name} board` : 'Workspace not found' };
  } catch {
    // Database unreadable: title by slug and let the page report the error.
    return { title: `${slug} board` };
  }
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
