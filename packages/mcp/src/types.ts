export type McpTransport = 'stdio' | 'http' | 'sse';

/** A registered MCP server (US-503: "register MCP servers per project"). Transport details are descriptive metadata only — the actual stdio/HTTP connection is a `ToolExecutor` concern, injected by the caller (`tool-call.ts`), never opened by this package (C-1 local-first, no network in tests). */
export interface McpServerDefinition {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransport;
  readonly command: string | null;
  readonly args: readonly string[];
  readonly url: string | null;
  readonly description: string | null;
}

/** `true`/`false` are static; `'dynamic'` defers to a `DynamicApprovalPolicy` at call time (SC-12: "requiresApproval flags per tool, dynamic classification for shell"). */
export type ToolApprovalMode = boolean | 'dynamic';

export interface McpToolDefinition {
  readonly id: string;
  readonly serverId: string;
  readonly name: string;
  readonly description: string | null;
  readonly requiresApproval: ToolApprovalMode;
}

/**
 * Free-form per BLUEPRINT/ARCHITECTURE role vocabulary (`packages/gateway`'s
 * `AgentRole`). `mcp` cannot import `gateway` (ARCHITECTURE.md §4 dependency
 * matrix: `mcp` depends only on `shared` + `events`), so the type is
 * re-declared structurally here rather than imported.
 */
export type McpRole = string;

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

/** An approval card parked by `requestToolCall` (US-503 AC-2) and resolved by `decideToolCall`. */
export interface PendingApproval {
  readonly id: string;
  readonly toolId: string;
  readonly serverId: string;
  readonly role: McpRole;
  readonly requestedBy: string;
  /** Read back from the event log, so already `redactDeep`'d (law 8: secrets never persist raw) — `decideToolCall`'s approved path executes with THIS value, not the original. Tool args must be credential refs, never raw secrets, for exactly this reason. */
  readonly args: unknown;
  readonly argsDigest: string;
  readonly estimatedCost: number | null;
  readonly status: ApprovalStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly ticketId: string | null;
  readonly runId: string | null;
}

export type ToolCallStatus = 'completed' | 'denied';

/** One audited, costed, replayable tool-call outcome (US-503 AC-3, SC-12). */
export interface ToolCallRecord {
  readonly id: string;
  readonly toolId: string;
  readonly serverId: string;
  readonly role: McpRole;
  readonly actorId: string;
  readonly argsDigest: string;
  readonly resultDigest: string | null;
  readonly cost: number;
  readonly status: ToolCallStatus;
  readonly requiresApproval: boolean;
  readonly completedAt: string;
  readonly ticketId: string | null;
  readonly runId: string | null;
}

/** The full projected state of the MCP host for one project (folded from the event log — DATABASE.md §3, ARCHITECTURE.md §4 law 4: `mcp` never owns a SQL table of its own). */
export interface McpState {
  readonly servers: ReadonlyMap<string, McpServerDefinition>;
  readonly tools: ReadonlyMap<string, McpToolDefinition>;
  readonly allowlist: ReadonlyMap<McpRole, ReadonlySet<string>>;
  readonly pendingApprovals: ReadonlyMap<string, PendingApproval>;
  readonly callLog: readonly ToolCallRecord[];
}
