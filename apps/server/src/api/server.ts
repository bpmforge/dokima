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
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { buildAllowlist } from './allowlist.js';
import { checkAuth, registerAuthHook, type AuthPluginOptions } from './auth-plugin.js';
import { registerEventsSseRoute } from './events-sse.js';
import { registerHealthz } from './healthz.js';
import { registerOpenApiRoute } from './openapi.js';
import { registerProjectRoutes } from './projects.js';
import { registerRosterRoutes } from './roster.js';
import {
  registerArtifactRoutes,
  registerBoardRoutes,
  registerEstimateRoutes,
  registerNotificationRoutes,
  registerReceiptRoutes,
} from './server/index.js';
import { registerSettingsRoutes } from './server/settings-routes.js';
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
  /** `content/experts` directory override (defaults to the repo's own content/) — tests only. */
  rosterContentDir?: string;
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
  registerBoardRoutes(app, { home: opts.fleetHome, wsHub });
  registerEstimateRoutes(app, { home: opts.fleetHome });
  registerArtifactRoutes(app, { home: opts.fleetHome });
  registerReceiptRoutes(app, { home: opts.fleetHome });
  registerNotificationRoutes(app, { home: opts.fleetHome });
  registerRosterRoutes(app, { home: opts.fleetHome, contentDir: opts.rosterContentDir });
  registerSettingsRoutes(app, { home: opts.fleetHome });
  registerChatRoute(app);
  registerOpenApiRoute(app);
  registerEventsSseRoute(app, { wsHub });
  registerStatic(app, opts.webDistDir, opts.token);

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    handleUpgrade(req, socket, authOpts, wsHub);
  });

  app.addHook('onClose', async () => {
    wsHub.close();
  });

  return { app, wsHub };
}

/**
 * `GET /api/v1/projects/:id/chat` (FR-C2, UX_SPEC §3). No chat/message
 * producer exists anywhere in this repo yet — no clarifications/slates/
 * findings event schema in `@shipwright/events`, no cost tracking reachable
 * from `apps/server` (`packages/gateway`/`packages/loop` aren't declared
 * dependencies here, same class of constraint as this file's own
 * `@fastify/websocket` note above) — so this replays a fixture event
 * stream, exactly as SRS's FR-C2 acceptance sketch names it ("Fixture event
 * stream renders all four card types"), same discipline as
 * `apps/web/e2e/fixtures/fake-model-gateway.ts` hand-rolling wire shapes
 * instead of importing an out-of-scope package. Hand-mirrored in
 * `apps/web/src/chat/fixtures.ts` (no module boundary between the two
 * apps to import across, ARCHITECTURE.md §4) — keep both in sync by hand.
 * HANDOFF: replace with a real projection once a chat/message producer
 * exists (loop/Harbormaster chat wiring, a future ticket).
 */
const CHAT_FIXTURE_ITEMS = [
  {
    sub: 'chat:default',
    seq: 1,
    type: 'thread.opened',
    at: '2026-07-15T14:02:00Z',
    data: { id: 'thread-program', kind: 'program', concern: null },
  },
  {
    sub: 'chat:default',
    seq: 2,
    type: 'thread.opened',
    at: '2026-07-15T14:03:00Z',
    data: {
      id: 'thread-w4-04-security',
      kind: 'agent',
      concern: 'W4-04 security review',
    },
  },
  {
    sub: 'chat:default',
    seq: 3,
    type: 'card.question',
    at: '2026-07-15T14:04:00Z',
    data: {
      id: 'card-question-1',
      thread_id: 'thread-w4-04-security',
      provenance: {
        agent: 'security-auditor',
        model: 'claude-sonnet-5',
        ticket_id: 'W4-04',
        cost_usd: 0.0421,
        receipt_id: 'rcpt_chat_q1',
      },
      question:
        'Should the cost provenance link open the receipt or the spend ledger row?',
      context:
        'FR-C2 names both "receipt/artifact" and "ledger row" for the same click-through.',
      options: [
        { id: 'receipt', label: 'Receipt', isDefault: true },
        { id: 'ledger', label: 'Spend ledger row', isDefault: false },
      ],
      status: 'open',
    },
  },
  {
    sub: 'chat:default',
    seq: 4,
    type: 'card.finding',
    at: '2026-07-15T14:05:00Z',
    data: {
      id: 'card-finding-1',
      thread_id: 'thread-w4-04-security',
      provenance: {
        agent: 'security-auditor',
        model: 'claude-sonnet-5',
        ticket_id: 'W4-04',
        cost_usd: 0.0187,
        receipt_id: 'rcpt_chat_f1',
      },
      severity: 'medium',
      issue:
        'Cost click-through targets an unimplemented /api/v1/receipts/:id (documented, not built).',
      evidence_href: '/api/v1/receipts/rcpt_chat_f1',
    },
  },
  {
    sub: 'chat:default',
    seq: 5,
    type: 'card.manifest',
    at: '2026-07-15T14:06:00Z',
    data: {
      id: 'card-manifest-1',
      thread_id: 'thread-program',
      provenance: {
        agent: 'coding-agent',
        model: 'claude-sonnet-5',
        ticket_id: 'W4-04',
        cost_usd: 0.129,
        receipt_id: 'rcpt_chat_m1',
      },
      files: ['apps/web/src/chat/ChatView.tsx', 'apps/web/src/chat/Card.tsx'],
      verify_result: 'pass',
      diff_stat: '+612 -0',
    },
  },
  {
    sub: 'chat:default',
    seq: 6,
    type: 'card.slate',
    at: '2026-07-15T14:07:00Z',
    data: {
      id: 'card-slate-1',
      thread_id: 'thread-program',
      provenance: {
        agent: 'shipwright-pm',
        model: 'claude-opus-4-8',
        ticket_id: 'W4-04',
        cost_usd: 0.005,
        receipt_id: 'rcpt_chat_s1',
      },
      options: [
        {
          id: 'receipt',
          label: 'Link cost to the receipt',
          tradeoffs: 'Ships today; FR-C5 viewer lands later.',
        },
        {
          id: 'ledger',
          label: 'Link cost to a spend-ledger row',
          tradeoffs: 'No GET /spend/:id endpoint exists yet.',
        },
      ],
      recommended_id: 'receipt',
      decided_id: null,
    },
  },
];

function registerChatRoute(app: FastifyInstance): void {
  app.get(
    '/api/v1/projects/:id/chat',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ items: CHAT_FIXTURE_ITEMS });
    },
  );
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
