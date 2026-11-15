'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * JS-side reduced-motion read for motion CSS cannot reach: dnd-kit's drop
 * animation runs through the Web Animations API, which the stylesheet's
 * reduced-motion block (fleet-motion-primitive Block 2) does not touch.
 * Server snapshot is `true` so nothing animates before hydration knows better.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
}
