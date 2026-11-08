'use client';

import { RotateCcw } from 'lucide-react';
import { resetDemoState } from './api';

/** Fixed notice shown on every page of the demo build. Styles live in demo.css. */
export function DemoBanner() {
  const reset = () => {
    resetDemoState();
    window.location.reload();
  };

  return (
    <div role="note" aria-label="Demo notice" className="mck-demo-banner">
      <div className="mck-demo-banner__pill">
        <span className="mck-demo-banner__dot" aria-hidden="true" />
        <span className="mck-demo-banner__text">Demo with sample data. Changes stay in your browser.</span>
        <button type="button" onClick={reset} className="mck-demo-banner__reset" title="Restore the sample data">
          <RotateCcw aria-hidden="true" width={12} height={12} />
          Reset
        </button>
      </div>
    </div>
  );
}
