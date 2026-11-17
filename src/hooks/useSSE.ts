/**
 * useSSE Hook
 * Establishes and maintains Server-Sent Events connection for real-time updates.
 * Local SSE is not OpenClaw: this hook must not write connection online state.
 */

'use client';

import { useEffect, useRef } from 'react';
import { useMissionControl } from '@/lib/store';
import { subscribeTaskStream } from '@/lib/task-sse-stream';
import { taskStreamHandlers } from '@/lib/board-move-registry';

export function useSSE() {
  const { selectedTask, setSelectedTask } = useMissionControl();
  const selectedTaskRef = useRef(selectedTask);

  useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);

  useEffect(() => {
    // taskStreamHandlers reports each task's server status to the board's move controller
    // (at the source, before the store write) and then updates the store.
    return subscribeTaskStream(taskStreamHandlers((incomingTask) => {
      if (selectedTaskRef.current?.id === incomingTask.id) {
        setSelectedTask(incomingTask);
      }
    }));
  }, [setSelectedTask]);
}
