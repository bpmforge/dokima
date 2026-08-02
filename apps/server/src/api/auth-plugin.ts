/**
 * SC-08 auth checks (D-005). Two independent checks apply to every request,
 * the WS upgrade included (`server.ts` re-runs `checkAuth` on the raw
 * upgrade before the RFC 6455 handshake — TECH_STACK.md's "WS + Fastify"
 * trap, done without `@fastify/websocket` since that package isn't
 * reachable from this ticket's write_scope):
 *
 *  1. Host + Origin allowlist — exact `localhost:<port>`/`127.0.0.1:<port>`.
 *     Applies to every path, `/healthz` included (evil Host/Origin ⇒ 403).
 *  2. Bearer token — required on every `/api/**` path except `/healthz`
 *     (missing/wrong ⇒ 401). Static SPA assets are unauthenticated: the
 *     browser must be able to load the shell before it has the token.
 *
 * `registerAuthHook` adds the hook straight to the root Fastify instance
 * (never a nested `.register()`-ed plugin), so there's no encapsulation
 * boundary to cross and no need for `fastify-plugin`'s `fp()` wrapper —
 * that package lives in `apps/server/package.json`, which is outside this
 * ticket's write_scope (only `apps/server/src/api/**` is).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isAllowedHost, isAllowedOrigin, type Allowlist } from './allowlist.js';
import { problem } from './problem.js';

export interface AuthPluginOptions {
  token: string;
  allowlist: Allowlist;
}

export interface AuthCheckInput {
  host: string | undefined;
  origin: string | undefined;
  url: string;
  authorization: string | undefined;
}

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 403; rule: 'SC-08'; reason: 'host' | 'origin' }
  | { ok: false; status: 401; rule: 'D-005'; reason: 'token' };

function extractBearerToken(
  url: string,
  authorization: string | undefined,
): string | undefined {
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length);
  const parsed = new URL(url, 'http://localhost');
  return parsed.searchParams.get('token') ?? undefined;
}

function requiresToken(url: string): boolean {
  const pathname = new URL(url, 'http://localhost').pathname;
  return pathname.startsWith('/api/') && pathname !== '/healthz';
}

/** Pure SC-08/D-005 decision, reused by the onRequest hook and the raw WS upgrade path. */
export function checkAuth(input: AuthCheckInput, opts: AuthPluginOptions): AuthResult {
  if (!isAllowedHost(input.host, opts.allowlist)) {
    return { ok: false, status: 403, rule: 'SC-08', reason: 'host' };
  }
  if (!isAllowedOrigin(input.origin, opts.allowlist)) {
    return { ok: false, status: 403, rule: 'SC-08', reason: 'origin' };
  }
  if (!requiresToken(input.url)) return { ok: true };
  const token = extractBearerToken(input.url, input.authorization);
  if (token !== opts.token) {
    return { ok: false, status: 401, rule: 'D-005', reason: 'token' };
  }
  return { ok: true };
}

function problemFor(
  result: Extract<AuthResult, { ok: false }>,
  instance: string,
  requestId: string,
) {
  if (result.reason === 'host') {
    return problem({
      type: 'https://dokima.dev/errors/forbidden-host',
      title: 'Forbidden: Host header not in the localhost allowlist',
      status: 403,
      detail: 'Host header is not an allowed localhost origin (SC-08)',
      instance,
      requestId,
      rule: 'SC-08',
    });
  }
  if (result.reason === 'origin') {
    return problem({
      type: 'https://dokima.dev/errors/forbidden-origin',
      title: 'Forbidden: Origin header not in the localhost allowlist',
      status: 403,
      detail: 'Origin header is not an allowed localhost origin (SC-08)',
      instance,
      requestId,
      rule: 'SC-08',
    });
  }
  return problem({
    type: 'https://dokima.dev/errors/unauthorized',
    title: 'Unauthorized: missing or invalid bearer token',
    status: 401,
    detail: 'Authorization: Bearer <token> is required (D-005)',
    instance,
    requestId,
    rule: 'D-005',
  });
}

export function registerAuthHook(app: FastifyInstance, opts: AuthPluginOptions): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = checkAuth(
      {
        host: request.headers.host,
        origin: request.headers.origin,
        url: request.url,
        authorization: request.headers.authorization,
      },
      opts,
    );
    if (result.ok) return;
    await reply
      .code(result.status)
      .type('application/problem+json')
      .send(problemFor(result, request.url, request.id.toString()));
  });
}
