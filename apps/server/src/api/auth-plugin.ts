/**
 * SC-08 auth middleware (D-005). Two independent checks, both on every
 * request (including the WS upgrade, which goes through this same
 * `onRequest` hook before the connection is handed to @fastify/websocket —
 * TECH_STACK.md "WS + Fastify" trap):
 *
 *  1. Host + Origin allowlist — exact `localhost:<port>`/`127.0.0.1:<port>`.
 *     Applies to every path, `/healthz` included (evil Host/Origin ⇒ 403).
 *  2. Bearer token — required on every `/api/**` path except `/healthz`
 *     (missing/wrong ⇒ 401). Static SPA assets are unauthenticated: the
 *     browser must be able to load the shell before it has the token.
 *
 * `fp()`-wrapped per TECH_STACK.md so the decorator/hook is visible
 * server-wide rather than scoped to whichever plugin registers it first.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { isAllowedHost, isAllowedOrigin, type Allowlist } from './allowlist.js';
import { problem } from './problem.js';

export interface AuthPluginOptions {
  token: string;
  allowlist: Allowlist;
}

function extractBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  const url = new URL(request.url, 'http://localhost');
  return url.searchParams.get('token') ?? undefined;
}

function requiresToken(url: string): boolean {
  const pathname = new URL(url, 'http://localhost').pathname;
  return pathname.startsWith('/api/') && pathname !== '/healthz';
}

export const authPlugin = fp<AuthPluginOptions>(async (app, opts) => {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id.toString();
    const instance = request.url;

    if (!isAllowedHost(request.headers.host, opts.allowlist)) {
      await reply
        .code(403)
        .type('application/problem+json')
        .send(
          problem({
            type: 'https://shipwright.dev/errors/forbidden-host',
            title: 'Forbidden: Host header not in the localhost allowlist',
            status: 403,
            detail: `Host "${request.headers.host}" is not an allowed localhost origin (SC-08)`,
            instance,
            requestId,
            rule: 'SC-08',
          }),
        );
      return;
    }

    if (!isAllowedOrigin(request.headers.origin, opts.allowlist)) {
      await reply
        .code(403)
        .type('application/problem+json')
        .send(
          problem({
            type: 'https://shipwright.dev/errors/forbidden-origin',
            title: 'Forbidden: Origin header not in the localhost allowlist',
            status: 403,
            detail: `Origin "${request.headers.origin}" is not an allowed localhost origin (SC-08)`,
            instance,
            requestId,
            rule: 'SC-08',
          }),
        );
      return;
    }

    if (!requiresToken(request.url)) return;

    const token = extractBearerToken(request);
    if (token !== opts.token) {
      await reply
        .code(401)
        .type('application/problem+json')
        .send(
          problem({
            type: 'https://shipwright.dev/errors/unauthorized',
            title: 'Unauthorized: missing or invalid bearer token',
            status: 401,
            detail: 'Authorization: Bearer <token> is required (D-005)',
            instance,
            requestId,
            rule: 'D-005',
          }),
        );
      return;
    }
  });
});
