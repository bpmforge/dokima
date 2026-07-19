import type { EventRecord, Projection } from '@shipwright/events';
import type {
  McpRole,
  McpServerDefinition,
  McpState,
  PendingApproval,
  ToolApprovalMode,
  ToolCallRecord,
} from './types.js';

/**
 * Discriminator carried on the generic `approval.requested`/`approval.decided`
 * event family (ARCHITECTURE.md §3's representative event catalog already
 * names this pair) so this reducer only folds MCP tool-call approvals, never
 * an unrelated approval domain a future feature might share the event type
 * with.
 */
export const MCP_APPROVAL_DOMAIN = 'mcp_tool_call';

export interface ServerRegisteredPayload {
  readonly id: string;
  readonly name: string;
  readonly transport: McpServerDefinition['transport'];
  readonly command: string | null;
  readonly args: readonly string[];
  readonly url: string | null;
  readonly description: string | null;
  readonly tools: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly requiresApproval: ToolApprovalMode;
  }>;
}

export interface AllowlistSetPayload {
  readonly role: McpRole;
  readonly toolIds: readonly string[];
}

export interface ApprovalRequestedPayload {
  readonly approvalId: string;
  readonly domain: string;
  readonly toolId: string;
  readonly serverId: string;
  readonly role: McpRole;
  readonly requestedBy: string;
  readonly args: unknown;
  readonly argsDigest: string;
  readonly estimatedCost: number | null;
}

export interface ApprovalDecidedPayload {
  readonly approvalId: string;
  readonly domain: string;
  readonly decision: 'approved' | 'denied';
  readonly decidedBy: string;
}

export interface ToolCallCompletedPayload {
  readonly id: string;
  readonly toolId: string;
  readonly serverId: string;
  readonly role: McpRole;
  readonly actorId: string;
  readonly argsDigest: string;
  readonly resultDigest: string | null;
  readonly cost: number;
  readonly requiresApproval: boolean;
}

export interface ToolCallDeniedPayload {
  readonly id: string;
  readonly toolId: string;
  readonly serverId: string;
  readonly role: McpRole;
  readonly actorId: string;
  readonly argsDigest: string;
}

function initialState(): McpState {
  return {
    servers: new Map(),
    tools: new Map(),
    allowlist: new Map(),
    pendingApprovals: new Map(),
    callLog: [],
  };
}

/** Pure fold of one event onto the MCP host's projected state. Unknown event types, and `approval.*` events carrying a foreign `domain`, are no-ops — this projection only ever speaks for MCP tool calls. */
export function reduceMcpEvent(state: McpState, event: EventRecord): McpState {
  switch (event.eventType) {
    case 'mcp.server_registered': {
      const payload = event.payload as ServerRegisteredPayload;
      const server: McpServerDefinition = {
        id: payload.id,
        name: payload.name,
        transport: payload.transport,
        command: payload.command,
        args: payload.args,
        url: payload.url,
        description: payload.description,
      };
      const servers = new Map(state.servers);
      servers.set(server.id, server);
      const tools = new Map(state.tools);
      for (const tool of payload.tools) {
        tools.set(tool.id, {
          id: tool.id,
          serverId: server.id,
          name: tool.name,
          description: tool.description,
          requiresApproval: tool.requiresApproval,
        });
      }
      return { ...state, servers, tools };
    }
    case 'mcp.allowlist_set': {
      const payload = event.payload as AllowlistSetPayload;
      const allowlist = new Map(state.allowlist);
      allowlist.set(payload.role, new Set(payload.toolIds));
      return { ...state, allowlist };
    }
    case 'approval.requested': {
      const payload = event.payload as ApprovalRequestedPayload;
      if (payload.domain !== MCP_APPROVAL_DOMAIN) return state;
      const pendingApprovals = new Map(state.pendingApprovals);
      const approval: PendingApproval = {
        id: payload.approvalId,
        toolId: payload.toolId,
        serverId: payload.serverId,
        role: payload.role,
        requestedBy: payload.requestedBy,
        args: payload.args,
        argsDigest: payload.argsDigest,
        estimatedCost: payload.estimatedCost,
        status: 'pending',
        requestedAt: event.createdAt,
        decidedAt: null,
        decidedBy: null,
        ticketId: event.ticketId,
        runId: event.runId,
      };
      pendingApprovals.set(approval.id, approval);
      return { ...state, pendingApprovals };
    }
    case 'approval.decided': {
      const payload = event.payload as ApprovalDecidedPayload;
      if (payload.domain !== MCP_APPROVAL_DOMAIN) return state;
      const existing = state.pendingApprovals.get(payload.approvalId);
      if (!existing || existing.status !== 'pending') return state;
      const pendingApprovals = new Map(state.pendingApprovals);
      pendingApprovals.set(payload.approvalId, {
        ...existing,
        status: payload.decision,
        decidedAt: event.createdAt,
        decidedBy: payload.decidedBy,
      });
      return { ...state, pendingApprovals };
    }
    case 'mcp.tool_call.completed': {
      const payload = event.payload as ToolCallCompletedPayload;
      const record: ToolCallRecord = {
        id: payload.id,
        toolId: payload.toolId,
        serverId: payload.serverId,
        role: payload.role,
        actorId: payload.actorId,
        argsDigest: payload.argsDigest,
        resultDigest: payload.resultDigest,
        cost: payload.cost,
        status: 'completed',
        requiresApproval: payload.requiresApproval,
        completedAt: event.createdAt,
        ticketId: event.ticketId,
        runId: event.runId,
      };
      return { ...state, callLog: [...state.callLog, record] };
    }
    case 'mcp.tool_call.denied': {
      const payload = event.payload as ToolCallDeniedPayload;
      const record: ToolCallRecord = {
        id: payload.id,
        toolId: payload.toolId,
        serverId: payload.serverId,
        role: payload.role,
        actorId: payload.actorId,
        argsDigest: payload.argsDigest,
        resultDigest: null,
        cost: 0,
        status: 'denied',
        requiresApproval: true,
        completedAt: event.createdAt,
        ticketId: event.ticketId,
        runId: event.runId,
      };
      return { ...state, callLog: [...state.callLog, record] };
    }
    default:
      return state;
  }
}

/** Map-level projection (events package `Projection<S>` contract). */
export const mcpProjection: Projection<McpState> = {
  name: 'mcp',
  initial: initialState,
  reduce: reduceMcpEvent,
};
