import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';

type OpenClawMessage = { role: string; content: Array<{ type: string; text?: string }> };
type AssistantMessage = { role: 'assistant'; content: string };

// Helper to extract JSON from a response that might have markdown code blocks or surrounding text
function extractJSON(text: string): object | null {
  // First, try direct parse
  try {
    return JSON.parse(text.trim());
  } catch {
    // Continue to other methods
  }

  // Try to extract from markdown code block (```json ... ``` or ``` ... ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // Try to find JSON object in the text (first { to last })
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      // Continue
    }
  }

  return null;
}

function getFirstTextContent(content: OpenClawMessage['content'] | undefined): string | undefined {
  for (const part of content ?? []) {
    if (part.type === 'text' && part.text) {
      return part.text;
    }
  }

  return undefined;
}

// Helper to get messages from OpenClaw API
async function getMessagesFromOpenClaw(sessionKey: string): Promise<AssistantMessage[]> {
  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    const result = await client.call<{ messages: OpenClawMessage[] }>('chat.history', {
      sessionKey,
      limit: 50,
    });

    return (result.messages || []).flatMap((msg) => {
      if (msg.role !== 'assistant') {
        return [];
      }

      const text = getFirstTextContent(msg.content);
      return text ? [{ role: 'assistant', content: text }] : [];
    });
  } catch (err) {
    console.error('[Planning] Failed to get messages from OpenClaw:', err);
    return [];
  }
}

