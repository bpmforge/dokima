import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeHandshake } from './ws-socket.js';
import { WsHub, type HubSocket } from './ws-hub.js';

/**
 * A minimal HubSocket-shaped mock. A real socket auto-responds to ping
 * frames at the protocol layer (RFC 6455 §5.5.2/§5.5.3) — there is no way
 * to make a real client silently drop a ping, so the heartbeat-timeout test
 * drives the hub against this mock instead of a live socket.
 */
function createMockSocket() {
  const emitter = new EventEmitter();
  return {
    readyState: 1,
    OPEN: 1,
    ping: vi.fn(),
    terminate: vi.fn(),
    send: vi.fn(),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.onopen = () => resolve();
  });
}

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.onmessage = (event) => resolve(JSON.parse(String(event.data)));
  });
}

describe('WsHub', () => {
  let httpServer: Server;
  let hub: WsHub;
  let url: string;

  beforeEach(async () => {
    hub = new WsHub({ heartbeatIntervalMs: 20, maxMissedHeartbeats: 2 });
    hub.start();
    httpServer = createServer();
    httpServer.on('upgrade', (req, socket) => {
      const ws = completeHandshake(req, socket);
      if (ws) hub.handleConnection(ws);
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('no address');
    url = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    hub.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('reports up once started and down once closed', () => {
    expect(hub.isUp).toBe(true);
    hub.close();
    expect(hub.isUp).toBe(false);
  });

  it('delivers a publish to a subscribed socket', async () => {
    const client = new WebSocket(url);
    await waitForOpen(client);
    client.send(JSON.stringify({ op: 'subscribe', subscriptions: ['board:PROJ1'] }));
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the subscribe land

    const messagePromise = waitForMessage(client);
    hub.publish('board:PROJ1', 'ticket.closed', { id: 'W4-01' });
    const envelope = await messagePromise;

    expect(envelope).toMatchObject({
      sub: 'board:PROJ1',
      seq: 1,
      type: 'ticket.closed',
      data: { id: 'W4-01' },
    });
    expect(typeof envelope.at).toBe('string');
    client.close();
  });

  it('does not deliver to a socket that never subscribed', async () => {
    const client = new WebSocket(url);
    await waitForOpen(client);
    const onMessage = vi.fn();
    client.onmessage = onMessage;

    hub.publish('board:OTHER', 'ticket.closed', {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onMessage).not.toHaveBeenCalled();
    client.close();
  });

  it('replays buffered envelopes newer than last_seq on resume', async () => {
    hub.publish('board:PROJ1', 'ticket.claimed', { seq: 1 });
    hub.publish('board:PROJ1', 'ticket.closed', { seq: 2 });

    const client = new WebSocket(url);
    await waitForOpen(client);
    client.send(JSON.stringify({ op: 'subscribe', subscriptions: ['board:PROJ1'] }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const replayed = waitForMessage(client);
    client.send(JSON.stringify({ op: 'resume', last_seq: 1 }));
    const envelope = await replayed;

    expect(envelope).toMatchObject({ sub: 'board:PROJ1', seq: 2, type: 'ticket.closed' });
    client.close();
  });

  it('terminates a connection that misses two heartbeats and never pongs', async () => {
    const isolatedHub = new WsHub({ heartbeatIntervalMs: 10, maxMissedHeartbeats: 2 });
    isolatedHub.start();
    const mock = createMockSocket();
    isolatedHub.handleConnection(mock as unknown as HubSocket);

    await new Promise((resolve) => setTimeout(resolve, 45)); // >= 3 beats, no pong ever sent

    expect(mock.ping).toHaveBeenCalled();
    expect(mock.terminate).toHaveBeenCalled();
    isolatedHub.close();
  });

  it('resets the missed-heartbeat count on pong', async () => {
    const isolatedHub = new WsHub({ heartbeatIntervalMs: 10, maxMissedHeartbeats: 2 });
    isolatedHub.start();
    const mock = createMockSocket();
    isolatedHub.handleConnection(mock as unknown as HubSocket);

    await new Promise((resolve) => setTimeout(resolve, 12));
    mock.emit('pong'); // acks the first beat before the second fires
    await new Promise((resolve) => setTimeout(resolve, 12));

    expect(mock.terminate).not.toHaveBeenCalled();
    isolatedHub.close();
  });

  it('ignores malformed frames without crashing the connection', async () => {
    const client = new WebSocket(url);
    await waitForOpen(client);
    client.send('not json');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.readyState).toBe(WebSocket.OPEN);
    client.close();
  });
});
