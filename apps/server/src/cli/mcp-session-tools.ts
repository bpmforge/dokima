/**
 * Composes the session's external toolset (W14-03) — in apps/server, which
 * is the only layer that holds all three pieces at once: the live client
 * pool from preload (this run), the role's allowlist grants (the event
 * log), and the morning queue's approval verdicts (the notification
 * store). harbormaster receives the finished `ExternalToolset` and never
 * learns where any of it came from — the W13-23 injection seam.
 *
 * Allowlist-gated by construction (FR-I3): only tools BOTH granted to the
 * role AND live in this run's pool get schemas. No grants — the default —
 * means the session offers exactly the closed seven, unchanged.
 */

import { listToolsForRole } from '@dokima/mcp';
import type { ExternalToolset } from '@dokima/harbormaster';
import type { EventLog } from '@dokima/events';
import { mcpApprovalDecision } from '../api/notifications/mcp-approvals.js';
import type { McpPreloadResult } from './mcp-preload.js';

const AGENT_SESSION_PREFIX = 'agent-session.';

export function composeExternalToolset(
  log: EventLog,
  role: string,
  preload: McpPreloadResult,
): ExternalToolset | undefined {
  if (preload.toolIds.length === 0) return undefined;
  const live = new Set(preload.toolIds);
  const granted = listToolsForRole(log, role).filter(
    (tool) => !tool.id.startsWith(AGENT_SESSION_PREFIX) && live.has(tool.id),
  );
  if (granted.length === 0) return undefined;
  return {
    schemas: granted.map((tool) => ({
      name: tool.id,
      description:
        tool.description ??
        `External MCP tool "${tool.name}" from server ${tool.serverId}.`,
      // MCP discovery does not hand back a JSON schema through this client
      // yet; an open object is honest — the SERVER validates its own args.
      parameters: { type: 'object', additionalProperties: true },
    })),
    toolIds: new Set(granted.map((tool) => tool.id)),
    executor: preload.executor,
    approvalDecision: (approvalId) => mcpApprovalDecision(log, approvalId),
  };
}
