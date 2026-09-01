'use client';

import { Header } from '@/components/Header';

export function CockpitLoadingShell({ slug }: { slug: string }) {
  return (
    <div
      className="min-h-[100dvh] max-h-[100dvh] flex flex-col bg-mc-bg overflow-hidden"
      data-workspace-ready="false"
      data-cockpit-load="pending"
    >
      <Header />
      <main id="main-content" tabIndex={-1} className="flex flex-1 min-h-0 flex-col overflow-hidden outline-none">
        <p className="sr-only">Loading workspace {slug}</p>
        <div className="flex flex-col lg:flex-row flex-1 min-w-0 min-h-0 overflow-hidden p-3 gap-3">
          <div className="w-full lg:w-64 shrink-0 rounded-lg border border-mc-border bg-mc-bg-secondary p-3 space-y-2">
            <div className="h-4 w-24 rounded bg-mc-bg-tertiary" />
            <div className="h-10 rounded bg-mc-bg-tertiary" />
            <div className="h-10 rounded bg-mc-bg-tertiary" />
          </div>
          <div className="flex-1 min-w-0 rounded-lg border border-mc-border bg-mc-bg-secondary p-3 space-y-3">
            <div className="h-4 w-40 rounded bg-mc-bg-tertiary" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {['a', 'b', 'c', 'd'].map((slot) => (
                <div key={slot} className="min-h-[140px] rounded-lg border border-mc-border bg-mc-bg p-3">
                  <div className="h-3 w-16 rounded bg-mc-bg-tertiary" />
                  <div className="mt-4 h-16 rounded bg-mc-bg-tertiary" />
                </div>
              ))}
            </div>
          </div>
          <div className="w-full lg:w-80 shrink-0 rounded-lg border border-mc-border bg-mc-bg-secondary p-3 space-y-2">
            <div className="h-4 w-20 rounded bg-mc-bg-tertiary" />
            <div className="h-8 rounded bg-mc-bg-tertiary" />
            <div className="h-8 rounded bg-mc-bg-tertiary" />
          </div>
        </div>
      </main>
    </div>
  );
}
