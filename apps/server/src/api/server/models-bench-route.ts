/**
 * `POST /api/v1/projects/:id/models/bench` (W19-03 wiring runFitnessBench;
 * FR-G6/FR-E2). The fitness harness (packages/gateway/src/fitness) has been
 * complete since W2-08 — fixture tasks, scoring, verdicts — and the matrix's
 * Fitness column honestly said "not benched" forever because NO producer was
 * wired to apps/server. This route is that producer: resolve the project's
 * configured model exactly the way a real run does, answer the role's
 * fixture tasks, and record the card in the global DB the roster already
 * reads (`listModelFitness`).
 *
 * Law 9a: tests inject `client` (the bench's own `ModelClient` seam) — the
 * live-provider binding below never runs under CI.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openGlobalDb, putModelFitness } from '@dokima/events';
import { runFitnessBench, NoFixtureTasksError, type ModelClient } from '@dokima/gateway';
import { computeFleetRegistryPath } from '../projects.js';
import { resolveModelTarget } from '../pipeline/model-resolution.js';
import { providerForConfig } from '../pipeline/gateway-model-port/provider.js';
import { targetToConfig } from '../pipeline/gateway-model-port/config.js';
import { badRequest, notFound } from './artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectRecord } from './board-project.js';

export interface ModelsBenchRouteOptions {
  home?: string;
  /** Test seam (law 9a): a scripted client instead of a live provider. */
  client?: ModelClient;
  /** Test seam: where the fitness card is written (defaults to the real global DB). */
  globalDbPath?: string;
  now?: () => string;
}

export function registerModelsBenchRoute(
  app: FastifyInstance,
  opts: ModelsBenchRouteOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  app.post(
    '/api/v1/projects/:id/models/bench',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const record = await resolveProjectRecord(registryPath, id);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${id}`));
      }
      const body = (request.body ?? {}) as { role?: unknown };
      const role =
        typeof body.role === 'string' && body.role ? body.role : 'coding-agent';

      let model: string;
      let client: ModelClient;
      if (opts.client) {
        client = opts.client;
        model = 'injected-test-model';
      } else {
        let target;
        try {
          target = await resolveModelTarget({
            projectPath: record.path,
            role,
            taskType: 'code',
            actorId: 'operator',
          });
        } catch (err) {
          return reply
            .code(422)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              badRequest(
                request,
                `no model could be resolved for ${role} — pick one in Settings → Models first (${(err as Error).message})`,
              ),
            );
        }
        model = target.model;
        const provider = await providerForConfig(targetToConfig(target, process.env));
        client = {
          respond: async (prompt: string) => {
            const response = await provider.chat({
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0,
            });
            return response.message.content;
          },
        };
      }

      try {
        const card = await runFitnessBench({
          model,
          role,
          client,
          now: opts.now,
        });
        const global = openGlobalDb(opts.globalDbPath);
        try {
          putModelFitness(global, {
            model: card.model,
            role: card.role,
            verdict: card.verdict,
            harnessVersion: card.harnessVersion,
            receiptPayload: card.taskResults,
            runAt: card.runAt,
          });
        } finally {
          global.close();
        }
        return reply.code(200).send({
          model: card.model,
          role: card.role,
          verdict: card.verdict,
          tasks: card.taskResults.map((t) => ({ id: t.taskId, passed: t.passed })),
        });
      } catch (err) {
        if (err instanceof NoFixtureTasksError) {
          return reply
            .code(422)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        throw err;
      }
    },
  );
}
