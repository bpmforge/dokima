import { appendEvent, type EventLog } from '@dokima/events';
import {
  resolveRequiresApproval,
  type DynamicApprovalPolicy,
} from './approval-policy.js';
import { digestOf } from './digest.js';
import { McpError } from './errors.js';
import type { McpVerbOptions } from './options.js';
import { loadMcpState } from './query.js';
import { MCP_APPROVAL_DOMAIN } from './reducer.js';
import type {
  McpRole,
  McpServerDefinition,
  McpState,
  McpToolDefinition,
  PendingApproval,
  ToolCallRecord,
} from './types.js';

export interface ToolExecutionResult {
  readonly result: unknown;
  readonly cost: number;
}

/**
 * The one seam that actually reaches an MCP server (SC-12: "agents request;
 * the core executes"). Never invoked by an agent session directly — only
 * from inside `requestToolCall`/`decideToolCall`, after the allowlist and
 * approval policy have both cleared the call. Transport (stdio/HTTP/SSE
 * spawn) is deliberately kept out of this package and injected instead, so
 * tests run against a fake, no-network executor (C-1) and the real spawn
 * logic can live wherever the caller (loop/harbormaster) wires the actual
 * MCP client.
 */
export type ToolExecutor = (input: {
  readonly server: McpServerDefinition;
  readonly tool: McpToolDefinition;
  readonly args: unknown;
}) => Promise<ToolExecutionResult>;

function requireTool(
  state: McpState,
  toolId: string,
): { tool: McpToolDefinition; server: McpServerDefinition } {
  const tool = state.tools.get(toolId);
  if (!tool) throw new McpError('TOOL_NOT_FOUND', `tool ${toolId} is not registered`);
  const server = state.servers.get(tool.serverId);
  if (!server) {
    throw new McpError('SERVER_NOT_FOUND', `server ${tool.serverId} is not registered`);
  }
  return { tool, server };
}

function requireAllowed(state: McpState, role: McpRole, toolId: string): void {
  const allowed = state.allowlist.get(role);
  if (!allowed || !allowed.has(toolId)) {
    throw new McpError(
      'TOOL_NOT_ALLOWED',
      `role ${role} has no allowlist entry for tool ${toolId}`,
    );
  }
}

/**
 * Refuses a reused call/approval id (mirrors register.ts's
 * `SERVER_ALREADY_REGISTERED`/`TOOL_ID_COLLISION` discipline). Without this,
 * `reduceMcpEvent`'s `approval.requested` case unconditionally overwrites
 * whatever is already in `pendingApprovals` for that id — including
 * silently resetting an already-decided card back to `pending` — and a
 * completed call could be re-appended under the same id, corrupting the
 * audit log's one-record-per-call invariant (US-503 AC-3).
 */
function requireCallIdAvailable(state: McpState, id: string): void {
  if (state.pendingApprovals.has(id)) {
    throw new McpError(
      'CALL_ID_COLLISION',
      `call id ${id} already has a pending approval`,
    );
  }
  if (state.callLog.some((record) => record.id === id)) {
    throw new McpError(
      'CALL_ID_COLLISION',
      `call id ${id} was already used by a completed call`,
    );
  }
}

function requirePendingApproval(state: McpState, id: string): PendingApproval {
  const approval = state.pendingApprovals.get(id);
  if (!approval) throw new McpError('APPROVAL_NOT_FOUND', `no approval ${id}`);
  if (approval.status !== 'pending') {
    throw new McpError(
      'APPROVAL_NOT_PENDING',
      `approval ${id} is ${approval.status}, not pending`,
    );
  }
  return approval;
}

export interface RequestToolCallInput {
  readonly id: string;
  readonly toolId: string;
  readonly role: McpRole;
  readonly actorId: string;
  readonly args: unknown;
  readonly ticketId?: string | null;
  readonly runId?: string | null;
  readonly estimatedCost?: number | null;
  readonly dynamicApprovalPolicy?: DynamicApprovalPolicy;
}

