/**
 * The work, ON the tool-approval card (W14-04, the W13-61 standard): which
 * server, which tool, and the exact requested arguments — never a bare
 * "a tool wants to run". The body is the pending approval's own evidence,
 * written by the run that parked it (mcp-approvals.ts, apps/server).
 */

export interface McpApprovalBody {
  readonly serverId?: string;
  readonly toolId?: string;
  readonly args?: unknown;
  readonly argsDigest?: string;
  readonly requestedBy?: string;
  readonly ticketId?: string | null;
}

export function McpApprovalEvidence({ body }: { body: McpApprovalBody | null }) {
  if (!body || typeof body !== 'object') {
    return (
      <p className="notification-card__evidence" data-testid="mcp-approval-evidence">
        The request's details did not load — decide from the project's run
        ledger, or leave the card until they do.
      </p>
    );
  }
  return (
    <div className="notification-card__evidence" data-testid="mcp-approval-evidence">
      <p>
        <strong>{body.toolId ?? 'unknown tool'}</strong> on server{' '}
        <strong>{body.serverId ?? 'unknown'}</strong>
        {body.ticketId ? <> · while working ticket {body.ticketId}</> : null}
        {body.requestedBy ? <> · asked for by {body.requestedBy}</> : null}
      </p>
      <pre className="notification-card__evidence-args" data-testid="mcp-approval-args">
        {JSON.stringify(body.args ?? null, null, 2)}
      </pre>
      {body.argsDigest && (
        <p className="notification-card__evidence-digest">
          request fingerprint <code>{body.argsDigest.slice(0, 16)}</code> — approval
          covers exactly these arguments, nothing else
        </p>
      )}
    </div>
  );
}
