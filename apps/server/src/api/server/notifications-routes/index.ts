/**
 * Notification center + aggregated morning queue routes (API_DESIGN §2
 * "clarifications & approvals", UX_SPEC §7, FR-N4/FR-F4, US-404/US-704/
 * US-801). Fans `../../notifications/`'s per-project core out across every
 * registered project (D-013 Fleet, same aggregation shape as
 * `projects.ts`'s `listProjectCards` — reused here rather than
 * reimplemented) for the "one ten-minute review" cross-project queue.
 *
 * Book-split per CODE_BOOK_PROTOCOL.md: `shared.ts` (fleet resolution,
 * per-project refresh, wire mapping, Problem+JSON builders), `read-routes.ts`
 * (GET notifications/queue), `decide-routes.ts` (POST decide/dismiss),
 * `emit-route.ts` (POST the emitter contract). This file is the public
 * barrel.
 */

import type { FastifyInstance } from 'fastify';
import { computeFleetRegistryPath } from '../../projects.js';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TIERS,
} from '../../notifications/index.js';
import { registerDecideRoute, registerDismissRoute } from './decide-routes.js';
import { registerEmitRoute } from './emit-route.js';
import { registerListRoute, registerQueueRoute } from './read-routes.js';
import type { NotificationRoutesOptions } from './shared.js';

export type { NotificationRoutesOptions };

/** Notification center + morning queue routes (module header). */
export function registerNotificationRoutes(
  app: FastifyInstance,
  opts: NotificationRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  registerListRoute(app, registryPath);
  registerQueueRoute(app, registryPath);
  registerDecideRoute(app, registryPath);
  registerDismissRoute(app, registryPath);
  registerEmitRoute(app, registryPath);
}

export { NOTIFICATION_KINDS, NOTIFICATION_STATUSES, NOTIFICATION_TIERS };
