/**
 * Settings surface composition root (W4-06): registers every settings route
 * group onto the Fastify app. MCP server registration + per-role tool
 * allowlists, validator-pack selection, expert overrides, and per-role
 * escalation policy (AC2/AC4) have no dedicated typed route — like
 * "berths default" in API_DESIGN §110, they are project-scope settings
 * keys (`mcpServers`, `validatorPackSelection`, `expertOverrides`,
 * `escalationPolicy`) read/written through the generic
 * `GET/PUT /projects/{id}/settings` + `GET /projects/{id}/settings/effective`
 * routes registered by scope-routes.ts — the same pattern the API_DESIGN
 * catalog itself uses for "MCP registrations".
 */

import type { FastifyInstance } from 'fastify';
import { registerAutonomyBudgetRoutes } from './autonomy-budget-routes.js';
import { registerConsentRoutes } from './consent-routes.js';
import { registerGuideRoutes, type GuideRoutesOptions } from './guide-routes.js';
import { registerMatrixRoutes } from './matrix-routes.js';
import { registerRulesRoutes } from './rules-routes.js';
import { registerScopeRoutes } from './scope-routes.js';

export interface SettingsRoutesOptions extends GuideRoutesOptions {
  /** Fleet registry home dir override (defaults to computeShipwrightHome()) — tests only. */
  home?: string;
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  opts: SettingsRoutesOptions = {},
): void {
  registerScopeRoutes(app, opts);
  registerMatrixRoutes(app, opts);
  registerAutonomyBudgetRoutes(app, opts);
  registerRulesRoutes(app, opts);
  registerConsentRoutes(app, opts);
  registerGuideRoutes(app, opts);
}
