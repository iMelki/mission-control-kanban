/**
 * Task EventSource client. Lives outside the React effect so reconnect
 * timers and the socket are owned by one unsubscribe handle. useSSE must
 * not write OpenClaw online state from this stream.
 */

import { debug } from '@/lib/debug';
import type { SSEEvent, Task } from '@/lib/types';

export type TaskStreamHandlers = {
  onTaskCreated: (task: Task) => void;
  onTaskUpdated: (task: Task) => void;
};

export function subscribeTaskStream(handlers: TaskStreamHandlers): () => void {
  let cancelled = false;
  let connecting = false;
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const closeSource = () => {
    if (!eventSource) {
      return;
    }
    eventSource.onopen = null;
    eventSource.onmessage = null;
    eventSource.onerror = null;
    eventSource.close();
    eventSource = null;
  };

  const connect = () => {
    if (cancelled || connecting || eventSource?.readyState === EventSource.OPEN) {
      return;
    }

    connecting = true;
    debug.sse('Connecting to event stream...');
    eventSource = new EventSource('/api/events/stream');

    eventSource.onopen = () => {
      debug.sse('Connected');
      connecting = false;
      clearReconnect();
    };

    eventSource.onmessage = (event) => {
      try {
        if (event.data.startsWith(':')) {
          return;
        }

        const sseEvent: SSEEvent = JSON.parse(event.data);
        debug.sse(`Received event: ${sseEvent.type}`, sseEvent.payload);

        switch (sseEvent.type) {
          case 'task_created':
            debug.sse('Adding new task to store', { id: (sseEvent.payload as Task).id });
            handlers.onTaskCreated(sseEvent.payload as Task);
            break;
          case 'task_updated': {
            const incomingTask = sseEvent.payload as Task;
            debug.sse('Task update received', {
              id: incomingTask.id,
              status: incomingTask.status,
              title: incomingTask.title,
            });
            handlers.onTaskUpdated(incomingTask);
            break;
          }
          case 'activity_logged':
          case 'deliverable_added':
          case 'agent_spawned':
          case 'agent_completed':
            debug.sse(sseEvent.type, sseEvent.payload);
            break;
          default:
            debug.sse('Unknown event type', sseEvent);
        }
      } catch (error) {
        console.error('[SSE] Error parsing event:', error);
      }
    };

    eventSource.onerror = (error) => {
      debug.sse('Connection error', error);
      connecting = false;
      closeSource();
      if (cancelled) {
        return;
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!cancelled) {
          debug.sse('Attempting to reconnect...');
          connect();
        }
      }, 5000);
    };
  };

  connect();

  return () => {
    cancelled = true;
    debug.sse('Disconnecting...');
    clearReconnect();
    closeSource();
  };
}
