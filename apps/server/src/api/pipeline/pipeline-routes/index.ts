/**
 * `POST /api/v1/projects/:id/pipeline/run` — starts and advances one
 * pipeline run: interview -> blueprint -> decisions -> decompose -> board
 * (BLUEPRINT §4, W5-17's `runPipeline`).
 *
 * `runPipeline` and its `PipelineModelPort` are synchronous by design
 * (`packages/pipeline/src/run/types.ts`: the package stays dependency-free,
 * so every model-authored seam is an injected pure function) — but a real
 * gateway call is inherently async. This route resolves the three port
 * outputs in an async PRE-FLIGHT pass (`./preflight.js`: gateway call ->
 * pure phase replay -> next gateway call, threading real content exactly
 * the way `runPipeline` itself does internally), then calls the real,
 * synchronous `runPipeline` with a trivial port that just returns the
 * already-resolved values. Since `synthesizeBlueprint`/`buildTechnicalSlate`/
 * `decompose` are pure and deterministic, `runPipeline`'s internal
 * recomputation from the same inputs is bit-identical to this pass's — this
 * is a replay, not a second, divergent implementation of the orchestrator.
 *
 * On acceptance criterion #1's "REAL gateway client injected as the model
 * port": the object passed as `runPipeline`'s `port.model` is a cache of
 * already-resolved values, not the gateway client itself — the direct,
 * unavoidable consequence of `PipelineModelPort` being synchronous (a
 * package-boundary constraint fixed by W5-17, out of this ticket's reach)
 * while a gateway call is inherently async. Every value in that cache was
 * produced by a REAL call through `../gateway-model-port.js`'s
 * `createRealGatewayPort` (a proper `@shipwright/gateway` workspace import's
 * `createOaiCompatProvider`, never a direct provider — Law 6 holds) in the
 * pre-flight immediately above.
 *
 * SELF-ATTEST FIX (Law 4/C-3, the whole point of this ticket): the request
 * body never carries a `ledgerMarkdown` field (`./request-body.js` has no
 * such field in its type or parser). `./ledger.js`'s `readLedgerMarkdown`
 * reads the real, persisted per-project `docs/DECISIONS.md` off disk —
 * trusted server state an agent session posting this body has no way to
 * influence — and that is the ONLY value ever passed to
 * `assertDecisionComplete`/`runPreflight`/`runPipeline`'s `ledgerMarkdown`.
 * `synth.ts` concatenates a blueprint section's `body` into the final
 * markdown unsanitized, so a compromised model response can still smuggle a
 * `FOUNDER-DECISION: key RESOLVED D-999` marker into a section body — this
 * is the "planted self-attest" case, acceptance criterion 2b. It is
 * rejected because `decideBlueprintUnlock` never trusts that marker, it
 * cross-checks the cited D-ID against the real, on-disk `ledgerMarkdown`.
 * The gate is checked BOTH in the pre-flight (fail fast, before spending a
 * technical-slate gateway call) AND again inside `runPipeline` itself
 * (defense in depth).
 *
 * SECURITY_W5 CRITICAL FIX: every `PipelineRunEvent` `runPipeline` emits is
 * appended as a plain, hash-chained AUDIT event (`./events.js`'s
 * `emitPhaseEvent`) — it is NOT anchored by a `gate` receipt. No independent
 * validator runs on this model-authored phase output, so minting a "passing"
 * gate receipt for it would be self-attestation (Law 4/5). Genuine gates
 * (decision-complete, close) mint real receipts elsewhere, from real checks,
 * by a distinct verifier identity. Board items (the `decomposed` phase's
 * real durable output) are only ever persisted (`../board-lifecycle.js`)
 * after the full `runPipeline` call has succeeded.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openEventLog } from '@shipwright/events';
import {
  IncompleteInterviewSessionError,
  isInterviewComplete,
  runPipeline,
  type DecomposedPlan,
  type PipelinePort,
} from '@shipwright/pipeline';
import { computeFleetRegistryPath } from '../../projects.js';
import { badRequest, notFound } from '../../server/artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { resolveProjectRecord, stateDbPath } from '../../server/board-project.js';
import { ensureOperatorIdentity } from '../../server/board-actor.js';
import {
  persistDecomposedPlan,
  type AcceptedDecomposedPlanItem,
} from '../board-lifecycle.js';
import { InvalidPipelineRunRequestError } from '../errors.js';
import {
  createRealGatewayPort,
  resolveGatewayConfigFromEnv,
  type GatewayConfig,
  type RealGatewayPort,
} from '../gateway-model-port.js';
import { registerAdvanceRoute } from './advance.js';
import { emitPhaseEvent } from './events.js';
import { readLedgerMarkdown } from './ledger.js';
import { registerOnboardRoute, type OnboardRoutesOptions } from './onboard.js';
import { problemForError } from './problems.js';
import { runPreflight } from './preflight.js';
import { parseRequestBody, type RunPipelineRequestBody } from './request-body.js';

export interface PipelineRoutesOptions {
  home?: string;
  /** Overrides the default env-resolved gateway config — tests point this at a fake HTTP server. */
  gatewayConfig?: GatewayConfig;
  /** Overrides the port entirely — tests that want to skip the real dynamic-import wiring. */
  modelPortFactory?: () => Promise<RealGatewayPort>;
  /** Injectable clock (TESTING.md §2). */
  now?: () => string;
  /** Overrides the onboard route's real gateway config — tests point this at a fake HTTP server. */
  onboardGatewayConfig?: OnboardRoutesOptions['gatewayConfig'];
  /** Keychain-resolved minting secret threaded to the advance route's `verifyReceipt`
   * calls (FR-S2) — see `./advance.js`'s `AdvanceRouteOptions.signingKey` doc for why
   * this defaults to `SHIPWRIGHT_SIGNING_KEY` when omitted. */
  signingKey?: string;
}

