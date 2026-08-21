/**
 * `POST /api/v1/projects/:id/phases/:n/advance` (W9-07, FR-P1/P2/P3, BLUEPRINT
 * §3.2 "Gate mechanism") — the phase-advance decision, wired for real.
 *
 * This route is a thin caller around `@dokima/pipeline`'s `decideAdvance`
 * (packages/pipeline/src/phases/advance.ts). That module's own logic is
 * already pinned by `advance.test.ts` and is NOT reimplemented or duplicated
 * here (Law 4/6 — "do not cheat the trust machine"; never let a component
 * verify its own output). The only job of this file is to bind
 * `AdvanceDeps.verifyReceipt` to the REAL `@dokima/events` `verifyReceipt`,
 * closed over:
 *
 *   - the project's real `.dokima/state.db`, opened READ-ONLY
 *     (`openEventLogReader`) — `decideAdvance`/`verifyReceipt` never write;
 *     W9-06's `runPhaseGate` (a distinct writer, run separately) is the only
 *     thing that ever mints a gate receipt;
 *   - the phase's CURRENT deliverable content, read fresh off disk on every
 *     request via the exact same `readPhaseInputFiles` W9-06's runner uses
 *     (`../phase-gate/input-files.js`) — never content the caller POSTs.
 *     FR-P2's entire point is catching a silently edited doc; that is
 *     impossible if a caller could supply its own "current" content instead;
 *   - the keychain-resolved minting secret (FR-S2).
 *
 * Per `advance.ts`'s own `AdvanceDeps.verifyReceipt` doc, `decideAdvance`
 * itself chooses which required-validator set to pass on each call —
 * `fromPhase.validators` (read live off `PHASES` on every call, never
 * frozen) for the gate receipt, `[]` for a waiver receipt. This file never
 * makes that choice; it only supplies the verification primitive.
 *
 * PRODUCTION CAVEAT — read before assuming a real advance ever succeeds:
 * every phase's declared validator set unconditionally includes
 * `validate-mermaid` (R-H3, `packages/pipeline/src/phases/topology.ts`), and
 * the real, unmodified `content/validators/validate-mermaid.sh` currently
 * emits zero-byte stdout on a genuinely clean scan, which
 * `parseValidatorOutput` maps to `null` and `packages/validators/src/run.ts`
 * normalizes to `exitCode: 2` — never 0 (see `../phase-gate/runner.ts`'s own
 * module header and `../phase-gate/runner.test.ts`, both confirmed
 * empirically). W9-06's `runPhaseGate` therefore cannot mint a clean gate
 * receipt against real, unmodified content today, so THIS route will refuse
 * every real advance in production until W9-08 (a content-pack re-sign,
 * filed and separately blocked) lands. That is a disclosed gap in the
 * validator content, not a bug in this route or in `decideAdvance` — and
 * deliberately NOT special-cased around here (no `exitCode === 2` bypass):
 * doing so would make a permanently-refusing gate look green, exactly the
 * failure this whole arc exists to prevent.
 *
 * Auth: registered via `registerAdvanceRoute` from `./index.ts`'s
 * `registerPipelineRoutes`, which `server.ts` (outside this ticket's
 * write_scope) calls AFTER `registerAuthHook` — the app-wide SC-08/D-005
 * `onRequest` hook already covers every `/api/**` path, this route
 * included. No per-route `preHandler` is added here (unlike
 * `decisions/routes.ts`, which is deliberately NOT wired into `server.ts`
 * and so needs its own — `registerPipelineRoutes` IS wired in `server.ts`).
 */
import {
  openEventLogReader,
  verifyReceipt,
  type EventLog,
  type ReceiptInputFile,
} from '@dokima/events';
import {
  decideAdvance,
  getPhase,
  isLastPhase,
  nextPhase,
  UnknownPhaseError,
  type AdvanceDeps,
  type AdvanceResult,
  type PhaseId,
} from '@dokima/pipeline';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../../projects.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { badRequest } from '../../server/artifacts-helpers.js';
import { resolveProjectOrProblem, stateDbPath } from '../../server/board-project.js';
import {
  PhaseDeliverableMissingError,
  readPhaseInputFiles,
} from '../phase-gate/input-files.js';
import { problemForError } from './problems.js';
import { evaluateResearchGate } from './research-gate.js';

export interface AdvanceRouteOptions {
  /** Fleet registry home dir override — tests only. */
  home?: string;
  /**
   * Keychain-resolved minting secret (FR-S2, law #8) — same value
   * `verifyReceipt`/`mintReceipt` and the CLI's `--signing-key` use.
   * `server.ts`'s existing `registerPipelineRoutes(app, { home: opts.fleetHome })`
   * call sits outside this ticket's write_scope and does not thread a
   * signing key through, so this defaults to `DOKIMA_SIGNING_KEY`
   * (mirrors `apps/server/src/api/main.ts`'s own resolution of the same env
   * var). Absent/empty at request time surfaces as `SigningKeyRequiredError`
   * -> 503 (already wired in `./problems.js`) — fail-closed, never a
   * silently-forgeable empty key.
   */
  signingKey?: string;
}

