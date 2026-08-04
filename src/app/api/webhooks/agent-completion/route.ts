import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run, transaction } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { verifyWebhookSignature } from '@/lib/webhook-signatures';
import {
  CallbackBodyReadError,
  claimWebhookCallbackDelivery,
  finishWebhookCallbackDelivery,
  readBoundedCallbackBody,
  registerWebhookCallbackDelivery,
} from '@/lib/webhook-callback-operations';
import {
  validateWebhookCallbackPayload,
  type NormalizedWebhookCallback,
} from '@/lib/webhook-callback-schema';
import {
  computeTaskRevision,
  type TaskRevisionAgentIdentity,
} from '@/lib/dispatch-adapters';
import { factoryChangedPathsMatchScope } from '../../../../../integrations/paperclip-bridge/src/factory-paths';
import type { Task, Agent, OpenClawSession } from '@/lib/types';

interface TaskDispatchAttemptRow {
  id: string;
  task_id: string;
  agent_id: string | null;
  runtime_type: string;
  correlation_id: string | null;
  task_revision: string | null;
  request_payload: string | null;
  lifecycle_status: string | null;
  receipt_id: string | null;
}

interface LifecycleTaskRow extends Task {
  assigned_agent_name?: string | null;
  assigned_agent_role?: string | null;
  assigned_agent_runtime_type?: string | null;
  assigned_agent_runtime_config?: string | null;
  assigned_agent_dispatch_enabled?: boolean | number | string | null;
}

function deliveryIdFrom(request: NextRequest) {
  return request.headers.get('x-mck-delivery-id') || request.headers.get('x-mck-delivery') || undefined;
}

function receiptIdFrom(receipt?: Record<string, unknown>) {
  return typeof receipt?.receiptId === 'string' ? receipt.receiptId : null;
}

function attemptedFactoryIdentity(attempt: TaskDispatchAttemptRow) {
  if (!attempt.request_payload) return null;
  try {
    const payload = JSON.parse(attempt.request_payload) as {
      factory_contract?: {
        envelope_id?: unknown;
        repository?: { slug?: unknown; base_sha?: unknown; allowed_file_scope?: unknown };
      };
    };
    const repositorySlug = payload.factory_contract?.repository?.slug;
    const repositoryBaseSha = payload.factory_contract?.repository?.base_sha;
    const allowedFileScope = payload.factory_contract?.repository?.allowed_file_scope;
    const envelopeId = payload.factory_contract?.envelope_id;
    return typeof repositorySlug === 'string' && typeof envelopeId === 'string'
      ? {
        repositorySlug,
        repositoryBaseSha: (
          typeof repositoryBaseSha === 'string'
          && /^[a-f0-9]{40}$/.test(repositoryBaseSha)
        ) ? repositoryBaseSha : null,
        allowedFileScope: Array.isArray(allowedFileScope)
          && allowedFileScope.every((scope) => typeof scope === 'string')
          ? allowedFileScope
          : [],
        envelopeId,
      }
      : null;
  } catch {
    return null;
  }
}

function taskRevisionAgentIdentity(task: LifecycleTaskRow): TaskRevisionAgentIdentity | null {
  if (!task.assigned_agent_id) return null;
  return {
    id: task.assigned_agent_id,
    name: task.assigned_agent_name,
    role: task.assigned_agent_role,
    runtime_type: task.assigned_agent_runtime_type,
    runtime_config: task.assigned_agent_runtime_config,
    dispatch_enabled: task.assigned_agent_dispatch_enabled,
  };
}