export function registerPipelineRoutes(
  app: FastifyInstance,
  opts: PipelineRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  const now = opts.now ?? (() => new Date().toISOString());
  const resolvePort =
    opts.modelPortFactory ??
    (() => createRealGatewayPort(opts.gatewayConfig ?? resolveGatewayConfigFromEnv()));

  registerOnboardRoute(app, {
    home: opts.home,
    gatewayConfig: opts.onboardGatewayConfig,
    now: opts.now,
  });
  registerAdvanceRoute(app, { home: opts.home, signingKey: opts.signingKey });

  app.post(
    '/api/v1/projects/:id/pipeline/run',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${projectId}`));
      }

      let body: RunPipelineRequestBody;
      try {
        body = parseRequestBody(request.body);
      } catch (err) {
        if (err instanceof InvalidPipelineRunRequestError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        throw err;
      }

      if (!isInterviewComplete(body.interviewSession)) {
        const problem = problemForError(new IncompleteInterviewSessionError(), request);
        return reply.code(problem!.status).type(PROBLEM_CONTENT_TYPE).send(problem!.body);
      }

      let plan: DecomposedPlan;
      try {
        const ledgerMarkdown = await readLedgerMarkdown(record.path);
        const modelPort = await resolvePort();
        const preflight = await runPreflight(modelPort, body, ledgerMarkdown);

        const runId = randomUUID();
        const dbPath = stateDbPath(record.path);
        const log = openEventLog(dbPath);
        try {
          ensureOperatorIdentity(log, now);
          const port: PipelinePort = {
            model: {
              blueprintInputFrom: () => preflight.blueprintInput,
              technicalSlateInputFrom: () => preflight.technicalSlateInput,
              ticketDraftsFrom: () => preflight.ticketDrafts,
            },
            emit: (event) => emitPhaseEvent(log, { runId, now }, event),
          };
          plan = runPipeline(
            {
              interviewSession: body.interviewSession,
              blueprintTitle: body.blueprintTitle,
              ledgerMarkdown,
            },
            port,
          );
        } finally {
          log.close();
        }

        const accepted = await persistDecomposedPlan(record.path, plan, { runId, now });
        return reply.code(201).send({
          run_id: runId,
          plan: {
            tickets: plan.tickets,
            violations: plan.violations,
            mermaid: plan.mermaid,
          },
          plan_items: accepted.map(wireAcceptedItem),
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

function wireAcceptedItem(accepted: AcceptedDecomposedPlanItem) {
  return {
    id: accepted.item.id,
    catalog_id: accepted.item.catalogId,
    state: accepted.item.state,
    ticket_id: accepted.item.ticketId,
    ticket_created: accepted.ticketCreated,
  };
}
