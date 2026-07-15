/**
 * apps/server API assembly (W4-01 scaffold): auth + healthz + WS projection
 * hub + the SPA static bundle, all behind the SC-08 localhost boundary.
 * Route groups beyond this scaffold (projects, tickets, phases, …) land in
 * later W4 tickets per docs/API_DESIGN.md's endpoint catalog.
 */

import websocketPlugin from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { buildAllowlist } from './allowlist.js';
import { authPlugin } from './auth-plugin.js';
import { registerHealthz } from './healthz.js';
import { WsHub } from './ws-hub.js';

export interface BuildApiServerOptions {
  token: string;
  port: number;
  isDbOpen: () => boolean;
  /** Built apps/web assets (index.html + bundle); omitted in API-only tests. */
  webDistDir?: string;
  logger?: boolean;
  wsHub?: WsHub;
}

export interface ApiServer {
  app: FastifyInstance;
  wsHub: WsHub;
}

export async function buildApiServer(opts: BuildApiServerOptions): Promise<ApiServer> {
  const app = Fastify({ logger: opts.logger ?? false });
  const allowlist = buildAllowlist(opts.port);
  const wsHub = opts.wsHub ?? new WsHub();
  wsHub.start();

  await app.register(authPlugin, { token: opts.token, allowlist });
  await app.register(websocketPlugin);

  registerHealthz(app, { isDbOpen: opts.isDbOpen, wsHub });

  app.get('/api/v1/ws', { websocket: true }, (socket: WebSocket) => {
    wsHub.handleConnection(socket);
  });

  if (opts.webDistDir) {
    await app.register(fastifyStatic, { root: opts.webDistDir });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    wsHub.close();
  });

  return { app, wsHub };
}

/** SC-08: the server binds 127.0.0.1 only, never 0.0.0.0 — single choke point. */
export async function listenLocalhost(app: FastifyInstance, port: number): Promise<void> {
  await app.listen({ host: '127.0.0.1', port });
}
