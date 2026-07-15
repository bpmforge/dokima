/** GET /healthz — unauthenticated liveness: DB open, WS hub up (API_DESIGN §2). */

import type { FastifyInstance } from 'fastify';
import type { WsHub } from './ws-hub.js';

export interface HealthzDeps {
  isDbOpen: () => boolean;
  wsHub: WsHub;
}

export function registerHealthz(app: FastifyInstance, deps: HealthzDeps): void {
  app.get('/healthz', async (_request, reply) => {
    const db = deps.isDbOpen();
    const ws = deps.wsHub.isUp;
    const ok = db && ws;
    await reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', db, ws });
  });
}
