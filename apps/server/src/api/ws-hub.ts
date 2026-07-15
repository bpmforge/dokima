/**
 * Projection subscription hub over WS (API_DESIGN §3). Broadcasts
 * append-only, per-subscription sequenced envelopes; a bounded per-sub
 * replay buffer backs `resume` (reconnect-with-last_seq); a ping/pong
 * heartbeat drops any peer that misses two consecutive beats.
 *
 * The server never depends on the stream for correctness (API_DESIGN §3:
 * every subscription has a REST read) — this hub is a delivery
 * optimization, not a source of truth.
 */

import type { WebSocket } from 'ws';

export interface ServerEnvelope {
  sub: string;
  seq: number;
  type: string;
  at: string;
  data: unknown;
}

interface ClientMessage {
  op: 'subscribe' | 'resume';
  subscriptions?: unknown;
  last_seq?: unknown;
}

interface Subscription {
  seq: number;
  buffer: ServerEnvelope[];
  sockets: Set<WebSocket>;
}

interface SocketState {
  subscriptions: Set<string>;
  missedHeartbeats: number;
}

export interface WsHubOptions {
  heartbeatIntervalMs?: number;
  maxMissedHeartbeats?: number;
  bufferSize?: number;
  now?: () => string;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_MAX_MISSED_HEARTBEATS = 2;
const DEFAULT_BUFFER_SIZE = 200;

export class WsHub {
  private readonly subs = new Map<string, Subscription>();
  private readonly sockets = new Map<WebSocket, SocketState>();
  private readonly heartbeatIntervalMs: number;
  private readonly maxMissedHeartbeats: number;
  private readonly bufferSize: number;
  private readonly now: () => string;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(opts: WsHubOptions = {}) {
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.maxMissedHeartbeats = opts.maxMissedHeartbeats ?? DEFAULT_MAX_MISSED_HEARTBEATS;
    this.bufferSize = opts.bufferSize ?? DEFAULT_BUFFER_SIZE;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /** healthz's "WS hub up" check (API_DESIGN §2). */
  get isUp(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.heartbeatTimer = setInterval(() => this.beat(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  close(): void {
    this.running = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    for (const socket of this.sockets.keys()) socket.terminate();
    this.sockets.clear();
    this.subs.clear();
  }

  handleConnection(socket: WebSocket): void {
    const state: SocketState = { subscriptions: new Set(), missedHeartbeats: 0 };
    this.sockets.set(socket, state);

    socket.on('message', (raw: Buffer) => this.handleMessage(socket, state, raw));
    socket.on('pong', () => {
      state.missedHeartbeats = 0;
    });
    socket.on('close', () => this.cleanup(socket, state));
  }

  /** Appends + broadcasts a projection delta; returns the minted envelope. */
  publish(sub: string, type: string, data: unknown): ServerEnvelope {
    const subscription = this.getOrCreateSub(sub);
    subscription.seq += 1;
    const envelope: ServerEnvelope = {
      sub,
      seq: subscription.seq,
      type,
      at: this.now(),
      data,
    };
    subscription.buffer.push(envelope);
    if (subscription.buffer.length > this.bufferSize) subscription.buffer.shift();
    for (const socket of subscription.sockets) this.send(socket, envelope);
    return envelope;
  }

  private handleMessage(socket: WebSocket, state: SocketState, raw: Buffer): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString('utf8')) as ClientMessage;
    } catch {
      return; // malformed frame — ignored, never crashes the connection
    }

    if (message.op === 'subscribe' && Array.isArray(message.subscriptions)) {
      for (const name of message.subscriptions) {
        if (typeof name !== 'string') continue;
        state.subscriptions.add(name);
        this.getOrCreateSub(name).sockets.add(socket);
      }
      return;
    }

    if (message.op === 'resume' && typeof message.last_seq === 'number') {
      const lastSeq = message.last_seq;
      for (const name of state.subscriptions) {
        const subscription = this.subs.get(name);
        if (!subscription) continue;
        for (const envelope of subscription.buffer) {
          if (envelope.seq > lastSeq) this.send(socket, envelope);
        }
      }
    }
  }

  private beat(): void {
    for (const [socket, state] of this.sockets) {
      if (state.missedHeartbeats >= this.maxMissedHeartbeats) {
        socket.terminate();
        continue;
      }
      state.missedHeartbeats += 1;
      socket.ping();
    }
  }

  private send(socket: WebSocket, envelope: ServerEnvelope): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(envelope));
  }

  private getOrCreateSub(name: string): Subscription {
    let subscription = this.subs.get(name);
    if (!subscription) {
      subscription = { seq: 0, buffer: [], sockets: new Set() };
      this.subs.set(name, subscription);
    }
    return subscription;
  }

  private cleanup(socket: WebSocket, state: SocketState): void {
    for (const name of state.subscriptions) {
      this.subs.get(name)?.sockets.delete(socket);
    }
    this.sockets.delete(socket);
  }
}
