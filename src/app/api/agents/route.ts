import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import type { Agent, CreateAgentRequest, Workspace } from '@/lib/types';
import { normalizeAgentForResponse, runtimeInputToDb } from '@/lib/agent-api';
import { resolveAgentRuntimeDefaults } from '@/lib/agent-runtimes';

// GET /api/agents - List all agents
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    let agents: Agent[];
    if (workspaceId) {
      agents = queryAll<Agent>(`
        SELECT * FROM agents WHERE workspace_id = ? ORDER BY is_master DESC, name ASC
      `, [workspaceId]);
    } else {
      agents = queryAll<Agent>(`
        SELECT * FROM agents ORDER BY is_master DESC, name ASC
      `);
    }
    return NextResponse.json(agents.map(normalizeAgentForResponse));
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

// POST /api/agents - Create a new agent
export async function POST(request: NextRequest) {
  try {
    const body: CreateAgentRequest = await request.json();

    if (!body.name || !body.role) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const workspaceId = (body as { workspace_id?: string }).workspace_id || 'default';
    const workspace = queryOne<Workspace>('SELECT * FROM workspaces WHERE id = ? OR slug = ?', [workspaceId, workspaceId]);
    const runtimeDefaults = resolveAgentRuntimeDefaults(body, workspace);
    const runtime = runtimeInputToDb(runtimeDefaults);

    run(
      `INSERT INTO agents (id, name, role, description, avatar_emoji, is_master, runtime_type, runtime_config, dispatch_enabled, workspace_id, soul_md, user_md, agents_md, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.role,
        body.description || null,
        body.avatar_emoji || '🤖',
        body.is_master ? 1 : 0,
        runtime.runtime_type,
        runtime.runtime_config,
        runtime.dispatch_enabled,
        workspace?.id || workspaceId,
        body.soul_md || null,
        body.user_md || null,
        body.agents_md || null,
        now,
        now,
      ]
    );

    // Log event
    run(
      `INSERT INTO events (id, type, agent_id, message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'agent_joined', id, `${body.name} joined the team`, now]
    );

    const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [id]);
    return NextResponse.json(agent ? normalizeAgentForResponse(agent) : null, { status: 201 });
  } catch (error) {
    console.error('Failed to create agent:', error);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