async function waitForNewAssistantMessage(sessionKey: string, initialMsgCount: number): Promise<string | null> {
  const poll = async (remainingAttempts: number): Promise<string | null> => {
    if (remainingAttempts <= 0) {
      return null;
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const transcriptMessages = await getMessagesFromOpenClaw(sessionKey);
    console.log('[Planning] Answer poll - API messages:', transcriptMessages.length, 'initial:', initialMsgCount);

    if (transcriptMessages.length > initialMsgCount) {
      const lastAssistant = transcriptMessages.at(-1);
      if (lastAssistant) {
        console.log('[Planning] Found new response in transcript');
        return lastAssistant.content;
      }
    }

    return poll(remainingAttempts - 1);
  };

  return poll(30);
}

// POST /api/tasks/[id]/planning/answer - Submit an answer and get next question
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    const body = await request.json();
    const { answer, otherText } = body;

    if (!answer) {
      return NextResponse.json({ error: 'Answer is required' }, { status: 400 });
    }

    // Get task
    const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as {
      id: string;
      title: string;
      description: string;
      planning_session_key?: string;
      planning_messages?: string;
    } | undefined;

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!task.planning_session_key) {
      return NextResponse.json({ error: 'Planning not started' }, { status: 400 });
    }

    // Build the answer message
    const answerText = answer === 'other' && otherText
      ? `Other: ${otherText}`
      : answer;

    const answerPrompt = `User's answer: ${answerText}

Based on this answer and the conversation so far, either:
1. Ask your next question (if you need more information)
2. Complete the planning (if you have enough information)

For another question, respond with JSON:
{
  "question": "Your next question?",
  "options": [
    {"id": "A", "label": "Option A"},
    {"id": "B", "label": "Option B"},
    {"id": "other", "label": "Other"}
  ]
}

If planning is complete, respond with JSON:
{
  "status": "complete",
  "spec": {
    "title": "Task title",
    "summary": "Summary of what needs to be done",
    "deliverables": ["List of deliverables"],
    "success_criteria": ["How we know it's done"],
    "constraints": {}
  },
  "agents": [
    {
      "name": "Agent Name",
      "role": "Agent role",
      "avatar_emoji": "🎯",
      "soul_md": "Agent personality...",
      "instructions": "Specific instructions..."
    }
  ],
  "execution_plan": {
    "approach": "How to execute",
    "steps": ["Step 1", "Step 2"]
  }
}`;

    // Parse existing messages
    const messages = task.planning_messages ? JSON.parse(task.planning_messages) : [];
    messages.push({ role: 'user', content: answerText, timestamp: Date.now() });

    // Connect to OpenClaw and send the answer
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    await client.call('chat.send', {
      sessionKey: task.planning_session_key,
      message: answerPrompt,
      idempotencyKey: `planning-answer-${taskId}-${Date.now()}`,
    });

    // Update messages in DB
    getDb().prepare(`
      UPDATE tasks SET planning_messages = ? WHERE id = ?
    `).run(JSON.stringify(messages), taskId);

    // Poll for response via OpenClaw API
    const initialMessages = await getMessagesFromOpenClaw(task.planning_session_key!);
    const initialMsgCount = initialMessages.length;
    const response = await waitForNewAssistantMessage(task.planning_session_key!, initialMsgCount);

    if (response) {
      messages.push({ role: 'assistant', content: response, timestamp: Date.now() });

      // Use extractJSON to handle code blocks and surrounding text
      const parsed = extractJSON(response) as {
        status?: string;
        question?: string;
        spec?: object;
        agents?: Array<{
          name: string;
          role: string;
          avatar_emoji?: string;
          soul_md?: string;
          instructions?: string;
        }>;
        execution_plan?: object;
      } | null;

      if (parsed) {
        // Check if planning is complete
        if (parsed.status === 'complete') {
          getDb().prepare(`
            UPDATE tasks
            SET planning_messages = ?,
                planning_complete = 1,
                planning_spec = ?,
                planning_agents = ?,
                status = 'inbox'
            WHERE id = ?
          `).run(
            JSON.stringify(messages),
            JSON.stringify(parsed.spec),
            JSON.stringify(parsed.agents),
            taskId
          );

          // Create the agents in the workspace and track first agent for auto-assign
          let firstAgentId: string | null = null;

          if (parsed.agents && parsed.agents.length > 0) {
            const insertAgent = getDb().prepare(`
              INSERT INTO agents (id, workspace_id, name, role, description, avatar_emoji, status, soul_md, created_at, updated_at)
              VALUES (?, (SELECT workspace_id FROM tasks WHERE id = ?), ?, ?, ?, ?, 'standby', ?, datetime('now'), datetime('now'))
            `);

            for (const agent of parsed.agents) {
              const agentId = crypto.randomUUID();
              if (!firstAgentId) firstAgentId = agentId;

              insertAgent.run(
                agentId,
                taskId,
                agent.name,
                agent.role,
                agent.instructions || '',
                agent.avatar_emoji || '🤖',
                agent.soul_md || ''
              );
            }
          }

          // AUTO-DISPATCH: Assign to first agent and trigger dispatch
          if (firstAgentId) {
            // Assign task to the first created agent
            getDb().prepare(`
              UPDATE tasks SET assigned_agent_id = ? WHERE id = ?
            `).run(firstAgentId, taskId);

            console.log(`[Planning] Auto-assigned task ${taskId} to agent ${firstAgentId}`);

            // Trigger dispatch - use localhost since we're in the same process
            const dispatchUrl = `http://localhost:${process.env.PORT || 3000}/api/tasks/${taskId}/dispatch`;
            console.log(`[Planning] Triggering dispatch: ${dispatchUrl}`);

            try {
              const dispatchRes = await fetch(dispatchUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });

              if (dispatchRes.ok) {
                const dispatchData = await dispatchRes.json();
                console.log(`[Planning] Dispatch successful:`, dispatchData);
              } else {
                const errorText = await dispatchRes.text();
                console.error(`[Planning] Dispatch failed (${dispatchRes.status}):`, errorText);
              }
            } catch (err) {
              console.error('[Planning] Auto-dispatch error:', err);
            }
          }

          return NextResponse.json({
            complete: true,
            spec: parsed.spec,
            agents: parsed.agents,
            executionPlan: parsed.execution_plan,
            messages,
            autoDispatched: !!firstAgentId,
          });
        }

        // Not complete, return next question if it has one
        if (parsed.question) {
          getDb().prepare(`
            UPDATE tasks SET planning_messages = ? WHERE id = ?
          `).run(JSON.stringify(messages), taskId);

          return NextResponse.json({
            complete: false,
            currentQuestion: parsed,
            messages,
          });
        }
      }

      // Response wasn't valid JSON or didn't have expected structure
      getDb().prepare(`
        UPDATE tasks SET planning_messages = ? WHERE id = ?
      `).run(JSON.stringify(messages), taskId);

      return NextResponse.json({
        complete: false,
        rawResponse: response,
        messages,
      });
    }

    return NextResponse.json({
      complete: false,
      messages,
      note: 'Answer submitted, waiting for response.',
    });
  } catch (error) {
    console.error('Failed to submit answer:', error);
    return NextResponse.json({ error: 'Failed to submit answer: ' + (error as Error).message }, { status: 500 });
  }
}
