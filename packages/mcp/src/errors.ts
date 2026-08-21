export type McpErrorCode =
  | 'SERVER_NOT_FOUND'
  | 'SERVER_ALREADY_REGISTERED'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_ID_COLLISION'
  | 'TOOL_NOT_ALLOWED'
  | 'CALL_ID_COLLISION'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_NOT_PENDING'
  | 'SELF_APPROVAL'
  | 'EXECUTOR_REQUIRED'
  | 'SERVER_TIMEOUT'
  | 'SERVER_FAILED'
  | 'TOOL_CALL_FAILED';

/** Refusals are reasoned, never a bare throw (mirrors `@dokima/tickets`' `TicketError`, FR-T4). */
export class McpError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = 'McpError';
    this.code = code;
  }
}
