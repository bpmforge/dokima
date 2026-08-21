export const PACKAGE_NAME = 'mcp';

export {
  defaultShellApprovalPolicy,
  resolveRequiresApproval,
} from './approval-policy.js';
export type { DynamicApprovalPolicy } from './approval-policy.js';
export { digestOf, stableStringify } from './digest.js';
export { McpError } from './errors.js';
export type { McpErrorCode } from './errors.js';
export type { McpVerbOptions } from './options.js';
export {
  getPendingApproval,
  getServer,
  getTool,
  listPendingApprovals,
  listServers,
  listToolCalls,
  listTools,
  listToolsForRole,
  loadMcpState,
} from './query.js';
export { MCP_APPROVAL_DOMAIN, mcpProjection, reduceMcpEvent } from './reducer.js';
export type {
  AllowlistSetPayload,
  ApprovalDecidedPayload,
  ApprovalRequestedPayload,
  ServerRegisteredPayload,
  ToolCallCompletedPayload,
  ToolCallDeniedPayload,
} from './reducer.js';
export { registerServer, setRoleAllowlist } from './register.js';
export type {
  RegisterServerInput,
  RegisterToolInput,
  SetRoleAllowlistInput,
} from './register.js';
export { decideToolCall, requestToolCall } from './tool-call.js';
export type {
  DecideToolCallInput,
  DecideToolCallResult,
  RequestToolCallInput,
  RequestToolCallResult,
  ToolExecutionResult,
  ToolExecutor,
} from './tool-call.js';
export type {
  ApprovalStatus,
  McpRole,
  McpServerDefinition,
  McpState,
  McpToolDefinition,
  McpTransport,
  PendingApproval,
  ToolApprovalMode,
  ToolCallRecord,
  ToolCallStatus,
} from './types.js';

/**
 * W14-01: the stdio transport this package was designed to have injected.
 * Consumed by apps/server's run preload (W14-02) — the client pool is
 * composed there, never inside the verbs.
 */
export {
  createStdioToolExecutor,
  discoveredToolDefinitions,
  externalToolId,
} from './client/executor.js';
export {
  DEFAULT_REQUEST_DEADLINE_MS,
  MCP_PROTOCOL_VERSION,
  spawnStdioMcpClient,
} from './client/stdio-client.js';
export type {
  DiscoveredMcpTool,
  McpClient,
  StdioMcpClientOptions,
  StdioServerSpec,
} from './client/stdio-client.js';
