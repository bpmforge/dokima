/**
 * apps/server API assembly (W4-01 scaffold): auth + healthz + WS projection
 * hub + the SPA static bundle, all behind the SC-08 localhost boundary.
 * Route groups beyond this scaffold (projects, tickets, phases, …) land in
 * later W4 tickets per docs/API_DESIGN.md's endpoint catalog.
 *
 * WS upgrades and static file serving are hand-rolled instead of using
 * `@fastify/websocket`/`@fastify/static`: those packages only exist by
 * being declared in `apps/server/package.json`, which sits outside this
 * ticket's write_scope (`apps/server/src/api/**` only) — see `ws-socket.ts`.
 */

import { promises as fs } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildAllowlist } from './allowlist.js';
import { checkAuth, registerAuthHook, type AuthPluginOptions } from './auth-plugin.js';
import { registerHealthz } from './healthz.js';
import { registerProjectRoutes } from './projects.js';
import { WsHub } from './ws-hub.js';
import { completeHandshake, rejectUpgrade } from './ws-socket.js';

export interface BuildApiServerOptions {
  token: string;
  port: number;
  isDbOpen: () => boolean;
  /** Built apps/web assets (index.html + bundle); omitted in API-only tests. */
  webDistDir?: string;
  logger?: boolean;
  wsHub?: WsHub;
  /** Fleet registry home dir override (defaults to computeShipwrightHome()) — tests only. */
  fleetHome?: string;
}

export interface ApiServer {
  app: FastifyInstance;
  wsHub: WsHub;
}

const WS_PATH = '/api/v1/ws';

export async function buildApiServer(opts: BuildApiServerOptions): Promise<ApiServer> {
  const app = Fastify({ logger: opts.logger ?? false });
  const allowlist = buildAllowlist(opts.port);
  const authOpts: AuthPluginOptions = { token: opts.token, allowlist };
  const wsHub = opts.wsHub ?? new WsHub();
  wsHub.start();

  registerAuthHook(app, authOpts);
  registerHealthz(app, { isDbOpen: opts.isDbOpen, wsHub });
  registerProjectRoutes(app, { home: opts.fleetHome });
  registerStatic(app, opts.webDistDir, opts.token);

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    handleUpgrade(req, socket, authOpts, wsHub);
  });

  app.addHook('onClose', async () => {
    wsHub.close();
  });

  return { app, wsHub };
}

function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  authOpts: AuthPluginOptions,
  wsHub: WsHub,
): void {
  const url = req.url ?? '/';
  const pathname = new URL(url, 'http://localhost').pathname;
  if (pathname !== WS_PATH) {
    socket.destroy();
    return;
  }

  const result = checkAuth(
    {
      host: req.headers.host,
      origin: req.headers.origin,
      url,
      authorization: req.headers.authorization,
    },
    authOpts,
  );
  if (!result.ok) {
    rejectUpgrade(
      socket,
      result.status,
      result.status === 401 ? 'Unauthorized' : 'Forbidden',
      {
        error: result.reason,
        rule: result.rule,
      },
    );
    return;
  }

  const ws = completeHandshake(req, socket);
  if (ws) wsHub.handleConnection(ws);
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
}

/** Resolves a request path under `root`, refusing any `..` traversal outside it. */
function resolveStaticPath(root: string, urlPath: string): string | undefined {
  const pathname = new URL(urlPath, 'http://localhost').pathname;
  const resolved = path.resolve(root, `.${pathname}`);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return undefined;
  return resolved;
}

/**
 * API_DESIGN §1: the bearer token is "auto-injected by the served SPA" —
 * the browser has no other way to read `~/.shipwright/token` (SC-08 static
 * assets are intentionally unauthenticated so the shell can load before it
 * has a token at all). Injected as a global rather than fetched over an
 * unauthenticated endpoint, which would hand the token to any localhost
 * page, not just this one.
 */
function injectToken(html: string, token: string): string {
  const script = `<script>window.__SHIPWRIGHT_TOKEN__=${JSON.stringify(token)};</script>`;
  return html.includes('</head>')
    ? html.replace('</head>', `${script}</head>`)
    : script + html;
}

function registerStatic(
  app: FastifyInstance,
  webDistDir: string | undefined,
  token: string,
): void {
  if (!webDistDir) return;

  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const target = resolveStaticPath(webDistDir, request.url);
    if (target) {
      try {
        const body = await fs.readFile(target);
        if (target.endsWith('.html')) {
          return reply
            .type('text/html; charset=utf-8')
            .send(injectToken(body.toString('utf8'), token));
        }
        return reply.type(contentTypeFor(target)).send(body);
      } catch {
        // Not a real file (or a directory, e.g. `/`) — fall through to the SPA shell.
      }
    }
    const index = await fs.readFile(path.join(webDistDir, 'index.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').send(injectToken(index, token));
  });

  app.setNotFoundHandler(async (_request, reply) => {
    await reply.code(404).send({ error: 'not_found' });
  });
}

/** SC-08: the server binds 127.0.0.1 only, never 0.0.0.0 — single choke point. */
export async function listenLocalhost(app: FastifyInstance, port: number): Promise<void> {
  await app.listen({ host: '127.0.0.1', port });
}
