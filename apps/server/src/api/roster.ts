/**
 * Agent roster & observability routes (SRS FR-E2, R-K1; API_DESIGN §"roster
 * & feedback"): `GET /api/v1/roster` (every content/ expert: cluster, mode,
 * description, effective model resolution + winning scope, fitness cards,
 * instruction cost) and `GET /api/v1/roster/:agent/history` (event-derived
 * per-agent history). `?project=` is optional on the list route (layers in
 * project-scope matrix overrides when given, global-only otherwise — same
 * "cross-cutting route, `?project=` disambiguates" convention
 * `board-project.ts` documents) and required on the history route (a
 * project's event log is the only place HANDOFF/outcome/escalation events
 * live, same requirement `board-routes.ts`'s verb route enforces for
 * `?project=`).
 *
 * Instruction-cost metadata (FR-L8) has no producer anywhere in this repo
 * yet (FR-L8 lands with W7-04/W1-06, not this ticket) — reported `null`
 * rather than a fabricated estimate, same discipline `projects.ts`'s
 * `EMPTY_STATS` documents for every card field with no producer.
 * HANDOFF: wire this up once FR-L8's packer records real instruction-cost
 * metadata per expert.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  loadGlobalConfig,
  loadProjectSettings,
  type ScopedSettings,
} from '@shipwright/shared';
import {
  defaultGlobalDbPath,
  listEvents,
  openEventLogReader,
  type EventLog,
} from '@shipwright/events';
import { computeFleetRegistryPath } from './projects.js';
import { resolveProjectRecord, stateDbPath } from './server/board-project.js';
import {
  loadRosterExperts,
  RosterContentModelIdError,
  type RosterExpert,
} from './roster-content.js';
import { resolveEffectiveModel } from './roster-resolve.js';
import { loadFitnessCards } from './roster-fitness.js';
import { buildAgentHistory } from './roster-history.js';
import { problem, PROBLEM_CONTENT_TYPE } from './problem.js';

function defaultContentDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '../../../../content/experts');
}

export interface RosterRoutesOptions {
  /** Directory to load experts from — defaults to the repo's `content/experts`. Tests only. */
  contentDir?: string;
  /** `~/.shipwright` home override (fleet registry, global config, global.db) — tests only. */
  home?: string;
}

function envFor(home: string | undefined): NodeJS.ProcessEnv {
  return home ? { ...process.env, SHIPWRIGHT_HOME: home } : process.env;
}

function notFound(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

async function resolveScopedSettings(
  opts: RosterRoutesOptions,
  registryPath: string,
  projectId: string | undefined,
): Promise<ScopedSettings> {
  const env = envFor(opts.home);
  const global = await loadGlobalConfig(env);
  if (!projectId) return { global };
  const record = await resolveProjectRecord(registryPath, projectId);
  if (!record) return { global };
  const project = await loadProjectSettings(record.path);
  return { global, project };
}

function wireExpert(
  expert: RosterExpert,
  settings: ScopedSettings,
  fitnessCards: Awaited<ReturnType<typeof loadFitnessCards>>,
) {
  const effective = resolveEffectiveModel(settings, expert.id);
  return {
    id: expert.id,
    display_name: expert.displayName,
    cluster: expert.cluster,
    mode: expert.mode,
    description: expert.description,
    effective_model: {
      chain: effective.chain,
      scope: effective.scope,
      used_default_role: effective.usedDefaultRole,
    },
    fitness_cards: fitnessCards.map((card) => ({
      model: card.model,
      verdict: card.verdict,
      harness_version: card.harnessVersion,
      run_at: card.runAt,
    })),
    // FR-L8 (token envelopes / instruction-cost metadata) has no producer yet — honest null, not a guess.
    instruction_cost: null,
  };
}

/** `GET /api/v1/roster` (API_DESIGN §"roster & feedback"). */
function registerListRoute(app: FastifyInstance, opts: RosterRoutesOptions): void {
  const contentDir = opts.contentDir ?? defaultContentDir();
  const registryPath = computeFleetRegistryPath(opts.home);

  app.get('/api/v1/roster', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, unknown>;
    const projectId = typeof query.project === 'string' ? query.project : undefined;

    let experts: RosterExpert[];
    try {
      experts = await loadRosterExperts(contentDir);
    } catch (err) {
      if (err instanceof RosterContentModelIdError) {
        return reply
          .code(500)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            problem({
              type: 'https://shipwright.dev/errors/roster-content-refused',
              title: 'Roster content refused',
              status: 500,
              detail: err.message,
              instance: request.url,
              requestId: request.id.toString(),
              rule: 'FR-E2: pin roles, not models',
            }),
          );
      }
      throw err;
    }

    const settings = await resolveScopedSettings(opts, registryPath, projectId);
    const globalDbPath = defaultGlobalDbPath(envFor(opts.home));
    const items = await Promise.all(
      experts.map(async (expert) => {
        const fitnessCards = await loadFitnessCards(expert.id, { globalDbPath });
        return wireExpert(expert, settings, fitnessCards);
      }),
    );

    return reply.send({ experts: items });
  });
}

/** `GET /api/v1/roster/:agent/history` (API_DESIGN §"roster & feedback"). */
function registerHistoryRoute(app: FastifyInstance, opts: RosterRoutesOptions): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  app.get(
    '/api/v1/roster/:agent/history',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agent } = request.params as { agent: string };
      const query = request.query as Record<string, unknown>;
      const projectId = query.project;
      if (typeof projectId !== 'string' || projectId.length === 0) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'missing required "project" query parameter'));
      }

      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${projectId}`));
      }

      const dbPath = stateDbPath(record.path);
      const db = openEventLogReader(dbPath);
      const log: EventLog = { db, path: dbPath, close: () => db.close() };
      try {
        const history = buildAgentHistory(listEvents(log), agent);
        return reply.send({
          agent_id: history.agentId,
          handoffs_run: history.handoffsRun,
          outcomes: history.outcomes,
          verdict_scores: history.verdictScores,
          spend: history.spend,
          escalations: history.escalations,
          entries: history.entries.map((entry) => ({
            seq: entry.seq,
            event_type: entry.eventType,
            kind: entry.kind,
            ticket_id: entry.ticketId,
            occurred_at: entry.occurredAt,
          })),
        });
      } finally {
        log.close();
      }
    },
  );
}

export function registerRosterRoutes(
  app: FastifyInstance,
  opts: RosterRoutesOptions = {},
): void {
  registerListRoute(app, opts);
  registerHistoryRoute(app, opts);
}
