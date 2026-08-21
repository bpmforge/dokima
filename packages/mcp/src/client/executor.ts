/**
 * From a pool of live stdio clients to the ToolExecutor `requestToolCall`
 * demands (W14-01). Also owns the namespacing rule: an external tool's
 * registered id is `<serverId>.<name>`, the same shape harbormaster's
 * closed set uses (`agent-session.<tool>`), so an external server
 * advertising `read` or `verify` can never collide with the built-ins —
 * the collision surface is the server id, and `registerServer` already
 * refuses a duplicate of those.
 */

import type { McpToolDefinition } from '../types.js';
import type { ToolExecutor } from '../tool-call.js';
import { McpError } from '../errors.js';
import type { DiscoveredMcpTool, McpClient } from './stdio-client.js';

export function externalToolId(serverId: string, toolName: string): string {
  return `${serverId}.${toolName}`;
}

/**
 * Discovery output -> registry input. `requiresApproval: true` is the
 * DEFAULT for every external tool: this package cannot know which of a
 * stranger's tools are side-effectful, so the safe answer is "a person
 * approves until told otherwise" (SC-12); W14-03's settings surface is
 * where an owner relaxes it per tool.
 */
export function discoveredToolDefinitions(
  serverId: string,
  tools: readonly DiscoveredMcpTool[],
): McpToolDefinition[] {
  return tools.map((tool) => ({
    id: externalToolId(serverId, tool.name),
    serverId,
    name: tool.name,
    description: tool.description,
    requiresApproval: true,
  }));
}

/** Routes an allowlist-cleared call to the live client for its server. */
export function createStdioToolExecutor(
  clients: ReadonlyMap<string, McpClient>,
): ToolExecutor {
  return async ({ server, tool, args }) => {
    const client = clients.get(server.id);
    if (!client) {
      throw new McpError(
        'SERVER_NOT_FOUND',
        `MCP server ${server.id} is registered but has no live client in this run — ` +
          `it may have failed to start (the run's ledger says why).`,
      );
    }
    const result = await client.callTool(tool.name, args);
    return { result, cost: 0 };
  };
}
