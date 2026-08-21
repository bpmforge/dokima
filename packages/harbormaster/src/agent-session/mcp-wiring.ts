/**
 * Wires the closed tool set (`tools.ts`) into `packages/mcp` (W6-04) —
 * SC-18's explicit instruction to reuse the existing allowlist/approval/
 * audit mechanism rather than build a parallel one. `ensureAgentSessionToolsRegistered`
 * is idempotent: every `createGatewaySpawnSession` call runs it, and every
 * ticket in a claim/land loop shares the SAME `EventLog`, so registration
 * must tolerate being asked for repeatedly without re-appending events or
 * throwing `SERVER_ALREADY_REGISTERED`.
 *
 * None of the seven tools ever needs human approval (`requiresApproval:
 * false` — they are the closed, pre-vetted set itself, not an ambient
 * shell capability), so `decideToolCall` has no reachable caller here.
 */

import { randomUUID } from 'node:crypto';
import type { EventLog } from '@dokima/events';
import {
  getServer,
  listToolsForRole,
  McpError,
  registerServer,
  requestToolCall,
  setRoleAllowlist,
  type McpRole,
} from '@dokima/mcp';
import type { ToolCall } from './gateway-tool-types.js';
import { runExternalToolCall, type ExternalToolset } from './external-tools.js';
import {
  createAgentSessionToolExecutor,
  type AgentSessionToolContext,
} from './tool-executor.js';
import { AGENT_SESSION_TOOL_NAMES } from './tools.js';

export const AGENT_SESSION_SERVER_ID = 'agent-session';

export function agentSessionToolId(name: string): string {
  return `${AGENT_SESSION_SERVER_ID}.${name}`;
}

export interface EnsureRegisteredOptions {
  readonly role: McpRole;
  readonly actorId: string;
}

/** Registers the server + tool catalog once, and (re)sets the role's allowlist only when it doesn't already match exactly (SC-18: closed, not "closed plus whatever accumulated"). */
export function ensureAgentSessionToolsRegistered(
  log: EventLog,
  options: EnsureRegisteredOptions,
): void {
  if (!getServer(log, AGENT_SESSION_SERVER_ID)) {
    registerServer(log, {
      id: AGENT_SESSION_SERVER_ID,
      name: 'Dokima agent-session tools',
      transport: 'stdio',
      tools: AGENT_SESSION_TOOL_NAMES.map((name) => ({
        id: agentSessionToolId(name),
        name,
        requiresApproval: false,
      })),
      actorId: options.actorId,
    });
  }

  const wanted = AGENT_SESSION_TOOL_NAMES.map(agentSessionToolId);
  const allowed = new Set(listToolsForRole(log, options.role).map((tool) => tool.id));
  /**
   * W14-03 amendment to the exact-set rule: "closed, not closed plus
   * whatever accumulated" governs the AGENT-SESSION namespace only.
   * External MCP tool grants (FR-I3, ids `<serverId>.<tool>`) are a
   * person's explicit allowlist decisions and survive the reset — wiping
   * them here would silently revoke a granted tool on every session start.
   */
  const externalGrants = [...allowed].filter(
    (id) => !id.startsWith(`${AGENT_SESSION_SERVER_ID}.`),
  );
  const builtInsExact = wanted.every((id) => allowed.has(id)) &&
    allowed.size === wanted.length + externalGrants.length;
  if (!builtInsExact) {
    setRoleAllowlist(log, {
      role: options.role,
      toolIds: [...wanted, ...externalGrants],
      actorId: options.actorId,
    });
  }
}

export interface RunToolCallsAudit {
  readonly log: EventLog;
  readonly role: McpRole;
  readonly actorId: string;
  readonly ticketId: string;
  readonly runId: string;
}

/** One tool-call outcome, shaped for feeding back to the model — never a thrown exception (a refusal or a validation error is data the model can act on, not a session crash). */
async function runOneToolCall(
  call: ToolCall,
  ctx: AgentSessionToolContext,
  audit: RunToolCallsAudit,
  external?: ExternalToolset,
): Promise<unknown> {
  // W14-03: an external tool id routes to the two-phase approval protocol
  // (external-tools.ts); the closed set below is untouched.
  if (external?.toolIds.has(call.name)) {
    try {
      return await runExternalToolCall(call, audit, external);
    } catch (err) {
      if (err instanceof McpError) {
        return { ok: false, refusal: `${err.code}: ${err.message}` };
      }
      return { ok: false, refusal: err instanceof Error ? err.message : String(err) };
    }
  }
  const executor = createAgentSessionToolExecutor(ctx);
  try {
    const outcome = await requestToolCall(
      audit.log,
      {
        id: randomUUID(),
        toolId: agentSessionToolId(call.name),
        role: audit.role,
        actorId: audit.actorId,
        args: call.arguments,
        ticketId: audit.ticketId,
        runId: audit.runId,
      },
      executor,
    );
    if (outcome.status === 'pending') {
      // Unreachable for this closed tool set today (every tool's
      // `requiresApproval` is `false`) — kept for type-completeness, not
      // because it fires (SC-18: "the model chooses tool CALLS; it never
      // chooses the tool SET").
      return {
        ok: false,
        refusal: 'awaiting approval (unexpected for this closed tool set)',
      };
    }
    return outcome.result;
  } catch (err) {
    if (err instanceof McpError) {
      return { ok: false, refusal: `${err.code}: ${err.message}` };
    }
    return { ok: false, refusal: err instanceof Error ? err.message : String(err) };
  }
}

/** Runs every tool call passed in and renders each outcome as a `TOOL_RESULT` line, newline-joined. `gateway-session.ts` calls this once per tool call (`runToolCalls([call], ...)`) and pushes the single-line result back as its own `tool`-role message carrying that call's `toolCallId`. */
export async function runToolCalls(
  toolCalls: readonly ToolCall[],
  ctx: AgentSessionToolContext,
  audit: RunToolCallsAudit,
  external?: ExternalToolset,
): Promise<string> {
  const parts: string[] = [];
  for (const call of toolCalls) {
    const outcome = await runOneToolCall(call, ctx, audit, external);
    parts.push(`TOOL_RESULT ${call.id} (${call.name}): ${JSON.stringify(outcome)}`);
  }
  return parts.join('\n');
}