export type RequestToolCallResult =
  | { readonly status: 'pending'; readonly approval: PendingApproval }
  | {
      readonly status: 'completed';
      readonly record: ToolCallRecord;
      readonly result: unknown;
    };

/**
 * The single entry point an agent's tool-call request flows through (SC-12
 * "agents request; the core executes"). Refuses tools the role's allowlist
 * doesn't name (US-503 AC-1) before anything else runs. When the resolved
 * tool needs approval, parks an `approval.requested` card and returns
 * without ever invoking `executor` (AC-2) — the caller must come back
 * through `decideToolCall`. Otherwise executes immediately and appends
 * exactly one audited, costed `mcp.tool_call.completed` event (AC-3).
 */
export async function requestToolCall(
  log: EventLog,
  input: RequestToolCallInput,
  executor: ToolExecutor,
  opts: McpVerbOptions = {},
): Promise<RequestToolCallResult> {
  const state = loadMcpState(log);
  const { tool, server } = requireTool(state, input.toolId);
  requireAllowed(state, input.role, input.toolId);
  requireCallIdAvailable(state, input.id);
  const argsDigest = digestOf(input.args);
  const needsApproval = resolveRequiresApproval(
    tool,
    input.args,
    input.dynamicApprovalPolicy,
  );
  const ticketId = input.ticketId ?? null;
  const runId = input.runId ?? null;

  if (needsApproval) {
    appendEvent(
      log,
      {
        eventType: 'approval.requested',
        actorId: input.actorId,
        ticketId,
        runId,
        payload: {
          approvalId: input.id,
          domain: MCP_APPROVAL_DOMAIN,
          toolId: input.toolId,
          serverId: server.id,
          role: input.role,
          requestedBy: input.actorId,
          args: input.args,
          argsDigest,
          estimatedCost: input.estimatedCost ?? null,
        },
      },
      opts,
    );
    const approval = loadMcpState(log).pendingApprovals.get(input.id);
    if (!approval) throw new Error(`approval ${input.id} did not persist`);
    return { status: 'pending', approval };
  }

  const { result, cost } = await executor({ server, tool, args: input.args });
  const resultDigest = digestOf(result);
  const completed = appendEvent(
    log,
    {
      eventType: 'mcp.tool_call.completed',
      actorId: input.actorId,
      ticketId,
      runId,
      payload: {
        id: input.id,
        toolId: input.toolId,
        serverId: server.id,
        role: input.role,
        actorId: input.actorId,
        argsDigest,
        resultDigest,
        cost,
        requiresApproval: false,
      },
    },
    opts,
  );
  const record: ToolCallRecord = {
    id: input.id,
    toolId: input.toolId,
    serverId: server.id,
    role: input.role,
    actorId: input.actorId,
    argsDigest,
    resultDigest,
    cost,
    status: 'completed',
    requiresApproval: false,
    completedAt: completed.createdAt,
    ticketId,
    runId,
  };
  return { status: 'completed', record, result };
}

export interface DecideToolCallInput {
  readonly id: string;
  readonly decision: 'approved' | 'denied';
  readonly decidedBy: string;
}

export type DecideToolCallResult =
  | { readonly status: 'denied'; readonly record: ToolCallRecord }
  | {
      readonly status: 'completed';
      readonly record: ToolCallRecord;
      readonly result: unknown;
    };

function appendApprovalDecided(
  log: EventLog,
  approval: PendingApproval,
  decision: 'approved' | 'denied',
  decidedBy: string,
  opts: McpVerbOptions,
): void {
  appendEvent(
    log,
    {
      eventType: 'approval.decided',
      actorId: decidedBy,
      ticketId: approval.ticketId,
      runId: approval.runId,
      payload: {
        approvalId: approval.id,
        domain: MCP_APPROVAL_DOMAIN,
        decision,
        decidedBy,
      },
    },
    opts,
  );
}

