import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { verifyWebhookSignature } from '@/lib/webhook-signatures';
import { registerWebhookCallbackDelivery } from '@/lib/webhook-callback-operations';
import { validateWebhookCallbackPayload } from '@/lib/webhook-callback-schema';
import type { Task, Agent, OpenClawSession } from '@/lib/types';

function deliveryIdFrom(request: NextRequest) {
  return request.headers.get('x-mck-delivery-id') || request.headers.get('x-mck-delivery') || undefined;
}

function taskStatusAfterCallback(task: Task, callbackStatus: 'completed' | 'failed' | 'cancelled') {
  if (callbackStatus !== 'completed') return task.status;
  return task.status === 'testing' || task.status === 'review' || task.status === 'done' ? task.status : 'testing';
}

function completeTask({
  task,
  agentId,
  agentName,
  summary,
  callbackStatus,
  now,
}: {
  task: Task;
  agentId?: string | null;
  agentName?: string | null;
  summary: string;
  callbackStatus: 'completed' | 'failed' | 'cancelled';
  now: string;
}) {
  const newStatus = taskStatusAfterCallback(task, callbackStatus);
  if (newStatus !== task.status) {
    run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [newStatus, now, task.id]);
  }

  const eventType = callbackStatus === 'completed' ? 'task_completed' : 'task_dispatch_failed';
  const prefix = callbackStatus === 'completed' ? 'completed' : callbackStatus;
  run(
    `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), eventType, agentId || null, task.id, `${agentName || 'Agent'} ${prefix}: ${summary}`, now]
  );

  if (agentId) {
    run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['standby', now, agentId]);
  }

  const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [task.id]);
  if (updatedTask) {
    broadcast({ type: 'task_updated', payload: updatedTask });
  }

  return newStatus;
}

/** POST /api/webhooks/agent-completion - receives signed or legacy completion notifications from agents. */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const deliveryId = deliveryIdFrom(request);
    const inboundSecret = process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET;
    const suppliedSignature = request.headers.get('x-mck-signature');
    const now = new Date().toISOString();

    if (inboundSecret || suppliedSignature) {
      const verification = verifyWebhookSignature({
        rawBody,
        secret: inboundSecret || '',
        timestamp: request.headers.get('x-mck-timestamp') || '',
        signature: suppliedSignature,
        deliveryId,
      });
      if (!verification.ok) {
        if (deliveryId) {
          registerWebhookCallbackDelivery({
            deliveryId,
            eventType: 'unknown',
            status: 'signature_invalid',
            reason: verification.reason,
          });
        }
        return NextResponse.json({ error: 'Invalid webhook signature', reason: verification.reason }, { status: 401 });
      }
      if (!deliveryId) {
        return NextResponse.json({ error: 'Missing X-MCK-Delivery-ID for signed callback' }, { status: 400 });
      }
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateWebhookCallbackPayload(body);
    if (!validation.ok || !validation.normalized) {
      if (deliveryId) {
        registerWebhookCallbackDelivery({
          deliveryId,
          eventType: 'unknown',
          status: 'schema_invalid',
          reason: validation.errors[0] || 'schema_invalid',
        });
      }
      return NextResponse.json({ error: 'Invalid callback payload', details: validation.errors }, { status: 400 });
    }

    const normalized = validation.normalized;
    if (deliveryId) {
      const delivery = registerWebhookCallbackDelivery({
        deliveryId,
        taskId: normalized.task_id,
        attemptId: normalized.attempt_id,
        eventType: normalized.event_type,
        status: 'accepted',
      });
      if (!delivery.ok) {
        return NextResponse.json({ error: 'Invalid delivery id', reason: delivery.reason }, { status: 400 });
      }
      if (delivery.duplicate) {
        return NextResponse.json({ success: true, duplicate: true, delivery_id: deliveryId, message: 'Duplicate callback delivery ignored' });
      }
    }

    if (normalized.task_id) {
      const task = queryOne<Task & { assigned_agent_name?: string }>(
        `SELECT t.*, a.name as assigned_agent_name
         FROM tasks t
         LEFT JOIN agents a ON t.assigned_agent_id = a.id
         WHERE t.id = ?`,
        [normalized.task_id]
      );

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }

      const newStatus = completeTask({
        task,
        agentId: task.assigned_agent_id,
        agentName: task.assigned_agent_name,
        summary: normalized.summary,
        callbackStatus: normalized.status,
        now,
      });

      return NextResponse.json({
        success: true,
        task_id: task.id,
        attempt_id: normalized.attempt_id,
        delivery_id: deliveryId,
        status: normalized.status,
        new_status: newStatus,
        message: normalized.status === 'completed' ? 'Task moved to testing for automated verification' : 'Callback recorded without advancing task to testing',
      });
    }

    if (normalized.session_id) {
      const session = queryOne<OpenClawSession>(
        'SELECT * FROM openclaw_sessions WHERE openclaw_session_id = ? AND status = ?',
        [normalized.session_id, 'active']
      );

      if (!session) {
        return NextResponse.json({ error: 'Session not found or inactive' }, { status: 404 });
      }

      const task = queryOne<Task & { assigned_agent_name?: string }>(
        `SELECT t.*, a.name as assigned_agent_name
         FROM tasks t
         LEFT JOIN agents a ON t.assigned_agent_id = a.id
         WHERE t.assigned_agent_id = ?
           AND t.status IN ('assigned', 'in_progress')
         ORDER BY t.updated_at DESC
         LIMIT 1`,
        [session.agent_id]
      );

      if (!task) {
        return NextResponse.json({ error: 'No active task found for this agent' }, { status: 404 });
      }

      const newStatus = completeTask({
        task,
        agentId: session.agent_id,
        agentName: task.assigned_agent_name,
        summary: normalized.summary,
        callbackStatus: normalized.status,
        now,
      });

      return NextResponse.json({
        success: true,
        task_id: task.id,
        agent_id: session.agent_id,
        summary: normalized.summary,
        delivery_id: deliveryId,
        new_status: newStatus,
        message: 'Task moved to testing for automated verification',
      });
    }

    return NextResponse.json({ error: 'Invalid payload. Provide task_id or session_id callback' }, { status: 400 });
  } catch (error) {
    console.error('Agent completion webhook error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process completion' },
      { status: 500 }
    );
  }
}

/** GET /api/webhooks/agent-completion - Returns webhook status and recent completions */
export async function GET() {
  try {
    const recentCompletions = queryAll(
      `SELECT e.*, a.name as agent_name, t.title as task_title
       FROM events e
       LEFT JOIN agents a ON e.agent_id = a.id
       LEFT JOIN tasks t ON e.task_id = t.id
       WHERE e.type = 'task_completed'
       ORDER BY e.created_at DESC
       LIMIT 10`
    );

    return NextResponse.json({
      status: 'active',
      recent_completions: recentCompletions,
      endpoint: '/api/webhooks/agent-completion',
      signature_required: Boolean(process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET),
      replay_protection: 'X-MCK-Delivery-ID with short retention',
    });
  } catch (error) {
    console.error('Failed to fetch completion status:', error);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
