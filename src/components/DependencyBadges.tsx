import { Link2 } from 'lucide-react';
import type { TaskDependencySummary } from '@/lib/types';

const EMPTY_DEPENDENCIES: TaskDependencySummary[] = [];

export function DependencyBadges({
  blockedBy = EMPTY_DEPENDENCIES,
  blocking = EMPTY_DEPENDENCIES,
  compact = false,
}: {
  blockedBy?: TaskDependencySummary[];
  blocking?: TaskDependencySummary[];
  compact?: boolean;
}) {
  const activeBlockers = blockedBy.filter((row) => row.blocked_by_status !== 'done');
  if (blockedBy.length === 0 && blocking.length === 0) return null;

  const badgeBase = 'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium';
  const blockedTone = activeBlockers.length > 0
    ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? '' : 'mb-3'}`} aria-label="Local dependency badges">
      {blockedBy.length > 0 && (
        <span className={`${badgeBase} ${blockedTone}`} title={activeBlockers.length > 0 ? `${activeBlockers.length} active blocker(s)` : 'All local blockers are done'}>
          <Link2 className="size-3" /> Blocked by {blockedBy.length}
        </span>
      )}
      {blocking.length > 0 && (
        <span className={`${badgeBase} border-amber-500/30 bg-amber-500/10 text-amber-200`}>
          <Link2 className="size-3" /> Blocking {blocking.length}
        </span>
      )}
    </div>
  );
}
