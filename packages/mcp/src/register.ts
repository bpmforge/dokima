import { appendEvent, type EventLog } from '@dokima/events';
import { McpError } from './errors.js';
import type { McpVerbOptions } from './options.js';
import { loadMcpState } from './query.js';
import type { McpRole, McpServerDefinition, ToolApprovalMode } from './types.js';

export interface RegisterToolInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly requiresApproval: ToolApprovalMode;
}

export interface RegisterServerInput {
  readonly id: string;
  readonly name: string;
  readonly transport: McpServerDefinition['transport'];
  readonly command?: string | null;
  readonly args?: readonly string[];
  readonly url?: string | null;
  readonly description?: string | null;
  readonly tools: readonly RegisterToolInput[];
  readonly actorId: string;
}

/**
 * Registers an MCP server + its tool catalog for this project (US-503:
 * "register MCP servers per project"). Refuses id collisions against both
 * existing servers and existing tools — a duplicate registration is a
 * caller bug, not a silent merge.
 */
export function registerServer(
  log: EventLog,
  input: RegisterServerInput,
  opts: McpVerbOptions = {},
): McpServerDefinition {
  return log.db.transaction((): McpServerDefinition => {
    const state = loadMcpState(log);
    if (state.servers.has(input.id)) {
      throw new McpError(
        'SERVER_ALREADY_REGISTERED',
        `server ${input.id} is already registered`,
      );
    }
    for (const tool of input.tools) {
      if (state.tools.has(tool.id)) {
        throw new McpError(
          'TOOL_ID_COLLISION',
          `tool id ${tool.id} is already registered`,
        );
      }
    }
    appendEvent(
      log,
      {
        eventType: 'mcp.server_registered',
        actorId: input.actorId,
        payload: {
          id: input.id,
          name: input.name,
          transport: input.transport,
          command: input.command ?? null,
          args: input.args ?? [],
          url: input.url ?? null,
          description: input.description ?? null,
          tools: input.tools.map((tool) => ({
            id: tool.id,
            name: tool.name,
            description: tool.description ?? null,
            requiresApproval: tool.requiresApproval,
          })),
        },
      },
      opts,
    );
    const after = loadMcpState(log).servers.get(input.id);
    if (!after) throw new Error(`server ${input.id} did not persist`);
    return after;
  })();
}

export interface SetRoleAllowlistInput {
  readonly role: McpRole;
  readonly toolIds: readonly string[];
  readonly actorId: string;
}

/**
 * Replaces a role's full tool allowlist wholesale (US-503 AC-1). Refuses
 * unknown tool ids so a role can never be granted a tool that doesn't
 * exist.
 */
export function setRoleAllowlist(
  log: EventLog,
  input: SetRoleAllowlistInput,
  opts: McpVerbOptions = {},
): ReadonlySet<string> {
  return log.db.transaction((): ReadonlySet<string> => {
    const state = loadMcpState(log);
    for (const toolId of input.toolIds) {
      if (!state.tools.has(toolId)) {
        throw new McpError('TOOL_NOT_FOUND', `cannot allowlist unknown tool ${toolId}`);
      }
    }
    appendEvent(
      log,
      {
        eventType: 'mcp.allowlist_set',
        actorId: input.actorId,
        payload: { role: input.role, toolIds: input.toolIds },
      },
      opts,
    );
    const after = loadMcpState(log).allowlist.get(input.role);
    if (!after) throw new Error(`allowlist for role ${input.role} did not persist`);
    return after;
  })();
}
