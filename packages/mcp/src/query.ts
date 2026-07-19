import { listEvents, rebuildProjection, type EventLog } from '@shipwright/events';
import { mcpProjection } from './reducer.js';
import type {
  McpRole,
  McpServerDefinition,
  McpState,
  McpToolDefinition,
  PendingApproval,
  ToolCallRecord,
} from './types.js';

/** Rebuild-from-zero (DATABASE.md §3): the MCP host's state is a disposable projection, never its own SQL table. */
export function loadMcpState(log: EventLog): McpState {
  return rebuildProjection(listEvents(log), mcpProjection);
}

export function getServer(
  log: EventLog,
  serverId: string,
): McpServerDefinition | undefined {
  return loadMcpState(log).servers.get(serverId);
}

export function listServers(log: EventLog): McpServerDefinition[] {
  return Array.from(loadMcpState(log).servers.values());
}

export function getTool(log: EventLog, toolId: string): McpToolDefinition | undefined {
  return loadMcpState(log).tools.get(toolId);
}

export function listTools(log: EventLog): McpToolDefinition[] {
  return Array.from(loadMcpState(log).tools.values());
}

/** US-503 AC-1: "Role without allowlist entry cannot see the tool" — an absent or empty allowlist means an empty list, never "everything visible by default." */
export function listToolsForRole(log: EventLog, role: McpRole): McpToolDefinition[] {
  const state = loadMcpState(log);
  const allowed = state.allowlist.get(role);
  if (!allowed || allowed.size === 0) return [];
  return Array.from(state.tools.values()).filter((tool) => allowed.has(tool.id));
}

export function getPendingApproval(
  log: EventLog,
  id: string,
): PendingApproval | undefined {
  return loadMcpState(log).pendingApprovals.get(id);
}

/** Open approval cards only (`status === 'pending'`) — decided cards stay in state for audit lookup via `getPendingApproval` but drop off the queue. */
export function listPendingApprovals(log: EventLog): PendingApproval[] {
  return Array.from(loadMcpState(log).pendingApprovals.values()).filter(
    (approval) => approval.status === 'pending',
  );
}

/** The full audited call log (US-503 AC-3: "tool-call events replayable from the log"), oldest first. */
export function listToolCalls(log: EventLog): readonly ToolCallRecord[] {
  return loadMcpState(log).callLog;
}
