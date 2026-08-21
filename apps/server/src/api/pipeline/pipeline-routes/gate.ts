/**
 * `POST /api/v1/projects/:id/phases/:n/gate` (W16-07, FR-P1, BLUEPRINT §3.2)
 * — the gate-receipt MINTER, finally reachable.
 *
 * `runPhaseGate` (W9-06) has been the only path from a validator run to a
 * gate receipt since it landed, and nothing in production ever called it:
 * the advance route verified receipts nothing could mint, so every real
 * `POST /phases/:n/advance` refused forever. This route is the missing
 * first half of the flow — run the phase's declared validators for real
 * against the on-disk deliverables, mint under the distinct verifier
 * identity (Law 5), hand back the receipt id for the advance call.
 *
 * `authorActorId` comes from the request body: it is WHO AUTHORED the
 * deliverables being gated, and Law 5 refuses it equal to the verifier —
 * the route never guesses it from the session, because the requester and
 * the author are routinely different parties (a person gating an agent's
 * phase output is the normal case).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openEventLog } from '@dokima/events';
import { getPhase, UnknownPhaseError, type PhaseId } from '@dokima/pipeline';
import { resolveAsset } from '@dokima/shared';
import { computeFleetRegistryPath } from '../../projects.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { badRequest } from '../../server/artifacts-helpers.js';
import { resolveProjectOrProblem, stateDbPath } from '../../server/board-project.js';
import {
  PhaseGateSameIdentityError,
} from '../phase-gate/identity.js';
import { runPhaseGate } from '../phase-gate/runner.js';
import { problemForError } from './problems.js';

export interface GateRouteOptions {
  /** Fleet registry home dir override — tests only. */
  home?: string;
  /** Same resolution as the advance route: keychain-resolved secret, env seam for tests/CI. */
  signingKey?: string;
  /** Validator executables dir — production resolves the imported content pack; tests point at a fixture. */
  contentDir?: string;
}

export function registerGateRoute(
  app: FastifyInstance,
  opts: GateRouteOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  app.post(
    '/api/v1/projects/:id/phases/:n/gate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId, n } = request.params as { id: string; n: string };
      const record = await resolveProjectOrProblem(
        request,
        reply,
        registryPath,
        projectId,
      );
      if (!record) return;

      const phaseIdRaw = Number(n);
      if (!Number.isInteger(phaseIdRaw)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, `invalid phase id: ${n}`));
      }
      try {
        getPhase(phaseIdRaw as PhaseId);
      } catch (err) {
        if (err instanceof UnknownPhaseError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        throw err;
      }

      const body = (request.body ?? {}) as { authorActorId?: unknown };
      if (typeof body.authorActorId !== 'string' || body.authorActorId.trim() === '') {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(
              request,
              '"authorActorId" (who authored the phase deliverables) is required — Law 5 compares it against the verifier identity',
            ),
          );
      }

      const signingKey = opts.signingKey ?? process.env.DOKIMA_SIGNING_KEY ?? '';
      const contentDir = opts.contentDir ?? resolveAsset('content', 'validators');
      const dbPath = stateDbPath(record.path);
      const log = openEventLog(dbPath);
      try {
        const result = await runPhaseGate(
          log,
          {
            projectId,
            phaseId: phaseIdRaw as PhaseId,
            contentDir,
            projectRoot: record.path,
            authorActorId: body.authorActorId,
          },
          { signingKey },
        );
        // FR-P3's wire discipline, same as advance: reasons travel intact on
        // both paths, never collapsed to a bare status.
        return reply.code(result.ok ? 200 : 422).send({
          ok: result.ok,
          phase_id: result.phaseId,
          receipt_id: result.receipt?.id ?? null,
          reasons: result.reasons,
          validators: result.results.map((r) => ({
            name: r.name,
            exit_code: r.exitCode,
            gap_count: r.gapCount,
          })),
        });
      } catch (err) {
        // Law 5 mechanical refusal: the author cannot be the verifier — a
        // clean 422 with the sentence, never an uncaught 500.
        if (err instanceof PhaseGateSameIdentityError) {
          return reply
            .code(422)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        const problem = problemForError(err, request);
        if (problem) {
          return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem.body);
        }
        throw err;
      } finally {
        log.close();
      }
    },
  );
}
