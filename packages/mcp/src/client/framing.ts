/**
 * Newline-delimited JSON-RPC framing for MCP stdio transport (W14-01).
 *
 * The MCP stdio transport frames each JSON-RPC message as one line of JSON
 * terminated by a newline, with no embedded newlines. This module owns ONLY
 * the byte discipline — turning a message into a frame and a chunk stream
 * back into messages — so `stdio-client.ts` never touches Buffer splitting
 * and the framing is testable without a child process.
 *
 * A line that fails to parse is surfaced to the caller rather than dropped:
 * a server emitting garbage on stdout is a fact the operator needs, and
 * silently skipping it turns a broken server into a hung request (the
 * W13-41 lesson: the reason must survive to where a person reads it).
 */

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

export function encodeFrame(
  message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse,
): string {
  return `${JSON.stringify(message)}\n`;
}

export interface LineDecoderHandlers {
  readonly onMessage: (message: JsonRpcResponse) => void;
  readonly onGarbage: (line: string) => void;
}

/**
 * Incremental decoder: feed raw chunks, get parsed messages. Carries the
 * partial tail between chunks — stdio gives no guarantee a frame arrives
 * whole, and the first bug a naive splitter meets is a message cut mid-JSON.
 */
export function createLineDecoder(handlers: LineDecoderHandlers): {
  feed: (chunk: string) => void;
} {
  let tail = '';
  return {
    feed(chunk: string) {
      tail += chunk;
      let newline = tail.indexOf('\n');
      while (newline !== -1) {
        const line = tail.slice(0, newline).trim();
        tail = tail.slice(newline + 1);
        if (line.length > 0) {
          try {
            handlers.onMessage(JSON.parse(line) as JsonRpcResponse);
          } catch {
            handlers.onGarbage(line);
          }
        }
        newline = tail.indexOf('\n');
      }
    },
  };
}
