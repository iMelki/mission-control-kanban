import type { ReactNode } from 'react';

interface PanelProps {
  children: ReactNode;
  className?: string;
}

export function Panel({ children, className = '' }: PanelProps) {
  return (
    <section className={`rounded-lg border border-mc-border bg-mc-bg-secondary/80 ${className}`}>
      {children}
    </section>
  );
}

export function PanelHeader({ children, className = '' }: PanelProps) {
  return <div className={`border-b border-mc-border px-3 py-2 ${className}`}>{children}</div>;
}

export function PanelBody({ children, className = '' }: PanelProps) {
  return <div className={`p-3 ${className}`}>{children}</div>;
}

export function PanelFooter({ children, className = '' }: PanelProps) {
  return <div className={`border-t border-mc-border px-3 py-2 ${className}`}>{children}</div>;
}
