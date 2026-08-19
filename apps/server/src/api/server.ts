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

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildAllowlist } from './allowlist.js';
import { registerAuthHook, type AuthPluginOptions } from './auth-plugin.js';
import { registerDecisionRoutes } from './decisions/index.js';
import { registerExportRoutes } from './export-routes.js';
import { registerEventsSseRoute } from './events-sse.js';
import { registerHealthz } from './healthz.js';
import { registerLessonsRoutes } from './lessons/index.js';
import { registerOpenApiRoute } from './openapi.js';
import { registerPipelineRoutes } from './pipeline/index.js';
import { registerPlansRoutes } from './plans-routes.js';
import { registerProjectRoutes } from './projects.js';
import { registerRosterRoutes } from './roster.js';
import { registerBrowseRoutes } from './server/browse-routes.js';
import { registerInterviewRoutes } from './server/interview-routes.js';
import { registerArtifactRoutes, registerBoardRoutes, registerEstimateRoutes, registerNotificationRoutes, registerReceiptRoutes, registerRunsRoutes, registerTicketEditRoutes } from './server/index.js';
import { registerSettingsRoutes } from './server/settings-routes.js';
import { WsHub } from './ws-hub.js';
import { createBoardWatcher } from './server/board-watcher.js';
import { computeFleetRegistryPath } from './projects/registry-store.js';
import { registerChatRoute } from './server/chat-fixture.js';
import { handleUpgrade } from './server/ws-upgrade.js';
import { registerStatic } from './server/static-assets.js';

import { startPlanScheduler, type PlanSchedulerOptions } from '../scheduler/index.js';

export interface BuildApiServerOptions {
  token: string;
  port: number;
  isDbOpen: () => boolean;
  /** Built apps/web assets (index.html + bundle); omitted in API-only tests. */
  webDistDir?: string;
  logger?: boolean;
  wsHub?: WsHub;
  /** Fleet registry home dir override (defaults to computeDokimaHome()) — tests only. */
  fleetHome?: string;
  /** `content/experts` directory override (defaults to the repo's own content/) — tests only. */
  rosterContentDir?: string;
  /**
   * Receipt-minting secret (FR-S2, law #8), same value `mintReceipt`/
   * `verifyReceipt` and the CLI's `--signing-key` use. Gates the export/import
   * bundle routes and nothing else.
   *
   * **Absent means those two routes are not registered at all** — deliberately
   * fail-closed. `POST /import` replays each receipt's anchor MAC via
   * `computeReceiptMac(content, signingKey)`, so registering it with an empty
   * key would make that check forgeable by anyone holding the Bearer token:
   * an attacker who knows the key is `''` can compute matching MACs and plant
   * receipts. A missing endpoint is safe; an unverifiable one is not.
   */
  signingKey?: string;
  /**
   * Improvement Plans scheduler (FR-PLAN1/3, W5-15) — run-completion/
   * Improve-mode trigger + nightly auto-verify. Always on in production;
   * tests override the intervals (or `onError`) rather than disabling it,
   * since the defaults are long enough to never fire during a test's
   * lifetime and `onClose` always stops the timers.
   */
  planScheduler?: PlanSchedulerOptions;
}

export interface ApiServer {
  app: FastifyInstance;
  wsHub: WsHub;
}


// W10-48: three unrelated feature bodies used to sit inline below
// `buildApiServer` — a 143-line hardcoded chat fixture, WS upgrade dispatch,
// and static asset serving. They are chapters in ./server/ now. What remains
// here is the Fastify composition root itself: ~18 `register*` calls plus the
// upgrade hook, which is legitimate wiring rather than a concern to extract.

export async function buildApiServer(opts: BuildApiServerOptions): Promise<ApiServer> {
  const app = Fastify({ logger: opts.logger ?? false });
  const allowlist = buildAllowlist(opts.port);
  const authOpts: AuthPluginOptions = { token: opts.token, allowlist };
  const wsHub = opts.wsHub ?? new WsHub();
  wsHub.start();

  // W10-75: the board is a projection of the event log, not of one HTTP
  // handler. The CLI and the harbormaster loop write from OTHER PROCESSES, so
  // without this an open Canvas is stale for every change an agent makes.
  const boardWatcher = createBoardWatcher({
    wsHub,
    registryPath: computeFleetRegistryPath(opts.fleetHome),
  });
  boardWatcher.start();

  registerAuthHook(app, authOpts);
  registerHealthz(app, { isDbOpen: opts.isDbOpen, wsHub });
  registerProjectRoutes(app, { home: opts.fleetHome });
  registerBoardRoutes(app, { home: opts.fleetHome, wsHub });
  registerEstimateRoutes(app, { home: opts.fleetHome });
  registerArtifactRoutes(app, { home: opts.fleetHome });
  registerReceiptRoutes(app, { home: opts.fleetHome });
  registerRunsRoutes(app, { home: opts.fleetHome });
  registerBrowseRoutes(app, { home: opts.fleetHome });
  // W13-18: the adaptive follow-up AC-1 promised and nothing supplied.
  registerInterviewRoutes(app, { home: opts.fleetHome });
  registerTicketEditRoutes(app, { home: opts.fleetHome });
  registerNotificationRoutes(app, { home: opts.fleetHome });
  registerPlansRoutes(app, { home: opts.fleetHome });
  registerPipelineRoutes(app, { home: opts.fleetHome });
  registerDecisionRoutes(app, { home: opts.fleetHome, auth: authOpts });
  // ROADMAP W8 exit criterion ("export/import round-trips with chain
  // verification") — registered only when a signing key is configured, see
  // BuildApiServerOptions.signingKey for why absence must mean "no route"
  // rather than "route with an empty key".
  if (opts.signingKey) {
    registerExportRoutes(app, {
      home: opts.fleetHome,
      auth: authOpts,
      signingKey: opts.signingKey,
    });
  }
  registerLessonsRoutes(app, { home: opts.fleetHome });
  registerRosterRoutes(app, { home: opts.fleetHome, contentDir: opts.rosterContentDir });
  registerSettingsRoutes(app, { home: opts.fleetHome });
  registerChatRoute(app, { home: opts.fleetHome });
  registerOpenApiRoute(app);
  registerEventsSseRoute(app, { wsHub });
  registerStatic(app, opts.webDistDir, opts.token);

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    handleUpgrade(req, socket, authOpts, wsHub);
  });

  const planScheduler = startPlanScheduler({
    fleetHome: opts.fleetHome,
    ...opts.planScheduler,
  });

  app.addHook('onClose', async () => {
    boardWatcher.stop();
    planScheduler.stop();
    wsHub.close();
  });

  return { app, wsHub };
}

export async function listenLocalhost(app: FastifyInstance, port: number): Promise<void> {
  await app.listen({ host: '127.0.0.1', port });
}
