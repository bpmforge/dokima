/**
 * External MCP tools in an agent session (W14-03, FR-I3). The closed seven
 * (`tools.ts`) stay exactly as they are; everything here is ADDITIVE and
 * allowlist-gated: a role without an entry never sees an external tool's
 * schema, so the model cannot even ask for it.
 *
 * THE APPROVAL LOOP IS TWO-PHASE BY DESIGN. An external tool defaults to
 * requiresApproval, and the human who approves is reading the morning
 * queue hours after the session that asked has ended. So:
 *
 *   pass N:   the model calls the tool -> `requestToolCall` parks a
 *             PendingApproval -> the model receives a structured
 *             awaiting-approval result and keeps its turn discipline
 *             (never blocking a queue slot on a human — the W13-42 lesson).
 *   (a person decides the Decide card in the morning queue.)
 *   pass N+1: the model calls the tool again with the same arguments ->
 *             the pending approval + the human's recorded decision meet ->
 *             `decideToolCall` executes through the run's live executor
 *             with the HUMAN as `decidedBy` (C-4: approver identity is the
 *             queue decider, mechanically distinct from the session actor)
 *             — or returns the refusal if they declined.
 *
 * The decision lookup is INJECTED (`approvalDecision`): decisions live in
 * apps/server's notification store, which harbormaster may not import
 * (ARCHITECTURE §4) — the same seam as `memoryAnchor` (W13-23).
 */

import {
  decideToolCall,
  digestOf,
  loadMcpState,
  requestToolCall,
  type PendingApproval,
  type ToolExecutor,
} from '@dokima/mcp';
import type { EventLog } from '@dokima/events';
import type { ToolCall, ToolSchema } from './gateway-tool-types.js';
import type { RunToolCallsAudit } from './mcp-wiring.js';

export interface ExternalApprovalDecision {
  readonly decision: 'approved' | 'denied';
  readonly decidedBy: string;
}

export interface ExternalToolset {
  /** Schemas offered to the model this session — already allowlist-filtered by the composer. */
  readonly schemas: readonly ToolSchema[];
  /** Full namespaced ids (`<serverId>.<tool>`) the schemas cover. */
  readonly toolIds: ReadonlySet<string>;
  readonly executor: ToolExecutor;
  /** The morning queue's recorded verdict for a parked approval, if a person has decided it. */
  readonly approvalDecision: (
    approvalId: string,
  ) => ExternalApprovalDecision | undefined;
}

function findPending(
  log: EventLog,
  toolId: string,
  argsDigest: string,
): PendingApproval | undefined {
  for (const [, approval] of loadMcpState(log).pendingApprovals) {
    if (
      approval.toolId === toolId &&
      approval.argsDigest === argsDigest &&
      approval.status === 'pending'
    ) {
      return approval;
    }
  }
  return undefined;
}

function awaitingResult(approvalId: string): unknown {
  return {
    ok: false,
    awaitingApproval: true,
    approvalId,
    note:
      'This tool call needs a person: it is now a card in the morning queue. ' +
      'Nothing ran. Continue with other work; once the card is approved, ' +
      'calling this tool again with the SAME arguments runs it.',
  };
}

/**
 * One external tool call, resolved against the two-phase protocol above.
 * Returns model-feedable data, never throws — the same contract as
 * `runOneToolCall` (a refusal is something the model can act on).
 */
export async function runExternalToolCall(
  call: ToolCall,
  audit: RunToolCallsAudit,
  toolset: ExternalToolset,
): Promise<unknown> {
  const argsDigest = digestOf(call.arguments);
  const pending = findPending(audit.log, call.name, argsDigest);

  if (pending) {
    const verdict = toolset.approvalDecision(pending.id);
    if (!verdict) return awaitingResult(pending.id);
    const outcome = await decideToolCall(
      audit.log,
      { id: pending.id, decision: verdict.decision, decidedBy: verdict.decidedBy },
      toolset.executor,
    );
    if (outcome.status === 'denied') {
      return {
        ok: false,
        refusal:
          `a person declined this tool call in the morning queue ` +
          `(decided by ${verdict.decidedBy})`,
      };
    }
    return outcome.result;
  }

  const outcome = await requestToolCall(
    audit.log,
    {
      id: `${audit.runId}-${argsDigest.slice(0, 12)}-${call.id}`,
      toolId: call.name,
      role: audit.role,
      actorId: audit.actorId,
      args: call.arguments,
      ticketId: audit.ticketId,
      runId: audit.runId,
    },
    toolset.executor,
  );
  if (outcome.status === 'pending') return awaitingResult(outcome.approval.id);
  return outcome.result;
}
