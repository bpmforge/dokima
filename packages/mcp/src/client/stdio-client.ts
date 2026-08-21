/**
 * The stdio MCP client (W14-01) — the injectable transport this package was
 * built around and never had. `tool-call.ts` kept transport out on purpose
 * ("injected instead, so tests run against a fake, no-network executor");
 * this module is the real thing the caller injects: spawn -> initialize ->
 * tools/list -> tools/call over newline-delimited JSON-RPC on the child's
 * stdio. No HTTP/SSE here — stdio is the transport a local-first install
 * actually uses (Law 9b: a local-only user gets the whole feature).
 *
 * EVERY await carries a deadline (the W13-47 lesson: this repo shipped
 * three separate tickets because something waited forever on a child).
 * A breach kills the process group and rejects with the server's id in the
 * message — the operator's first question is "which one?".
 *
 * Secrets: `env` values arrive ALREADY RESOLVED by the caller's keychain
 * resolver (Law 8) — this module never sees a credential ref, never logs
 * env, and never includes env in any error message.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { McpError } from '../errors.js';
import {
  createLineDecoder,
  encodeFrame,
  type JsonRpcResponse,
} from './framing.js';

/** How a server is started. Mirrors McpServerDefinition's stdio half; url-based transports are a different client. */
export interface StdioServerSpec {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

export interface StdioMcpClientOptions {
  /** Per-request deadline. Sized generously: a healthy local server answers in ms; 10s is for first-spawn cold starts. */
  readonly requestDeadlineMs?: number;
}

export interface DiscoveredMcpTool {
  readonly name: string;
  readonly description: string | null;
}

export interface McpClient {
  readonly serverId: string;
  initialize(): Promise<void>;
  listTools(): Promise<readonly DiscoveredMcpTool[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  /** Idempotent. Kills the process group — a server that ignores stdin closing must still die. */
  dispose(): void;
}

export const DEFAULT_REQUEST_DEADLINE_MS = 10_000;

/** The protocol revision this client offers; the handshake accepts whatever the server answers with (lenient on purpose — the fixture defines our contract, not a spec badge). */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

const STDERR_TAIL_LIMIT = 500;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export function spawnStdioMcpClient(
  spec: StdioServerSpec,
  options: StdioMcpClientOptions = {},
): McpClient {
  const deadlineMs = options.requestDeadlineMs ?? DEFAULT_REQUEST_DEADLINE_MS;
  const child: ChildProcess = spawn(spec.command, [...spec.args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // Its own process group, so dispose can kill grandchildren too — the
    // same discipline as harbormaster's watchdog-process.
    detached: true,
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
  });

  let nextId = 1;
  let disposed = false;
  let stderrTail = '';
  const pending = new Map<number, PendingRequest>();

  const failAll = (err: Error) => {
    for (const [, request] of pending) {
      clearTimeout(request.timer);
      request.reject(err);
    }
    pending.clear();
  };

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
  });

  child.on('error', (err) => {
    failAll(
      new McpError(
        'SERVER_FAILED',
        `MCP server ${spec.id} failed to start (${spec.command}): ${err.message}`,
      ),
    );
  });

  child.on('exit', (code) => {
    if (pending.size === 0) return;
    const detail = stderrTail.trim();
    failAll(
      new McpError(
        'SERVER_FAILED',
        `MCP server ${spec.id} exited (code ${String(code)}) with requests in flight` +
          (detail ? ` — its last words: ${detail}` : ''),
      ),
    );
  });

  const decoder = createLineDecoder({
    onMessage(message: JsonRpcResponse) {
      if (typeof message.id !== 'number') return; // server notification — nothing awaits it
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        // The server's OWN message survives verbatim (the W13-41 lesson:
        // never reduce a reason to an exit code).
        request.reject(
          new McpError(
            request.method === 'initialize' ? 'SERVER_FAILED' : 'TOOL_CALL_FAILED',
            `MCP server ${spec.id} refused ${request.method}: ${message.error.message}`,
          ),
        );
        return;
      }
      request.resolve(message.result);
    },
    onGarbage(line: string) {
      stderrTail = (stderrTail + `[non-JSON stdout] ${line}`).slice(-STDERR_TAIL_LIMIT);
    },
  });
  child.stdout?.on('data', (chunk: Buffer) => decoder.feed(chunk.toString()));

  const killGroup = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  };

  const request = (method: string, params?: unknown): Promise<unknown> => {
    if (disposed) {
      return Promise.reject(
        new McpError('SERVER_FAILED', `MCP server ${spec.id} client is disposed`),
      );
    }
    const id = nextId;
    nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        killGroup();
        reject(
          new McpError(
            'SERVER_TIMEOUT',
            `MCP server ${spec.id} did not answer ${method} within ${deadlineMs}ms — ` +
              `killed. A server that cannot initialize is a server the run proceeds without.`,
          ),
        );
      }, deadlineMs);
      pending.set(id, { resolve, reject, timer, method });
      child.stdin?.write(encodeFrame({ jsonrpc: '2.0', id, method, params }));
    });
  };

  const notify = (method: string, params?: unknown): void => {
    child.stdin?.write(encodeFrame({ jsonrpc: '2.0', method, params }));
  };

  return {
    serverId: spec.id,
    async initialize() {
      await request('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'dokima', version: '0' },
      });
      notify('notifications/initialized');
    },
    async listTools() {
      const result = (await request('tools/list', {})) as {
        tools?: readonly { name?: unknown; description?: unknown }[];
      };
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      return tools
        .filter((t) => typeof t.name === 'string' && t.name.length > 0)
        .map((t) => ({
          name: t.name as string,
          description: typeof t.description === 'string' ? t.description : null,
        }));
    },
    async callTool(name: string, args: unknown) {
      const result = (await request('tools/call', { name, arguments: args })) as {
        isError?: unknown;
        content?: readonly { type?: unknown; text?: unknown }[];
      };
      if (result?.isError === true) {
        const text = (Array.isArray(result.content) ? result.content : [])
          .map((c) => (typeof c.text === 'string' ? c.text : ''))
          .join(' ')
          .trim();
        throw new McpError(
          'TOOL_CALL_FAILED',
          `MCP tool ${name} on ${spec.id} reported an error` + (text ? `: ${text}` : ''),
        );
      }
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      failAll(new McpError('SERVER_FAILED', `MCP server ${spec.id} client disposed`));
      killGroup();
    },
  };
}
