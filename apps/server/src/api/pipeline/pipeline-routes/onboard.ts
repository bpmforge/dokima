/**
 * `POST /api/v1/projects/:id/pipeline/onboard-run` — starts and advances one
 * onboard/analysis run (BLUEPRINT §4, W8-08's `runOnboard`, this ticket's
 * real gateway/`runSession` wiring). All the real work — dispatch,
 * `runOnboard`, event emission, plans-lifecycle persistence — lives in
 * `../onboard-run.js`'s `runOnboardAnalysis`, the SAME function
 * `cli/run-cmd.ts`'s `run start --mode onboard` call-site calls; this route
 * is just the HTTP-shaped adapter around it (project-id -> registered
 * project path, problem-mapping on error).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openEventLog } from '@shipwright/events';
import { computeFleetRegistryPath } from '../../projects.js';
import { notFound } from '../../server/artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { resolveProjectRecord, stateDbPath } from '../../server/board-project.js';
import type { AcceptedOnboardFinding } from '../onboard-board-lifecycle.js';
import type { OnboardGatewayConfig } from '../onboard-dispatch-port.js';
import { runOnboardAnalysis } from '../onboard-run.js';
import { problemForError } from './problems.js';

export interface OnboardRoutesOptions {
  home?: string;
  /** Overrides the default env-resolved gateway config — tests point this at a fake HTTP server. */
  gatewayConfig?: OnboardGatewayConfig;
  /** Injectable clock (TESTING.md §2). */
  now?: () => string;
}

function wireAcceptedItem(accepted: AcceptedOnboardFinding) {
  return {
    id: accepted.item.id,
    catalog_id: accepted.item.catalogId,
    state: accepted.item.state,
    ticket_id: accepted.item.ticketId,
    ticket_created: accepted.ticketCreated,
  };
}

export function registerOnboardRoute(
  app: FastifyInstance,
  opts: OnboardRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  const now = opts.now ?? (() => new Date().toISOString());

  app.post(
    '/api/v1/projects/:id/pipeline/onboard-run',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${projectId}`));
      }

      try {
        const runId = randomUUID();
        const dbPath = stateDbPath(record.path);
        const log = openEventLog(dbPath);
        let outcome;
        try {
          outcome = await runOnboardAnalysis({
            log,
            runId,
            projectPath: record.path,
            now,
            gatewayConfig: opts.gatewayConfig,
          });
        } finally {
          log.close();
        }
        return reply.code(201).send({
          run_id: runId,
          health_assessment: outcome.result.healthAssessment,
          coverage_manifest: outcome.result.coverageManifest,
          plan_items: outcome.accepted.map(wireAcceptedItem),
        });
      } catch (err) {
        const problem = problemForError(err, request);
        if (problem) {
          return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem.body);
        }
        throw err;
      }
    },
  );
}