function lifecycleRejection(
  normalized: NormalizedWebhookCallback,
  lifecycleAttempt: TaskDispatchAttemptRow | undefined,
  task: LifecycleTaskRow | undefined
): { reason: string; message: string; status: number } | null {
  if (!lifecycleAttempt) {
    return { reason: 'attempt_not_found', message: 'Lifecycle callback identity mismatch', status: 409 };
  }
  if (lifecycleAttempt.correlation_id !== normalized.correlation_id) {
    return { reason: 'correlation_mismatch', message: 'Lifecycle callback identity mismatch', status: 409 };
  }
  if (lifecycleAttempt.task_revision !== normalized.task_revision) {
    return { reason: 'task_revision_mismatch', message: 'Lifecycle callback identity mismatch', status: 409 };
  }
  if (!task) return { reason: 'task_not_found', message: 'Task not found', status: 404 };
  if (
    lifecycleAttempt.agent_id !== task.assigned_agent_id
    || lifecycleAttempt.runtime_type !== task.assigned_agent_runtime_type
  ) {
    return {
      reason: 'attempt_agent_mismatch',
      message: 'Task assignment or runtime changed after factory dispatch',
      status: 409,
    };
  }

  const expectedFactoryIdentity = attemptedFactoryIdentity(lifecycleAttempt);
  const currentRevision = computeTaskRevision(
    task,
    taskRevisionAgentIdentity(task),
    expectedFactoryIdentity?.repositoryBaseSha,
  );
  if (currentRevision !== lifecycleAttempt.task_revision) {
    return {
      reason: 'task_revision_stale',
      message: `Task changed after this factory dispatch was accepted (expected ${lifecycleAttempt.task_revision}, current ${currentRevision})`,
      status: 409,
    };
  }
  const lifecycleOrder: Record<string, number> = { started: 1, testing: 2, review: 3, completed: 4 };
  const previousRank = lifecycleAttempt.lifecycle_status ? lifecycleOrder[lifecycleAttempt.lifecycle_status] : undefined;
  const nextRank = lifecycleOrder[normalized.status];
  if (
    normalized.status === 'completed'
    && (
      !expectedFactoryIdentity
      || normalized.receipt?.repository.slug !== expectedFactoryIdentity.repositorySlug
      || normalized.receipt.envelopeId !== expectedFactoryIdentity.envelopeId
      || (
        expectedFactoryIdentity.repositoryBaseSha
        && normalized.receipt.repository.baseSha !== expectedFactoryIdentity.repositoryBaseSha
      )
      || !factoryChangedPathsMatchScope(
        normalized.receipt.repository.changedPaths,
        expectedFactoryIdentity.allowedFileScope,
      )
    )
  ) {
    return {
      reason: 'receipt_repository_mismatch',
      message: 'Completed lifecycle receipt identity does not match the accepted factory contract',
      status: 409,
    };
  }
  if (
    lifecycleAttempt.lifecycle_status === 'completed'
    && normalized.status === 'completed'
    && lifecycleAttempt.receipt_id !== normalized.receipt?.receiptId
  ) {
    return {
      reason: 'receipt_conflict',
      message: 'Completed lifecycle receipt conflicts with the accepted receipt',
      status: 409,
    };
  }
  if (
    (previousRank !== undefined && nextRank !== undefined && nextRank < previousRank)
    || (lifecycleAttempt.lifecycle_status === 'completed' && normalized.status !== 'completed')
  ) {
    return {
      reason: 'lifecycle_regression',
      message: `Lifecycle callback would regress ${lifecycleAttempt.lifecycle_status} to ${normalized.status}`,
      status: 409,
    };
  }
  return null;
}

function taskStatusAfterCallback(task: Task, callbackStatus: 'completed' | 'failed' | 'cancelled') {
  if (callbackStatus !== 'completed') return task.status;
  return task.status === 'testing' || task.status === 'review' || task.status === 'done' ? task.status : 'testing';
}

function taskStatusAfterLifecycle(task: Task, callbackStatus: string) {
  if (callbackStatus === 'completed') return 'done';
  const target = callbackStatus === 'started'
    ? 'in_progress'
    : callbackStatus === 'testing'
      ? 'testing'
      : callbackStatus === 'review'
        ? 'review'
        : undefined;
  if (!target) return task.status;
  const rank: Record<Task['status'], number> = {
    planning: 0,
    inbox: 0,
    assigned: 0,
    in_progress: 1,
    testing: 2,
    review: 3,
    done: 4,
  };
  return rank[task.status] >= rank[target] ? task.status : target;
}

