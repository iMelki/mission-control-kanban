import {
  normalizeAgentRuntimeType,
  normalizeDispatchEnabled,
  parseAgentRuntimeConfig,
  serializeAgentRuntimeConfig,
} from './agent-runtimes';
import type { Agent, AgentRuntimeConfig, AgentRuntimeType } from './types';

export type AgentRow = Omit<Agent, 'runtime_type' | 'runtime_config' | 'dispatch_enabled' | 'is_master'> & {
  is_master: boolean | number;
  runtime_type?: string | null;
  runtime_config?: string | AgentRuntimeConfig | null;
  dispatch_enabled?: boolean | number | string | null;
};

export function normalizeAgentForResponse<T extends Partial<AgentRow>>(agent: T): T & {
  is_master: boolean;
  runtime_type: AgentRuntimeType;
  runtime_config: AgentRuntimeConfig;
  dispatch_enabled: boolean;
} {
  return {
    ...agent,
    is_master: normalizeDispatchEnabled(agent.is_master),
    runtime_type: normalizeAgentRuntimeType(agent.runtime_type),
    runtime_config: parseAgentRuntimeConfig(agent.runtime_config),
    dispatch_enabled: normalizeDispatchEnabled(agent.dispatch_enabled),
  };
}

export function runtimeInputToDb(input: {
  runtime_type?: unknown;
  runtime_config?: unknown;
  dispatch_enabled?: unknown;
}) {
  return {
    runtime_type: normalizeAgentRuntimeType(input.runtime_type),
    runtime_config: serializeAgentRuntimeConfig(input.runtime_config),
    dispatch_enabled: normalizeDispatchEnabled(input.dispatch_enabled) ? 1 : 0,
  };
}
