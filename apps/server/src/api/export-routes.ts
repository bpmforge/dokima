/**
 * Board export/import bundle routes (BLUEPRINT §12.8, ROADMAP W8 exit
 * criterion "export/import round-trips with chain verification"):
 *   GET  /api/v1/projects/:id/export  — bundle the project's durable state
 *     (events + identities + receipts, DATABASE.md §2) as portable JSON.
 *   POST /api/v1/projects/:id/import  — restore a bundle into an *empty*
 *     project, verifying the hash chain before and after write, and
 *     returning the reconstructed board projection as proof.
 *
 * WIRED into `apps/server/src/api/server.ts` as of 2026-07-27, closing
 * ROADMAP's W8 exit criterion in the product rather than only at module
 * level. **Conditionally**: registration is skipped entirely unless a
 * `signingKey` is configured (`DOKIMA_SIGNING_KEY`, same env var the
 * CLI's `run resume` uses). `POST /import` replays each receipt's anchor
 * MAC with that key, so a route registered with an empty key would let
 * anyone holding the Bearer token forge matching MACs and plant receipts —
 * a missing endpoint is safe, an unverifiable one is not.
 *
 * Historical note, kept because it was wrong in a way worth remembering:
 * this comment previously called wiring "a one-line follow-up." It was not.
 * `ExportRoutesOptions.signingKey` is required, and `server.ts` had no
 * signing-key resolution at all — the secret had to be threaded through
 * `BuildApiServerOptions` and `main.ts` first. Estimates written from the
 * route's own side missed the caller's missing dependency.
 *
 * Every route runs its own auth `preHandler` (SC-08/D-005), same precedent
 * as `decisions/routes.ts`, so these routes are self-protecting regardless
 * of whether/when `server.ts` registers them.
 */
import { openEventLog, openEventLogReader } from '@dokima/events';
import { computeBoard, loadTickets } from '@dokima/tickets';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { checkAuth, type AuthPluginOptions } from './auth-plugin.js';
import {
  BundleValidationError,
  ChainVerificationFailedError,
  NonEmptyImportTargetError,
  ReceiptAnchorVerificationFailedError,
  buildExportBundle,
  importExportBundle,
  validateExportBundle,
} from './export-bundle.js';
import { PROBLEM_CONTENT_TYPE, problem } from './problem.js';
import { computeFleetRegistryPath } from './projects.js';
import { resolveProjectRecord, stateDbPath } from './server/board-project.js';

export interface ExportRoutesOptions {
  /** Fleet registry home dir override — tests only. */
  home?: string;
  /** SC-08/D-005 auth, same shape `server.ts` builds for `registerAuthHook` — required, never optional. */
  auth: AuthPluginOptions;
  /**
   * Same keychain-resolved minting secret `mintReceipt`/`verifyReceipt` use
   * (FR-S2, law #8) — required so `/import` can replay the receipt anchor
   * check (a Bearer token alone must never be enough to plant a receipt).
   */
  signingKey: string;
}

function requireAuth(auth: AuthPluginOptions) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<undefined> => {
    const result = checkAuth(
      {
        host: request.headers.host,
        origin: request.headers.origin,
        url: request.url,
        authorization: request.headers.authorization,
      },
      auth,
    );
    if (result.ok) return;
    if (result.status === 403) {
      await reply
        .code(403)
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          problem({
            type: 'https://dokima.dev/errors/forbidden-host',
            title: 'Forbidden',
            status: 403,
            detail: `${result.reason === 'host' ? 'Host' : 'Origin'} header is not an allowed localhost origin (SC-08)`,
            instance: request.url,
            requestId: request.id.toString(),
            rule: 'SC-08',
          }),
        );
      return;
    }
    await reply
      .code(401)
      .type(PROBLEM_CONTENT_TYPE)
      .send(
        problem({
          type: 'https://dokima.dev/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'Authorization: Bearer <token> is required (D-005)',
          instance: request.url,
          requestId: request.id.toString(),
          rule: 'D-005',
        }),
      );
  };
}

function notFoundProblem(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://dokima.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

function badRequestProblem(
  request: FastifyRequest,
  detail: string,
  evidence?: Record<string, unknown>,
) {
  return problem({
    type: 'https://dokima.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
    ...(evidence ? { evidence } : {}),
  });
}

function conflictProblem(
  request: FastifyRequest,
  detail: string,
  evidence?: Record<string, unknown>,
) {
  return problem({
    type: 'https://dokima.dev/errors/conflict',
    title: 'Refused',
    status: 409,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
    ...(evidence ? { evidence } : {}),
  });
}

export function registerExportRoutes(
  app: FastifyInstance,
  opts: ExportRoutesOptions,
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  const auth = requireAuth(opts.auth);

  async function projectOr404(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
  ) {
    const record = await resolveProjectRecord(registryPath, projectId);
    if (!record) {
      await reply
        .code(404)
        .type(PROBLEM_CONTENT_TYPE)
        .send(notFoundProblem(request, `no project registered with id ${projectId}`));
      return undefined;
    }
    return record;
  }

  app.get(
    '/api/v1/projects/:id/export',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      const db = openEventLogReader(stateDbPath(record.path));
      try {
        const log = { db, path: stateDbPath(record.path), close: () => db.close() };
        const bundle = buildExportBundle(log, { projectId });
        return reply.send(bundle);
      } finally {
        db.close();
      }
    },
  );

  app.post(
    '/api/v1/projects/:id/import',
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await projectOr404(request, reply, projectId);
      if (!record) return;

      let bundle;
      try {
        bundle = validateExportBundle(request.body);
      } catch (err) {
        if (err instanceof BundleValidationError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequestProblem(request, err.message, { reasons: err.reasons }));
        }
        throw err;
      }

      const log = openEventLog(stateDbPath(record.path));
      try {
        const result = importExportBundle(log, bundle, { signingKey: opts.signingKey });
        const board = computeBoard(Array.from(loadTickets(log).values()));
        return reply.code(201).send({
          identities_imported: result.identitiesImported,
          events_imported: result.eventsImported,
          receipts_imported: result.receiptsImported,
          chain: result.chain,
          board,
        });
      } catch (err) {
        if (err instanceof NonEmptyImportTargetError) {
          return reply
            .code(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              conflictProblem(request, err.message, {
                existing_event_count: err.existingEventCount,
              }),
            );
        }
        if (err instanceof ChainVerificationFailedError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              badRequestProblem(request, err.message, {
                broken_at_seq: err.result.brokenAtSeq,
                reason: err.result.reason,
              }),
            );
        }
        if (err instanceof ReceiptAnchorVerificationFailedError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              badRequestProblem(request, err.message, {
                unanchored_receipt_ids: err.receiptIds,
              }),
            );
        }
        throw err;
      } finally {
        log.close();
      }
    },
  );
}