function recordLifecycleCallback({
  task,
  agentId,
  agentName,
  summary,
  callbackStatus,
  attemptId,
  correlationId,
  taskRevision,
  receipt,
  now,
}: {
  task: Task;
  agentId?: string | null;
  agentName?: string | null;
  summary: string;
  callbackStatus: string;
  attemptId: string;
  correlationId: string;
  taskRevision: string;
  receipt?: Record<string, unknown>;
  now: string;
}) {
  const newStatus = taskStatusAfterLifecycle(task, callbackStatus);
  if (newStatus !== task.status) {
    run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [newStatus, now, task.id]);
  }
  const eventType = callbackStatus === 'completed'
    ? 'task_completed'
    : ['blocked', 'needs_human', 'failed', 'cancelled'].includes(callbackStatus)
      ? 'task_dispatch_failed'
      : 'task_status_changed';
  run(
    `INSERT INTO events (id, type, agent_id, task_id, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      eventType,
      agentId || null,
      task.id,
      `${agentName || 'Paperclip'} reported ${callbackStatus}: ${summary}`,
      JSON.stringify({
        callback_version: 2,
        lifecycle_status: callbackStatus,
        attempt_id: attemptId,
        correlation_id: correlationId,
        task_revision: taskRevision,
        receipt_id: receiptIdFrom(receipt),
      }),
      now,
    ]
  );
  run(
    `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      task.id,
      agentId || null,
      callbackStatus === 'completed' ? 'completed' : 'updated',
      `Paperclip lifecycle ${callbackStatus}: ${summary}`,
      JSON.stringify({
        attempt_id: attemptId,
        correlation_id: correlationId,
        task_revision: taskRevision,
        receipt_id: receiptIdFrom(receipt),
      }),
      now,
    ]
  );
  run(
    `UPDATE task_dispatch_attempts
     SET lifecycle_status = ?, receipt_id = ?, receipt_json = ?, updated_at = ?
     WHERE id = ? AND task_id = ?`,
    [
      callbackStatus,
      receiptIdFrom(receipt),
      receipt ? JSON.stringify(receipt) : null,
      now,
      attemptId,
      task.id,
    ]
  );
  if (agentId && ['completed', 'failed', 'cancelled'].includes(callbackStatus)) {
    run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['standby', now, agentId]);
  }
  const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [task.id]);
  return { newStatus, updatedTask };
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
    const rawBody = await readBoundedCallbackBody(request);
    const payloadHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');
    const receivedDeliveryId = deliveryIdFrom(request);
    const inboundSecret = process.env.MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET;
    const suppliedSignature = request.headers.get('x-mck-signature');
    const now = new Date().toISOString();
    let body: unknown;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      body = undefined;
    }
    const lifecycleV2 = Boolean(
      body
      && typeof body === 'object'
      && !Array.isArray(body)
      && (
        (body as Record<string, unknown>).type === 'mck.callback.lifecycle'
        || (body as Record<string, unknown>).schema_version === '2'
      )
    );
    const deliveryId = lifecycleV2
      ? request.headers.get('x-mck-delivery-id') || undefined
      : receivedDeliveryId;
    if (lifecycleV2 && !deliveryId) {
      return NextResponse.json({ error: 'Missing X-MCK-Delivery-ID for lifecycle callback' }, { status: 400 });
    }

    if (inboundSecret || suppliedSignature) {
      const verification = verifyWebhookSignature({
        rawBody,
        secret: inboundSecret || '',
        timestamp: request.headers.get('x-mck-timestamp') || '',
        signature: suppliedSignature,
        deliveryId,
        requireDeliveryIdBinding: lifecycleV2,
      });
      if (!verification.ok) {
        return NextResponse.json({ error: 'Invalid webhook signature', reason: verification.reason }, { status: 401 });
      }
      if (!deliveryId) {
        return NextResponse.json({ error: 'Missing X-MCK-Delivery-ID for signed callback' }, { status: 400 });
      }
    }

    if (body === undefined) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = validateWebhookCallbackPayload(body);
    if (!validation.ok || !validation.normalized) {
      if (deliveryId) {
        registerWebhookCallbackDelivery({
          deliveryId,
          eventType: 'unknown',
          status: 'schema_invalid',
          payloadHash,
          reason: validation.errors[0] || 'schema_invalid',
        });
      }
      return NextResponse.json({ error: 'Invalid callback payload', details: validation.errors }, { status: 400 });
    }

    const normalized = validation.normalized;
    if (normalized.event_type === 'mck.callback.lifecycle') {
      if (!inboundSecret) {
        return NextResponse.json({ error: 'MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET is required for lifecycle callbacks' }, { status: 503 });
      }
      if (!deliveryId) {
        return NextResponse.json({ error: 'Missing X-MCK-Delivery-ID for lifecycle callback' }, { status: 400 });
      }

      const outcome = transaction(() => {
        const claim = claimWebhookCallbackDelivery({
          deliveryId,
          taskId: normalized.task_id,
          attemptId: normalized.attempt_id,
          eventType: normalized.event_type,
          payloadHash,
        });
        if (!claim.ok) {
          return {
            kind: 'rejected' as const,
            reason: claim.reason || 'delivery_claim_failed',
            message: claim.reason === 'payload_conflict'
              ? 'Delivery payload conflicts with the accepted delivery'
              : 'Lifecycle delivery could not be claimed',
            status: 409,
          };
        }
        if (claim.duplicate) {
          const accepted = claim.existing_status === 'accepted';
          return {
            kind: 'duplicate' as const,
            accepted,
            status: accepted ? 200 : 409,
            message: accepted
              ? 'Duplicate callback delivery ignored'
              : claim.existing_status === 'processing'
                ? 'Lifecycle delivery is already processing'
                : 'Previously rejected callback delivery ignored',
          };
        }

        const lifecycleAttempt = queryOne<TaskDispatchAttemptRow>(
          `SELECT id, task_id, agent_id, runtime_type, correlation_id, task_revision,
                  request_payload, lifecycle_status, receipt_id
           FROM task_dispatch_attempts
           WHERE id = ? AND task_id = ?`,
          [normalized.attempt_id, normalized.task_id]
        );
        const task = queryOne<LifecycleTaskRow>(
          `SELECT
             t.*,
             a.name AS assigned_agent_name,
             a.role AS assigned_agent_role,
             a.runtime_type AS assigned_agent_runtime_type,
             a.runtime_config AS assigned_agent_runtime_config,
             a.dispatch_enabled AS assigned_agent_dispatch_enabled
           FROM tasks t
           LEFT JOIN agents a ON t.assigned_agent_id = a.id
           WHERE t.id = ?`,
          [normalized.task_id]
        );
        const rejection = lifecycleRejection(normalized, lifecycleAttempt, task);
        if (rejection) {
          finishWebhookCallbackDelivery(deliveryId, {
            status: 'rejected',
            reason: rejection.reason,
          });
          return { kind: 'rejected' as const, ...rejection };
        }
        if (!lifecycleAttempt || !task) {
          throw new Error('Lifecycle transaction lost its validated task identity');
        }

        const incomingReceiptId = normalized.receipt?.receiptId ?? null;
        if (
          lifecycleAttempt.lifecycle_status === normalized.status
          && (normalized.status !== 'completed' || lifecycleAttempt.receipt_id === incomingReceiptId)
        ) {
          finishWebhookCallbackDelivery(deliveryId, { status: 'accepted' });
          return {
            kind: 'state_duplicate' as const,
            task,
            newStatus: task.status,
          };
        }

        const recorded = recordLifecycleCallback({
          task,
          agentId: task.assigned_agent_id,
          agentName: task.assigned_agent_name,
          summary: normalized.summary,
          callbackStatus: normalized.status,
          attemptId: normalized.attempt_id || '',
          correlationId: normalized.correlation_id || '',
          taskRevision: normalized.task_revision || '',
          receipt: normalized.receipt as Record<string, unknown> | undefined,
          now,
        });
        finishWebhookCallbackDelivery(deliveryId, { status: 'accepted' });
        return {
          kind: 'accepted' as const,
          task,
          newStatus: recorded.newStatus,
          updatedTask: recorded.updatedTask,
        };
      });

      if (outcome.kind === 'rejected') {
        return NextResponse.json(
          { error: outcome.message, reason: outcome.reason },
          { status: outcome.status }
        );
      }
      if (outcome.kind === 'duplicate') {
        return NextResponse.json({
          success: outcome.accepted,
          duplicate: true,
          delivery_id: deliveryId,
          message: outcome.message,
        }, { status: outcome.status });
      }
      if (outcome.kind === 'accepted' && outcome.updatedTask) {
        broadcast({ type: 'task_updated', payload: outcome.updatedTask });
      }
      return NextResponse.json({
        success: true,
        duplicate: outcome.kind === 'state_duplicate',
        task_id: outcome.task.id,
        attempt_id: normalized.attempt_id,
        delivery_id: deliveryId,
        status: normalized.status,
        new_status: outcome.newStatus,
        receipt_id: normalized.receipt?.receiptId,
        message: outcome.kind === 'state_duplicate'
          ? 'Duplicate lifecycle state ignored'
          : normalized.status === 'completed'
            ? 'Receipt verified; task moved to done'
            : ['blocked', 'needs_human', 'failed', 'cancelled'].includes(normalized.status)
              ? 'Lifecycle evidence recorded without false status advancement'
              : `Task moved to ${outcome.newStatus}`,
      });
    }
    if (deliveryId && normalized.event_type !== 'mck.callback.lifecycle') {
      const delivery = registerWebhookCallbackDelivery({
        deliveryId,
        taskId: normalized.task_id,
        attemptId: normalized.attempt_id,
        eventType: normalized.event_type,
        status: 'accepted',
        payloadHash,
      });
      if (!delivery.ok) {
        return NextResponse.json(
          { error: delivery.reason === 'payload_conflict' ? 'Delivery payload conflicts with the accepted delivery' : 'Invalid delivery id', reason: delivery.reason },
          { status: delivery.reason === 'payload_conflict' ? 409 : 400 }
        );
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
        callbackStatus: normalized.status as 'completed' | 'failed' | 'cancelled',
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
        callbackStatus: normalized.status as 'completed' | 'failed' | 'cancelled',
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
    if (error instanceof CallbackBodyReadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
