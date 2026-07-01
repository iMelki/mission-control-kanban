'use client';

import { useCallback, useSyncExternalStore, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Event } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

type FeedFilter = 'all' | 'tasks' | 'agents';

const COLLAPSED_STORAGE_KEY = 'mck:live-feed-collapsed';
const COLLAPSED_CHANGE_EVENT = 'mck:live-feed-collapsed-change';

function readCollapsedPreference() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
}

function persistCollapsedPreference(value: boolean) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(value));
    window.dispatchEvent(new Event(COLLAPSED_CHANGE_EVENT));
  }
}

function subscribeCollapsedPreference(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;

  window.addEventListener(COLLAPSED_CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(COLLAPSED_CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function getServerCollapsedPreference() {
  return false;
}

export function LiveFeed() {
  const { events } = useMissionControl();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const isCollapsed = useSyncExternalStore(
    subscribeCollapsedPreference,
    readCollapsedPreference,
    getServerCollapsedPreference
  );

  const setIsCollapsed = useCallback((value: boolean) => {
    persistCollapsedPreference(value);
  }, []);

  const filteredEvents = events.filter((event) => {
    if (filter === 'all') return true;
    if (filter === 'tasks') {
      return ['task_created', 'task_assigned', 'task_status_changed', 'task_completed'].includes(
        event.type
      );
    }
    if (filter === 'agents') {
      return ['agent_joined', 'agent_status_changed', 'message_sent'].includes(event.type);
    }
    return true;
  });

  return (
    <aside
      className={`shrink-0 bg-mc-bg-secondary border-l border-mc-border flex flex-col transition-[width] duration-200 ease-in-out overflow-hidden ${
        isCollapsed ? 'w-12' : 'w-80'
      }`}
      aria-label="Live feed sidebar"
    >
      {isCollapsed ? (
        <LiveFeedCollapsedRail eventCount={events.length} onExpand={() => setIsCollapsed(false)} />
      ) : (
        <LiveFeedExpandedPanel
          events={filteredEvents}
          filter={filter}
          onCollapse={() => setIsCollapsed(true)}
          onFilterChange={setFilter}
        />
      )}
    </aside>
  );
}

function LiveFeedCollapsedRail({ eventCount, onExpand }: { eventCount: number; onExpand: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-3 py-3">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand live feed"
        title="Expand live feed"
        className="rounded p-2 text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="text-2xl" aria-hidden="true">📡</div>
      <span
        className="rounded bg-mc-bg-tertiary px-2 py-0.5 text-xs text-mc-text-secondary"
        title={`${eventCount} events`}
      >
        {eventCount}
      </span>
    </div>
  );
}

function LiveFeedExpandedPanel({
  events,
  filter,
  onCollapse,
  onFilterChange,
}: {
  events: Event[];
  filter: FeedFilter;
  onCollapse: () => void;
  onFilterChange: (filter: FeedFilter) => void;
}) {
  return (
    <>
      <div className="p-3 border-b border-mc-border">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
            <span className="text-sm font-medium uppercase tracking-wider">Live Feed</span>
          </div>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse live feed"
            title="Collapse live feed"
            className="rounded p-1 text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-1">
          {(['all', 'tasks', 'agents'] as FeedFilter[]).map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => onFilterChange(tab)}
              className={`px-3 py-1 text-xs rounded uppercase ${
                filter === tab
                  ? 'bg-mc-accent text-mc-bg font-medium'
                  : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {events.length === 0 ? (
          <div className="text-center py-8 text-mc-text-secondary text-sm">No events yet</div>
        ) : (
          events.map((event) => <EventItem key={event.id} event={event} />)
        )}
      </div>
    </>
  );
}

function EventItem({ event }: { event: Event }) {
  const isTaskEvent = ['task_created', 'task_assigned', 'task_completed'].includes(event.type);
  const isHighlight = event.type === 'task_created' || event.type === 'task_completed';

  return (
    <div
      className={`p-2 rounded border-l-2 animate-slide-in ${
        isHighlight
          ? 'bg-mc-bg-tertiary border-mc-accent-pink'
          : 'bg-transparent border-transparent hover:bg-mc-bg-tertiary'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm">{getEventIcon(event.type)}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${isTaskEvent ? 'text-mc-accent-pink' : 'text-mc-text'}`}>
            {event.message}
          </p>
          <div className="flex items-center gap-1 mt-1 text-xs text-mc-text-secondary">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
          </div>
        </div>
      </div>
    </div>
  );
}

function getEventIcon(type: string) {
  switch (type) {
    case 'task_created':
      return '📋';
    case 'task_assigned':
      return '👤';
    case 'task_status_changed':
      return '🔄';
    case 'task_completed':
      return '✅';
    case 'message_sent':
      return '💬';
    case 'agent_joined':
      return '🎉';
    case 'agent_status_changed':
      return '🔔';
    case 'system':
      return '⚙️';
    default:
      return '📌';
  }
}
