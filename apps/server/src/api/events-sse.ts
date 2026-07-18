/**
 * SSE fallback for the WS projection stream (API_DESIGN §3, TECH_STACK.md's
 * "WebSocket with SSE fallback" decision): `GET /api/v1/events?
 * subscriptions=a,b&last_seq=N` emits the exact same envelope shape as the
 * WS hub (`{sub, seq, type, at, data}`) over `text/event-stream`.
 *
 * Reuses `WsHub`'s subscribe/resume/heartbeat/cleanup logic unmodified
 * (`ws-hub.ts` is outside this ticket's write_scope — only
 * `apps/server/src/api/events-sse*` is) by presenting a `HubSocket`-shaped
 * `EventEmitter` adapter over the raw HTTP response: the hub only ever
 * calls `.send()`/`.ping()`/`.terminate()`/`.readyState` and listens for
 * `'message'`/`'pong'`/`'close'`, none of which are WS-protocol-specific,
 * so one adapter class satisfies the interface without a real WebSocket
 * underneath. `subscribe`/`resume` are normally client→server WS frames;
 * here they're synthesized once from the query string right after
 * `wsHub.handleConnection()` registers the adapter, using the identical
 * `{op, subscriptions}` / `{op, last_seq}` JSON shape `WsHub.handleMessage`
 * already parses (API_DESIGN §3), so no duplicate parsing logic exists.
 *
 * Wired into `server.ts`'s `buildApiServer` (write_scope widened 2026-07-18
 * to include `server.ts` for exactly this registration). `registerEventsSseRoute`
 * is a plain `register*Route(app, opts)` function, the same shape as
 * `registerBoardRoutes`/`registerEstimateRoutes`.
 */

import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HubSocket, WsHub } from './ws-hub.js';

const READY_STATE_OPEN = 1;
const READY_STATE_CLOSED = 3;

/** Presents a hijacked Fastify reply as a `HubSocket` so `WsHub` can treat an SSE connection exactly like a WS one. */
class SseSocket extends EventEmitter implements HubSocket {
  readonly OPEN = READY_STATE_OPEN;
  private state: number = READY_STATE_OPEN;

  constructor(private readonly reply: FastifyReply) {
    super();
  }

  get readyState(): number {
    return this.state;
  }

  send(data: string): void {
    if (this.state !== READY_STATE_OPEN) return;
    this.reply.raw.write(`data: ${data}\n\n`);
  }

  /** SSE is unidirectional — there is no real pong frame, so a heartbeat
   * write immediately self-satisfies `WsHub`'s missed-heartbeat bookkeeping
   * (which only resets on a `'pong'` event) rather than ever disconnecting
   * an idle-but-healthy SSE client. */
  ping(): void {
    if (this.state !== READY_STATE_OPEN) return;
    this.reply.raw.write(': heartbeat\n\n');
    this.emit('pong');
  }

  terminate(): void {
    if (this.state === READY_STATE_CLOSED) return;
    this.state = READY_STATE_CLOSED;
    if (!this.reply.raw.writableEnded) this.reply.raw.end();
    this.emit('close');
  }
}

function parseSubscriptions(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseLastSeq(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface EventsSseRouteOptions {
  wsHub: WsHub;
}

/** `GET /api/v1/events` (API_DESIGN §3 SSE fallback; TECH_STACK.md WS/SSE decision). */
export function registerEventsSseRoute(
  app: FastifyInstance,
  opts: EventsSseRouteOptions,
): void {
  app.get('/api/v1/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, unknown>;
    const subscriptions = parseSubscriptions(query.subscriptions);
    const lastSeq = parseLastSeq(query.last_seq);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Node buffers headers until the first write — without this, a client
    // gets nothing until the ~15s heartbeat fires (verified empirically: no
    // subscriber traffic means no bytes at all otherwise).
    reply.raw.write(': connected\n\n');

    const socket = new SseSocket(reply);
    opts.wsHub.handleConnection(socket);
    if (subscriptions.length > 0) {
      socket.emit(
        'message',
        Buffer.from(JSON.stringify({ op: 'subscribe', subscriptions })),
      );
    }
    if (lastSeq !== undefined) {
      socket.emit(
        'message',
        Buffer.from(JSON.stringify({ op: 'resume', last_seq: lastSeq })),
      );
    }

    request.raw.on('close', () => socket.terminate());
  });
}
