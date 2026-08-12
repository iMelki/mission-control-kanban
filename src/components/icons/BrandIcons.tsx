/**
 * Local brand-icon shims for lucide-react >= 1.0.
 *
 * Lucide 1.0 removed all brand icons (https://lucide.dev/guide/version-1).
 * This shim preserves the exact pre-1.0 GitHub glyph this board already
 * rendered, using the ISC-licensed icon node data from lucide-react and the
 * still-supported createLucideIcon factory, so the lucide-react 1.31.0
 * alignment (agent-settings#586, #139) causes zero visual drift.
 *
 * Props are identical to any other lucide icon (size, color, strokeWidth,
 * className). Internal operator surface; the glyph is a decorative service
 * identifier, aria-hidden by default per lucide 1.x.
 */
import { createLucideIcon, type IconNode } from 'lucide-react';

const githubIconNode: IconNode = [
  [
    'path',
    {
      d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
      key: 'tonef',
    },
  ],
  ['path', { d: 'M9 18c-4.51 2-5-2-7-2', key: '9comsn' }],
];

export const Github = createLucideIcon('github', githubIconNode);