interface AdvanceRequestBody {
  readonly gateReceiptId: string | null;
  readonly waiverReceiptId: string | null;
}

function isValidReceiptIdField(value: unknown): value is string | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

function parseAdvanceBody(body: unknown): AdvanceRequestBody | undefined {
  const b = (body ?? {}) as Record<string, unknown>;
  if (
    !isValidReceiptIdField(b.gateReceiptId) ||
    !isValidReceiptIdField(b.waiverReceiptId)
  ) {
    return undefined;
  }
  return {
    gateReceiptId: (b.gateReceiptId as string | null | undefined) ?? null,
    waiverReceiptId: (b.waiverReceiptId as string | null | undefined) ?? null,
  };
}

/**
 * FR-P3 wire shape: `reasons` travels intact from `AdvanceResult` straight
 * onto the response body, on both the allowed and the refused path — never
 * collapsed to a bare status code or a boolean.
 */
function wireAdvanceResult(result: AdvanceResult) {
  return {
    allowed: result.allowed,
    from_phase_id: result.fromPhaseId,
    to_phase_id: result.toPhaseId,
    waived: result.waived,
    reasons: result.reasons,
  };
}

export function registerAdvanceRoute(
  app: FastifyInstance,
  opts: AdvanceRouteOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  app.post(
    '/api/v1/projects/:id/phases/:n/advance',
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

      let phase;
      try {
        phase = getPhase(phaseIdRaw as PhaseId);
      } catch (err) {
        if (err instanceof UnknownPhaseError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        throw err;
      }

      // decideAdvance itself throws on this ("impossible request", per its own
      // doc comment) — checked here so the route never depends on parsing a
      // thrown error's message text to produce a clean 400.
      if (isLastPhase(phase.id)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(
              request,
              `phase ${phase.id} (${phase.name}) is the last phase — no advance`,
            ),
          );
      }

      const body = parseAdvanceBody(request.body);
      if (!body) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            badRequest(
              request,
              '"gateReceiptId"/"waiverReceiptId" must each be a non-empty string or null',
            ),
          );
      }

      const toPhase = nextPhase(phase.id);

      // decideAdvance only ever calls deps.verifyReceipt at all when
      // gateReceiptId is present (a null gateReceiptId short-circuits to a
      // refusal before either receipt is looked at, advance.ts:85-89) — so
      // the current input tree is read fresh off disk only when it will
      // actually be needed, not unconditionally on every request. This also
      // means a fresh project with no deliverables written yet still gets
      // the correct "no gate receipt" refusal instead of a spurious
      // file-not-found error.
      let currentInputFiles: readonly ReceiptInputFile[] = [];
      if (body.gateReceiptId) {
        // W16-05 (FR-P8/FR-P4, US-105 AC-2): the research gate — every report
        // this phase declared must pass its validator with its RECORDED
        // Challenger verdicts before any receipt is even looked at. An
        // unchallenged or CONTRADICTED HIGH claim refuses here, in the same
        // reasons shape as every other refusal.
        const researchReasons = await evaluateResearchGate(record.path, phase.id);
        if (researchReasons.length > 0) {
          return reply.code(422).send(
            wireAdvanceResult({
              allowed: false,
              fromPhaseId: phase.id,
              toPhaseId: toPhase.id,
              waived: false,
              reasons: researchReasons,
            }),
          );
        }
        try {
          currentInputFiles = await readPhaseInputFiles(phase, record.path);
        } catch (err) {
          if (err instanceof PhaseDeliverableMissingError) {
            // FR-P3: folded into the same AdvanceResult reasons shape as any
            // other refusal — a deliverable vanishing off disk is exactly
            // the class of "why this receipt is no longer trustworthy" the
            // UI needs to render, not a distinct error type.
            return reply.code(422).send(
              wireAdvanceResult({
                allowed: false,
                fromPhaseId: phase.id,
                toPhaseId: toPhase.id,
                waived: false,
                reasons: [err.message],
              }),
            );
          }
          throw err;
        }
      }

      const signingKey = opts.signingKey ?? process.env.DOKIMA_SIGNING_KEY ?? '';
      const dbPath = stateDbPath(record.path);
      const db = openEventLogReader(dbPath);
      try {
        const log: EventLog = { db, path: dbPath, close: () => db.close() };
        const deps: AdvanceDeps = {
          verifyReceipt: (receiptId, requiredValidators) =>
            verifyReceipt(log, receiptId, {
              signingKey,
              inputFiles: currentInputFiles,
              requiredValidators,
            }),
        };

        const result = decideAdvance(
          {
            fromPhaseId: phase.id,
            gateReceiptId: body.gateReceiptId,
            waiverReceiptId: body.waiverReceiptId,
          },
          deps,
        );
        return reply.code(result.allowed ? 200 : 422).send(wireAdvanceResult(result));
      } catch (err) {
        const problem = problemForError(err, request);
        if (problem) {
          return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem.body);
        }
        throw err;
      } finally {
        db.close();
      }
    },
  );
}
