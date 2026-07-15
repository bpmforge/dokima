/**
 * Minimal RFC 6455 server socket: wraps the raw `net.Socket` handed to the
 * process's `'upgrade'` event as an EventEmitter shaped like the `ws`
 * package's WebSocket (`'message'`/`'pong'`/`'close'`, `.send`/`.ping`/
 * `.terminate`/`.readyState`/`.OPEN`) so `ws-hub.ts`'s hub logic doesn't
 * need to know it isn't the real `ws` package — kept out of
 * `apps/server/package.json` since that file is outside this ticket's
 * write_scope (only `apps/server/src/api/**` is).
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  encodeFrame,
  FrameDecoder,
  OPCODE,
  WsProtocolError,
  type Opcode,
} from './ws-frame.js';

const WS_HANDSHAKE_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function computeAcceptKey(clientKey: string): string {
  return createHash('sha1')
    .update(clientKey + WS_HANDSHAKE_MAGIC)
    .digest('base64');
}

export const READY_STATE = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } as const;

export class ServerWebSocket extends EventEmitter {
  readonly OPEN = READY_STATE.OPEN;
  private readonly socket: Duplex;
  private readonly decoder = new FrameDecoder();
  private state: number = READY_STATE.OPEN;

  constructor(socket: Duplex) {
    super();
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.onSocketClosed());
    socket.on('error', () => this.onSocketClosed());
  }

  get readyState(): number {
    return this.state;
  }

  send(data: string): void {
    if (this.state !== READY_STATE.OPEN) return;
    this.writeFrame(OPCODE.TEXT, Buffer.from(data, 'utf8'));
  }

  ping(): void {
    if (this.state !== READY_STATE.OPEN) return;
    this.writeFrame(OPCODE.PING, Buffer.alloc(0));
  }

  terminate(): void {
    if (this.state === READY_STATE.CLOSED) return;
    this.state = READY_STATE.CLOSED;
    this.socket.destroy();
    this.emit('close');
  }

  private onData(chunk: Buffer): void {
    if (this.state !== READY_STATE.OPEN) return;
    let frames;
    try {
      frames = this.decoder.push(chunk);
    } catch (err) {
      if (err instanceof WsProtocolError) {
        this.terminate();
        return;
      }
      throw err;
    }
    for (const frame of frames) this.handleFrame(frame.opcode, frame.payload);
  }

  private handleFrame(opcode: Opcode, payload: Buffer): void {
    switch (opcode) {
      case OPCODE.TEXT:
        this.emit('message', payload);
        return;
      case OPCODE.PING:
        this.writeFrame(OPCODE.PONG, payload);
        return;
      case OPCODE.PONG:
        this.emit('pong');
        return;
      case OPCODE.CLOSE:
        this.writeFrame(OPCODE.CLOSE, Buffer.alloc(0));
        this.terminate();
        return;
      default:
        // BINARY/CONTINUATION: unsupported by this protocol — close, don't crash.
        this.terminate();
    }
  }

  private writeFrame(opcode: Opcode, payload: Buffer): void {
    if (this.socket.writable) this.socket.write(encodeFrame(opcode, payload));
  }

  private onSocketClosed(): void {
    if (this.state === READY_STATE.CLOSED) return;
    this.state = READY_STATE.CLOSED;
    this.emit('close');
  }
}

/** Completes the RFC 6455 handshake on the raw upgrade socket. Caller must
 * have already authorized the request — this only speaks the protocol. */
export function completeHandshake(
  req: IncomingMessage,
  socket: Duplex,
): ServerWebSocket | undefined {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return undefined;
  }
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${computeAcceptKey(key)}`,
      '',
      '',
    ].join('\r\n'),
  );
  return new ServerWebSocket(socket);
}

/** Rejects an upgrade attempt with a normal HTTP response before any
 * WebSocket framing begins (SC-08: evil Host/Origin ⇒ 403, missing token ⇒ 401). */
export function rejectUpgrade(
  socket: Duplex,
  status: number,
  statusText: string,
  body: Record<string, unknown>,
): void {
  const json = JSON.stringify(body);
  socket.write(
    [
      `HTTP/1.1 ${status} ${statusText}`,
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(json)}`,
      'Connection: close',
      '',
      json,
    ].join('\r\n'),
  );
  socket.end();
}
