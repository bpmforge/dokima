/**
 * The bridge between MCP pending approvals and the morning queue (W14-03,
 * FR-I3 "requiresApproval tool call parks an approval card"). Approvals
 * live in `packages/mcp`'s event-log state; cards live in the notification
 * store; a HUMAN's verdict on the card is what lets the session's next
 * pass execute (external-tools.ts). This module owns both directions:
 *
 *   sync:     every pending approval gets exactly one Decide card,
 *             idempotently — called at run start (cards for approvals a
 *             previous run parked) and run end (cards for this run's).
 *   verdict:  the card's recorded decision, read back for the session.
 *             C-4 holds mechanically: `decidedBy` is the notification
 *             decider's actorId from the `notification.decided` event, an
 *             identity the session actor cannot forge from inside.
 */

import { listEvents, type EventLog } from '@dokima/events';
import { loadMcpState } from '@dokima/mcp';
import { emitNotification } from './emit.js';

export function notificationIdForApproval(approvalId: string): string {
  return `mcp-approval-${approvalId}`;
}

/** One Decide card per pending approval; already-carded ids are left alone. Returns the ids of newly emitted cards. */
export function syncMcpApprovalNotifications(
  log: EventLog,
  actorId: string,
): string[] {
  const state = loadMcpState(log);
  const emitted: string[] = [];
  const exists = log.db.prepare<[string], { id: string }>(
    'SELECT id FROM notifications WHERE id = ?',
  );
  for (const [, approval] of state.pendingApprovals) {
    if (approval.status !== 'pending') continue;
    const id = notificationIdForApproval(approval.id);
    if (exists.get(id)) continue;
    emitNotification(log, {
      id,
      tier: 'decide',
      kind: 'approval',
      refType: 'mcp_tool_call',
      refId: approval.id,
      title: `Tool approval: ${approval.toolId}`,
      // `approval.args` is read back from the event log, so already
      // redacted (Law 8 backstop noted on PendingApproval itself).
      body: {
        serverId: approval.serverId,
        toolId: approval.toolId,
        args: approval.args,
        argsDigest: approval.argsDigest,
        requestedBy: approval.requestedBy,
        ticketId: approval.ticketId,
        runId: approval.runId,
      },
      actorId,
    });
    emitted.push(id);
  }
  return emitted;
}

export interface McpApprovalVerdict {
  readonly decision: 'approved' | 'denied';
  readonly decidedBy: string;
}

/**
 * The morning queue's verdict for one approval, or undefined while the
 * card is still open. Read from the `notification.decided` event rather
 * than the row: the event carries WHO decided (actorId), and the ledger
 * is the trust boundary (Law 4) — a row update alone proves nothing.
 */
export function mcpApprovalDecision(
  log: EventLog,
  approvalId: string,
): McpApprovalVerdict | undefined {
  const id = notificationIdForApproval(approvalId);
  for (const event of listEvents(log)) {
    if (event.eventType !== 'notification.decided') continue;
    const payload = event.payload as { id?: unknown; decision?: unknown };
    if (payload?.id !== id) continue;
    if (payload.decision === 'approved') {
      return { decision: 'approved', decidedBy: event.actorId };
    }
    if (payload.decision === 'rejected') {
      return { decision: 'denied', decidedBy: event.actorId };
    }
  }
  return undefined;
}
