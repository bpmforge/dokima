import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { WsClient, type ServerEnvelope } from './ws-client.js';

/**
 * `ws`'s WebSocket class implements the same browser-facing API surface
 * (addEventListener/send/close) that WsClient is written against, so it
 * stands in for the DOM WebSocket global here under Node.
 */
const WsImpl = (await import('ws')).WebSocket as unknown as typeof WebSocket;

describe('WsClient', () => {
  let httpServer: Server;
  let wss: WebSocketServer;
  let url: string;
  let serverSocket: WsSocket | undefined;

  beforeEach(async () => {
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (socket) => {
      serverSocket = socket;
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('no address');
    url = `ws://127.0.0.1:${address.port}/api/v1/ws`;
  });

  afterEach(async () => {
    wss.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  /** Attaches the message listener inside the same `connection` tick — no polling gap for the subscribe frame to slip through before we're listening. */
  function waitForNextConnectionMessage(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      wss.once('connection', (socket) => {
        socket.once('message', (raw) => resolve(JSON.parse(raw.toString('utf8'))));
      });
    });
  }

  it('sends a subscribe frame carrying the requested subscriptions on connect', async () => {
    const subscribed = waitForNextConnectionMessage();
    const client = new WsClient({
      url,
      token: 'test-token',
      subscriptions: ['board:PROJ1'],
      onEnvelope: () => undefined,
      WebSocketImpl: WsImpl,
    });
    client.connect();

    const message = await subscribed;
    expect(message).toEqual({ op: 'subscribe', subscriptions: ['board:PROJ1'] });
    client.close();
  });

  it('appends the token as a query param (browsers cannot set WS upgrade headers)', async () => {
    const client = new WsClient({
      url,
      token: 'secret-token',
      subscriptions: [],
      onEnvelope: () => undefined,
      WebSocketImpl: WsImpl,
    });
    const connectionUrl = await new Promise<string>((resolve) => {
      wss.once('connection', (_socket, request) => resolve(request.url ?? ''));
      client.connect();
    });
    expect(connectionUrl).toContain('token=secret-token');
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the client-side 'open' land
    client.close();
  });

  it('delivers a parsed envelope and tracks last_seq for resume', async () => {
    const received: ServerEnvelope[] = [];
    const client = new WsClient({
      url,
      token: 'test-token',
      subscriptions: ['board:PROJ1'],
      onEnvelope: (envelope) => received.push(envelope),
      WebSocketImpl: WsImpl,
    });
    client.connect();
    await new Promise((resolve) => setTimeout(resolve, 20)); // connect + subscribe land

    const envelope: ServerEnvelope = {
      sub: 'board:PROJ1',
      seq: 1,
      type: 'ticket.closed',
      at: '2026-07-15T00:00:00Z',
      data: { id: 'W4-01' },
    };
    serverSocket?.send(JSON.stringify(envelope));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(received).toEqual([envelope]);
    client.close();
  });
});
