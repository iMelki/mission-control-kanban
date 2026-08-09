import type { LucideIcon } from 'lucide-react';
import { Bot, Folder } from 'lucide-react';

interface EntityEmojiProps {
  emoji?: string | null;
  kind?: 'agent' | 'workspace';
  /** Accessible name for the entity (e.g. "Agent avatar: Charlie"). Required unless `hidden`. */
  label?: string;
  /** Set when the entity's text name is rendered immediately adjacent. */
  hidden?: boolean;
  className?: string;
}

const FALLBACK_ICONS: Record<'agent' | 'workspace', LucideIcon> = {
  agent: Bot,
  workspace: Folder,
};

/**
 * Shared emoji-identity primitive (fleet emoji-boundary ruling, 2026-08-09).
 * Operator-chosen emoji (agent avatars, workspace icons) are data, not
 * decoration: render with role="img" + an aria-label naming the entity, or
 * aria-hidden when the entity's text name is immediately adjacent. Empty
 * values fall back to a Lucide icon instead of a broken glyph.
 */
export function EntityEmoji({ emoji, kind = 'agent', label, hidden = false, className }: EntityEmojiProps) {
  const value = emoji?.trim();
  if (!value) {
    const Fallback = FALLBACK_ICONS[kind];
    return <Fallback aria-hidden="true" className={className ? `inline-block size-[1em] ${className}` : 'inline-block size-[1em]'} />;
  }
  if (hidden) {
    return <span aria-hidden="true" className={className}>{value}</span>;
  }
  return <span role="img" aria-label={label} className={className}>{value}</span>;
}
