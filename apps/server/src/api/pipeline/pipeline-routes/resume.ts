/**
 * `POST /api/v1/projects/:id/pipeline/:runId/resume` (W10-67).
 *
 * Picks a paused run back up once its founder decisions are answered, WITHOUT
 * re-running the phase already paid for. The blueprint model call is the
 * expensive one and its input is persisted, so resuming re-synthesizes the
 * document for free (`synthesizeBlueprint` is pure), applies the answered
 * decisions to its markers, re-checks the gate against the REAL on-disk
 * ledger, and only then spends the two gateway calls the gate refused to
 * authorize the first time.
 *
 * THE LAW-4 PROPERTY THIS MUST NOT LOSE: the gate is re-run here, not
 * assumed. `applyDecisions` flips markers using D-ids that `decideSlate`
 * wrote to `docs/DECISIONS.md`, and `decideBlueprintUnlock` then cross-checks
 * every cited D-id against that same on-disk ledger — read server-side, never
 * from the request. A resume that trusted its own revision would be exactly
 * the self-attestation the run route's header spends a paragraph refusing.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openEventLog } from '@dokima/events';
import {
  buildTechnicalSlate,
  decideBlueprintUnlock,
  decompose,
  synthesizeBlueprint,
  UnresolvedFounderDecisionError,
} from '@dokima/pipeline';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { notFound } from '../../server/artifacts-helpers.js';
import { ensureOperatorIdentity } from '../../server/board-actor.js';
import { resolveProjectRecord, stateDbPath } from '../../server/board-project.js';
import { persistDecomposedPlan } from '../board-lifecycle.js';
import type { RealGatewayPort } from '../gateway-model-port.js';
import { applyDecisions, UndecidedSlateError } from './awaiting-decisions.js';
import { BUILD_PHASE_ID, emitPhaseEvent } from './events.js';
import { readLedgerMarkdown } from './ledger.js';
import { clearPausedRun, loadPausedRun } from './paused-run.js';
import { problemForError } from './problems.js';

export interface ResumeRouteOptions {
  readonly registryPath: string;
  readonly now: () => string;
  readonly resolvePort: (projectPath: string) => Promise<RealGatewayPort>;
}

export function registerResumeRoute(
  app: FastifyInstance,
  opts: ResumeRouteOptions,
): void {
  app.post(
    '/api/v1/projects/:id/pipeline/:runId/resume',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId, runId } = request.params as {
        id: string;
        runId: string;
      };
      const record = await resolveProjectRecord(opts.registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${projectId}`));
      }

      const paused = await loadPausedRun(record.path, runId);
      if (!paused) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no paused run ${runId} for this project`));
      }

      try {
        // Free: synthesis is pure, so the document comes back from the stored
        // input without another gateway call.
        const original = synthesizeBlueprint(paused.blueprintInput);
        const revisedDocument = applyDecisions(original.document, paused, record.path);

        const ledgerMarkdown = await readLedgerMarkdown(record.path);
        const gate = decideBlueprintUnlock(
          revisedDocument.markdown,
          ledgerMarkdown,
          BUILD_PHASE_ID,
        );
        if (!gate.allowed) {
          throw new UnresolvedFounderDecisionError(BUILD_PHASE_ID, gate.reasons);
        }

        const blueprint = { ...original, document: revisedDocument };
        const modelPort = await opts.resolvePort(record.path);
        const technicalSlate = buildTechnicalSlate(
          await modelPort.resolveTechnicalSlateInput(blueprint),
        );
        const plan = decompose(
          await modelPort.resolveTicketDrafts(blueprint, technicalSlate),
        );

        const log = openEventLog(stateDbPath(record.path));
        try {
          ensureOperatorIdentity(log, opts.now);
          emitPhaseEvent(
            log,
            { runId, now: opts.now },
            {
              kind: 'decisions-decided',
              slateTitle: technicalSlate.title,
            },
          );
          emitPhaseEvent(
            log,
            { runId, now: opts.now },
            {
              kind: 'decomposed',
              ticketCount: plan.tickets.length,
            },
          );
        } finally {
          log.close();
        }

        const accepted = await persistDecomposedPlan(record.path, plan, {
          runId,
          now: opts.now,
        });
        // Only after the board exists: a paused run removed before its plan
        // persisted would be unrecoverable, and re-running it would mean
        // paying for the blueprint call again.
        await clearPausedRun(record.path, runId);

        return reply.code(201).send({
          run_id: runId,
          resumed: true,
          plan: {
            tickets: plan.tickets,
            violations: plan.violations,
            mermaid: plan.mermaid,
          },
          plan_items: accepted.map((a) => ({
            id: a.item.id,
            catalog_id: a.item.catalogId,
            state: a.item.state,
            ticket_id: a.item.ticketId,
            ticket_created: a.ticketCreated,
          })),
        });
      } catch (err) {
        if (err instanceof UndecidedSlateError) {
          return reply.code(409).type(PROBLEM_CONTENT_TYPE).send({
            type: 'https://dokima.dev/errors/undecided-slate',
            title: 'Still awaiting a founder decision',
            status: 409,
            detail: err.message,
            instance: request.url,
            rule: 'UNDECIDED_SLATE',
          });
        }
        const problem = problemForError(err, request);
        if (problem) {
          return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem.body);
        }
        throw err;
      }
    },
  );
}
