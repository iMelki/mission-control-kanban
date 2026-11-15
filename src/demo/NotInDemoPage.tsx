import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { NotInDemo } from './NotInDemo';

/** Full-page stand-in for operator pages that only make sense against a live install. */
export function NotInDemoPage({ title, detail }: { title: string; detail: string }) {
  return (
    <main id="main-content" tabIndex={-1} className="mck-demo-page">
      <Link href="/" className="mck-demo-page__back">
        <ChevronLeft aria-hidden="true" width={16} height={16} />
        Back to workspaces
      </Link>
      <h1 className="mck-demo-page__title">{title}</h1>
      <NotInDemo title={title} detail={detail} />
    </main>
  );
}
