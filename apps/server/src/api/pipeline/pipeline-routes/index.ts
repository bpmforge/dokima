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
 * `createRealGatewayPort` (a proper `@dokima/gateway` workspace import's
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
import {
  IncompleteInterviewSessionError,
  isInterviewComplete,
} from '@dokima/pipeline';
import { computeFleetRegistryPath } from '../../projects.js';
import { badRequest, notFound } from '../../server/artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { resolveProjectRecord } from '../../server/board-project.js';
import { InvalidPipelineRunRequestError } from '../errors.js';
import {
  createRealGatewayPort,
  resolveGatewayConfigForProject,
  type GatewayConfig,
  type RealGatewayPort,
} from '../gateway-model-port.js';
import { registerAdvanceRoute } from './advance.js';
import { registerOnboardRoute, type OnboardRoutesOptions } from './onboard.js';
import { problemForError } from './problems.js';
import { isValidRunId, loadRunRecord, saveRunRecord } from './paused-run.js';
import { executeRun, wireRunRecord } from './run-job.js';
import { registerResumeRoute } from './resume.js';
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
   * this defaults to `DOKIMA_SIGNING_KEY` when omitted. */
  signingKey?: string;
}

export function registerPipelineRoutes(
  app: FastifyInstance,
  opts: PipelineRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  const now = opts.now ?? (() => new Date().toISOString());
  /**
   * W10-69: resolve the model PER PROJECT, not from the environment.
   *
   * This used to be `resolveGatewayConfigFromEnv()`, which meant the creation
   * pipeline — the path behind "Build the board" — never read the provider
   * registry or the model matrix at all. `resolveGatewayConfigForProject` is
   * the resolution W10-03 exists to provide, and until now its only production
   * caller in the repo was `onboard-dispatch-port.ts` (wired by W10-45); this
   * call site was left behind, which is the same build-then-wire gap
   * W10_PLAN §6a traces the original defect to.
   *
   * Measured before the fix: a project configured through the Providers &
   * Models panel to `qwen/qwen3.5-9b`, verified persisted in `model_matrix`,
   * ran against a core with no `DOKIMA_MODEL_ID` and LM Studio received
   * `"model": "local-model"` — `envTarget`'s hardcoded default. No error and
   * no effect, which is precisely why it survived a full browser session and
   * five model-selection tickets stacked on top of it.
   *
   * `opts.gatewayConfig` still wins, deliberately: the e2e fake-model gateway
   * and every route test inject it, and that override is a documented CI seam
   * (Law 9). The env config remains reachable underneath — with no registry
   * configured, `resolveGatewayConfigForProject` falls back to it, so a
   * first-run project keeps working with nothing set up (C-1).
   */
  const resolvePort =
    opts.modelPortFactory ??
    (async (projectPath: string) =>
      createRealGatewayPort(
        opts.gatewayConfig ?? (await resolveGatewayConfigForProject(projectPath)),
      ));

  registerOnboardRoute(app, {
    home: opts.home,
    gatewayConfig: opts.onboardGatewayConfig,
    now: opts.now,
  });
  registerAdvanceRoute(app, { home: opts.home, signingKey: opts.signingKey });
  registerResumeRoute(app, { registryPath, now, resolvePort });

  /**
   * W10-58: one in-flight run per project, keyed by project id.
   *
   * Not a nicety — C-6 is single-writer-per-project-DB, and a background run
   * appends events for minutes. Two concurrent runs on one project would be two
   * writers by construction. Refusing the second is also the honest product
   * answer: the founder has one board being built, and a second "Build" click
   * should tell them so rather than silently starting a rival run whose plan
   * will overwrite the first one's.
   */
  const inFlight = new Map<string, string>();

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

      const running = inFlight.get(projectId);
      if (running) {
        return reply
          .code(409)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(
              request,
              `run ${running} is already building this project's board — wait for it or read its progress at /api/v1/projects/${projectId}/pipeline/runs/${running}`,
            ),
          );
      }

      // EVERYTHING ABOVE IS CHEAP AND STAYS SYNCHRONOUS. Validation failures are
      // still 400/404/422 on this response, exactly as before — only the part
      // that costs gateway calls moves off the request.
      const runId = randomUUID();
      const startedAt = now();
      await saveRunRecord(record.path, {
        runId,
        blueprintTitle: body.blueprintTitle,
        status: 'running',
        startedAt,
        updatedAt: startedAt,
        phases: [],
      });
      inFlight.set(projectId, runId);

      // Deliberately not awaited: this is the ticket. `void` plus a `.finally`
      // that always clears the in-flight slot, so a throw inside the job can
      // never wedge the project into "a run is already going" forever.
      void executeRun({
        projectPath: record.path,
        runId,
        body,
        now,
        resolvePort,
        request,
      }).finally(() => inFlight.delete(projectId));

      return reply.code(202).send({ status: 'running', run_id: runId });
    },
  );

  /**
   * The other half of the job contract: the run's own progress, readable at any
   * time. Polled by `apps/web/src/onboarding/api.ts`.
   *
   * HANDOFF (MASTER_PROMPT step 3) — this is polling because the push wire does
   * not exist and could not be built here. `WsHub.publish(sub, type, data)` is
   * already generic and `events-sse.ts` already reuses it, but `server.ts`
   * passes `wsHub` to `registerBoardRoutes`/`registerHealthz`/
   * `registerEventsSseRoute` and NOT to `registerPipelineRoutes`, and
   * `apps/server/src/api/server.ts` is outside this ticket's write_scope. The
   * one-line change that would upgrade this to real per-phase push is:
   *
   *     registerPipelineRoutes(app, { ..., wsHub });
   *
   * plus threading `wsHub` into `PipelineRoutesOptions` and calling
   * `wsHub.publish(`pipeline:${projectId}`, 'pipeline.stage.completed', ...)`
   * beside the `emitStageEvent` call in `executeRun`. Deliberately NOT done by
   * widening write_scope from inside the ticket (W8-06: a maker cannot grant
   * itself permission and then bless the grant with a validator it controls).
   */
  app.get(
    '/api/v1/projects/:id/pipeline/runs/:runId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId, runId } = request.params as {
        id: string;
        runId: string;
      };
      const record = await resolveProjectRecord(registryPath, projectId);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${projectId}`));
      }
      if (!isValidRunId(runId)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, `malformed run id ${runId}`));
      }
      const run = await loadRunRecord(record.path, runId);
      if (!run) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no run ${runId} for project ${projectId}`));
      }
      return reply.code(200).send(wireRunRecord(run));
    },
  );
}

