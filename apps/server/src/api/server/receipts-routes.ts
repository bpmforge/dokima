/**
 * Receipt Inspector routes (FR-C5; UX_SPEC §5). Receipts are real DB rows
 * (`packages/events/migrations/002_receipts.sql`) — this is the one part of
 * the artifact/receipt surface with a durable backing store, so these
 * routes read straight through `@dokima/events`'s `getReceipt`.
 *
 * The `approvals_ledger` table (DATABASE.md §4, FR-N3) has no migration
 * anywhere in `packages/events/migrations/` yet (only 001_init/002_receipts
 * exist, grep-verified) — no code mints a row into it. Querying a table
 * that doesn't exist would throw; honestly reporting an empty ledger (never
 * fabricating rows, C-1) is the correct degrade until the owning ticket
 * adds the migration. HANDOFF: wire this route to the real table then.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getReceipt, openEventLogReader, type ReceiptRecord } from '@dokima/events';
import { computeFleetRegistryPath } from '../projects.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectOrProblem, stateDbPath } from './board-project.js';
import { notFound, badRequest } from './artifacts-helpers.js';

function wireReceipt(record: ReceiptRecord) {
  return {
    id: record.id,
    kind: record.kind,
    project_id: record.projectId,
    phase: record.phase,
    ticket_id: record.ticketId,
    validators: record.validators,
    input_tree_hash: record.inputTreeHash,
    verify_command: record.verifyCommand,
    verify_exit: record.verifyExit,
    signed_by: record.signedBy,
    payload: record.payload,
    created_at: record.createdAt,
  };
}

interface ReceiptRow {
  id: string;
}

export interface ReceiptRoutesOptions {
  /** Overrides `computeFleetRegistryPath()` — tests only. */
  home?: string;
}

export function registerReceiptRoutes(
  app: FastifyInstance,
  opts: ReceiptRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  async function projectPathOrProblem(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
  ): Promise<string | undefined> {
    const record = await resolveProjectOrProblem(request, reply, registryPath, projectId);
    if (!record) return undefined;
    return record.path;
  }

  /** `GET /api/v1/receipts/:id?project=` (API_DESIGN §2 "phases, gates, waivers"). */
  app.get(
    '/api/v1/receipts/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { project?: string };
      if (!query.project) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"project" query param is required'));
      }
      const projectPath = await projectPathOrProblem(request, reply, query.project);
      if (!projectPath) return;

      const db = openEventLogReader(stateDbPath(projectPath));
      try {
        const log = { db, path: stateDbPath(projectPath), close: () => db.close() };
        const record = getReceipt(log, id);
        if (!record) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(notFound(request, `no receipt with id ${id}`));
        }
        return reply.send(wireReceipt(record));
      } finally {
        db.close();
      }
    },
  );

  /** `GET /api/v1/projects/:id/receipts?kind=&ticket=` — receipts-list pane (UX_SPEC §2b "No gates have run yet"). */
  app.get(
    '/api/v1/projects/:id/receipts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await projectPathOrProblem(request, reply, id);
      if (!projectPath) return;
      const query = request.query as { kind?: string; ticket?: string };

      const db = openEventLogReader(stateDbPath(projectPath));
      try {
        const log = { db, path: stateDbPath(projectPath), close: () => db.close() };
        const clauses: string[] = [];
        const params: string[] = [];
        if (query.kind) {
          clauses.push('kind = ?');
          params.push(query.kind);
        }
        if (query.ticket) {
          clauses.push('ticket_id = ?');
          params.push(query.ticket);
        }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = db
          .prepare<string[], ReceiptRow>(
            `SELECT id FROM receipts ${where} ORDER BY created_at DESC`,
          )
          .all(...params);
        const items = rows
          .map((row) => getReceipt(log, row.id))
          .filter((r): r is ReceiptRecord => Boolean(r))
          .map(wireReceipt);
        return reply.send({ items });
      } finally {
        db.close();
      }
    },
  );

  /** `GET /api/v1/projects/:id/approvals-ledger` (FR-N3) — see module header: no producer yet. */
  app.get(
    '/api/v1/projects/:id/approvals-ledger',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await projectPathOrProblem(request, reply, id);
      if (!projectPath) return;
      return reply.send({ items: [] });
    },
  );
}
