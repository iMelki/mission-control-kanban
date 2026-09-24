/**
 * useSSE Hook
 * Establishes and maintains Server-Sent Events connection for real-time updates.
 * Local SSE is not OpenClaw: this hook must not write connection online state.
 */

'use client';

import { useEffect, useRef } from 'react';
import { useMissionControl } from '@/lib/store';
import { subscribeTaskStream } from '@/lib/task-sse-stream';

export function useSSE() {
  const { updateTask, addTask, selectedTask, setSelectedTask } = useMissionControl();
  const selectedTaskRef = useRef(selectedTask);

  useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);

  useEffect(() => {
    return subscribeTaskStream({
      onTaskCreated: addTask,
      onTaskUpdated: (incomingTask) => {
        updateTask(incomingTask);
        if (selectedTaskRef.current?.id === incomingTask.id) {
          setSelectedTask(incomingTask);
        }
      },
    });
  }, [addTask, updateTask, setSelectedTask]);
}