/**
 * Resolves a parked approval card. `executor` is required only for the
 * `'approved'` path — a `'denied'` decision never reaches the tool (AC-2:
 * the executor spy sees zero calls for a denied card). Refuses
 * self-approval (`decidedBy === requestedBy`) the same way
 * `@dokima/tickets`' `acceptTicket` refuses `SELF_ACCEPT` — maker !=
 * verifier applies to tool-call consent too (THREAT_MODEL T-14: a
 * side-effectful tool must not be approved by the same identity that
 * requested it).
 *
 * For the `'approved'` path, `approval.decided` is appended only *after*
 * the executor resolves successfully — appending it first and then
 * awaiting would leave the approval permanently `'approved'` with no
 * terminal `mcp.tool_call.*` event if the executor throws, which is both
 * unauditable (US-503 AC-3) and unre-drivable (a retry would hit
 * `APPROVAL_NOT_PENDING`). An executor failure instead leaves the card
 * `'pending'`, so `decideToolCall` can simply be retried.
 */
export async function decideToolCall(
  log: EventLog,
  input: DecideToolCallInput,
  executor: ToolExecutor | undefined,
  opts: McpVerbOptions = {},
): Promise<DecideToolCallResult> {
  const state = loadMcpState(log);
  const approval = requirePendingApproval(state, input.id);
  if (input.decidedBy === approval.requestedBy) {
    throw new McpError(
      'SELF_APPROVAL',
      `decide refused: ${input.decidedBy} requested and cannot decide its own approval ${input.id}`,
    );
  }

  if (input.decision === 'denied') {
    appendApprovalDecided(log, approval, 'denied', input.decidedBy, opts);
    const denied = appendEvent(
      log,
      {
        eventType: 'mcp.tool_call.denied',
        actorId: approval.requestedBy,
        ticketId: approval.ticketId,
        runId: approval.runId,
        payload: {
          id: input.id,
          toolId: approval.toolId,
          serverId: approval.serverId,
          role: approval.role,
          actorId: approval.requestedBy,
          argsDigest: approval.argsDigest,
        },
      },
      opts,
    );
    const record: ToolCallRecord = {
      id: input.id,
      toolId: approval.toolId,
      serverId: approval.serverId,
      role: approval.role,
      actorId: approval.requestedBy,
      argsDigest: approval.argsDigest,
      resultDigest: null,
      cost: 0,
      status: 'denied',
      requiresApproval: true,
      completedAt: denied.createdAt,
      ticketId: approval.ticketId,
      runId: approval.runId,
    };
    return { status: 'denied', record };
  }

  if (!executor) {
    throw new McpError(
      'EXECUTOR_REQUIRED',
      `decide refused: approving ${input.id} requires an executor`,
    );
  }
  const { tool, server } = requireTool(state, approval.toolId);
  // `approval.args` is read back from the projection, i.e. the copy
  // `appendEvent` already ran through `redactDeep` when `approval.requested`
  // was stored (law 8: secrets never persist raw in the event log) — a
  // genuinely secret-shaped arg reaches the executor redacted, never the
  // original. `argsDigest` still fingerprints the true pre-redaction args
  // (digest.test.ts / tool-call.test.ts pin this).
  const { result, cost } = await executor({ server, tool, args: approval.args });
  appendApprovalDecided(log, approval, 'approved', input.decidedBy, opts);
  const resultDigest = digestOf(result);
  const completed = appendEvent(
    log,
    {
      eventType: 'mcp.tool_call.completed',
      actorId: approval.requestedBy,
      ticketId: approval.ticketId,
      runId: approval.runId,
      payload: {
        id: input.id,
        toolId: approval.toolId,
        serverId: server.id,
        role: approval.role,
        actorId: approval.requestedBy,
        argsDigest: approval.argsDigest,
        resultDigest,
        cost,
        requiresApproval: true,
      },
    },
    opts,
  );
  const record: ToolCallRecord = {
    id: input.id,
    toolId: approval.toolId,
    serverId: server.id,
    role: approval.role,
    actorId: approval.requestedBy,
    argsDigest: approval.argsDigest,
    resultDigest,
    cost,
    status: 'completed',
    requiresApproval: true,
    completedAt: completed.createdAt,
    ticketId: approval.ticketId,
    runId: approval.runId,
  };
  return { status: 'completed', record, result };
}
