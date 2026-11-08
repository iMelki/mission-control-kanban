import { Info } from 'lucide-react';

/** Calm placeholder for integrations the static demo does not run. Styles live in demo.css. */
export function NotInDemo({ title, detail, className = '' }: { title: string; detail?: string; className?: string }) {
  return (
    <div className={`mck-demo-note ${className}`.trim()}>
      <Info aria-hidden="true" width={16} height={16} className="mck-demo-note__icon" />
      <div className="mck-demo-note__body">
        <div className="mck-demo-note__title">{title}</div>
        <p className="mck-demo-note__detail">Not available in the demo{detail ? `. ${detail}.` : '.'}</p>
      </div>
    </div>
  );
}
