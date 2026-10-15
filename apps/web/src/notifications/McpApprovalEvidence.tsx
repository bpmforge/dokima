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

const DESTRUCTIVE_TOOL = /(delete|remove|rmdir|unlink|drop|truncate|destroy|purge|wipe|erase|overwrite|reset|force[-_]?push|kill)/i;
const DESTRUCTIVE_ARGS = /"(recursive|force|rf)"\s*:\s*true|\brm\s+-[a-z]*[rf]|--force\b|--hard\b|\bdrop\s+(table|database)\b/i;

/**
 * Brad's review decision (2026-10-15): a tool call that can destroy work —
 * a delete, a recursive or forced flag, a hard reset — takes a second press
 * to approve. A heuristic on the tool's own name and its exact arguments; it
 * only ever adds a confirmation, never removes one, so a miss costs nothing
 * the single press did not already cost.
 */
export function isDestructiveToolCall(body: McpApprovalBody | null): boolean {
  if (!body || typeof body !== 'object') return false;
  if (body.toolId && DESTRUCTIVE_TOOL.test(body.toolId)) return true;
  let args = '';
  try {
    args = JSON.stringify(body.args ?? null);
  } catch {
    return false;
  }
  return DESTRUCTIVE_ARGS.test(args);
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
      {isDestructiveToolCall(body) && (
        <p className="notification-card__evidence-warning" data-testid="mcp-approval-destructive">
          This call can delete or overwrite work. Approving it takes a second press.
        </p>
      )}
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
