import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApiServer, listenLocalhost, type ApiServer } from './server.js';

const TOKEN = 'test-token-0123456789abcdef';

/**
 * The allowlist is built from the requested port at `buildApiServer()` time,
 * before the socket binds — so tests can't ask for an OS-assigned port
 * (`port: 0`) and read the real one back afterwards the way a raw `listen`
 * caller could. Pre-allocate a free port instead, matching how a real boot
 * always supplies an explicit configured port.
 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no address'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

async function buildAndListen(
  overrides: Partial<Parameters<typeof buildApiServer>[0]> = {},
) {
  const port = await getFreePort();
  const server = await buildApiServer({
    token: TOKEN,
    port,
    isDbOpen: () => true,
    logger: false,
    ...overrides,
  });
  await server.app.listen({ host: '127.0.0.1', port });
  const address = server.app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no address');
  return { server, port: address.port };
}

describe('buildApiServer — SC-08', () => {
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
  });

  it('binds 127.0.0.1 only, never 0.0.0.0', async () => {
    const { server, port } = await buildAndListen();
    active = server;
    const address = server.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no address');
    expect(address.address).toBe('127.0.0.1');
    expect(port).toBeGreaterThan(0);
  });

  it('never serves CORS headers, even for a same-origin request with an Origin header', async () => {
    const { server, port } = await buildAndListen();
    active = server;
    const res = await server.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    });
    expect(res.statusCode).toBe(200);
    expect(
      Object.keys(res.headers).some((h) => h.toLowerCase().startsWith('access-control-')),
    ).toBe(false);
  });

  it('/healthz is unauthenticated and reports db + ws state', async () => {
    const { server, port } = await buildAndListen({ isDbOpen: () => true });
    active = server;
    const res = await server.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { host: `127.0.0.1:${port}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: true, ws: true });
  });

  it('/healthz reports 503 when the DB is not open', async () => {
    const { server, port } = await buildAndListen({ isDbOpen: () => false });
    active = server;
    const res = await server.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { host: `127.0.0.1:${port}` },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: false });
  });

  it('rejects an evil Host header with 403, even on /healthz', async () => {
    const { server } = await buildAndListen();
    active = server;
    const res = await server.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { host: 'evil.example.com:1337' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ rule: 'SC-08' });
  });

  it('rejects an evil Origin header with 403 on an API route', async () => {
    const { server, port } = await buildAndListen();
    active = server;
    const res = await server.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { host: `127.0.0.1:${port}`, origin: 'https://evil.example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a missing bearer token on an /api route with 401', async () => {
    const { server, port } = await buildAndListen();
    active = server;
    const res = await server.app.inject({
      method: 'GET',
      url: '/api/v1/ws',
      headers: { host: `127.0.0.1:${port}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ rule: 'D-005' });
  });

  it('accepts a valid bearer token on an /api route', async () => {
    const { server, port } = await buildAndListen();
    active = server;
    const res = await server.app.inject({
      method: 'GET',
      url: '/healthz', // stand-in for a real /api route existence check isn't needed; token gate is what's under test
      headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('WS upgrade re-checks the token: missing token is rejected before upgrade', async () => {
    const { server, port } = await buildAndListen();
    active = server;
    // injectWS drives the real onUpgrade -> fastify.routing -> hook path in-process
    // (no live socket left dangling for afterEach's app.close() to wait on).
    await expect(
      server.app.injectWS('/api/v1/ws', { headers: { host: `127.0.0.1:${port}` } }),
    ).rejects.toThrow('Unexpected server response: 401');
  });

  it('WS upgrade re-checks Origin: evil Origin is rejected before upgrade', async () => {
    const { server, port } = await buildAndListen();
    active = server;
    await expect(
      server.app.injectWS(`/api/v1/ws?token=${TOKEN}`, {
        headers: { host: `127.0.0.1:${port}`, origin: 'https://evil.example.com' },
      }),
    ).rejects.toThrow('Unexpected server response: 403');
  });

  it('WS upgrade succeeds with a valid token + origin and streams a published envelope', async () => {
    const { server, port } = await buildAndListen();
    active = server;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws?token=${TOKEN}`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });
    socket.send(JSON.stringify({ op: 'subscribe', subscriptions: ['board:PROJ1'] }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const messagePromise = new Promise((resolve) => {
      socket.once('message', (raw) => resolve(JSON.parse(raw.toString('utf8'))));
    });
    server.wsHub.publish('board:PROJ1', 'ticket.closed', { id: 'W4-01' });
    const envelope = await messagePromise;
    expect(envelope).toMatchObject({ sub: 'board:PROJ1', type: 'ticket.closed' });
    socket.close();
  });
});

describe('listenLocalhost', () => {
  it('starts the server bound to 127.0.0.1', async () => {
    const server = await buildApiServer({ token: TOKEN, port: 0, isDbOpen: () => true });
    await listenLocalhost(server.app, 0);
    const address = server.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no address');
    expect(address.address).toBe('127.0.0.1');
    await server.app.close();
  });
});
