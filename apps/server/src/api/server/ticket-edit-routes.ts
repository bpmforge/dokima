/**
 * Pre-build DAG edit route (UX_SPEC §4 "Humans edit the DAG here pre-build
 * (split/merge/reprioritize). Schema invariants refuse bad edits with the
 * same explain pattern."; API_DESIGN "PATCH /tickets/{id} — human DAG edits
 * pre-build … schema-validated (lane/scope invariants) or 409").
 *
 * Scope actually deliverable here, and why the rest isn't (C-1): a DAG edit
 * needs a mutation primitive, and `packages/tickets`' reducer
 * (`reduceTicketEvent`) has no case for anything but the six lifecycle
 * verbs plus `ticket.created` (grep-verified) — there is no `ticket.updated`
 * event type to append, and adding one is a `packages/tickets` change
 * outside this ticket's write_scope. "Merge" (retiring a ticket) has no
 * primitive at all — the event log is append-only by design (C-6), so a
 * ticket cannot be un-created; "split" would need `createTicket` (which
 * does exist) wired through a real route, but a create-with-no-edit path
 * completes no DAG-edit flow and would be a misleading half-feature.
 *
 * What IS real and delivered: the "reprioritize" case (rewriting a ticket's
 * `dependsOn`) gets full schema-invariant validation — unknown ticket ids
 * and dependency cycles are refused with the exact explain-refusal pattern
 * every other verb uses (rule + evidence, RFC 7807). A validated edit still
 * cannot be persisted (no event to append it as), so it returns 501 with a
 * precise reason rather than a fabricated success. HANDOFF: a future ticket
 * adding a `ticket.updated`/`ticket.split`/`ticket.merged` event type +
 * reducer case to `packages/tickets` turns the 501 branch below into a real
 * write.
 */

import { openEventLogReader } from '@dokima/events';
import type { Ticket } from '@dokima/tickets';
import { loadTickets } from '@dokima/tickets';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeFleetRegistryPath } from '../projects.js';
import { problem } from '../problem.js';
import { badRequest, notFound } from './artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';

export interface TicketEditRoutesOptions {
  /** Overrides `computeFleetRegistryPath()` — tests only. */
  home?: string;
}

/**
 * DFS over `dependsOn` edges (the edited ticket's edges replaced by the
 * proposed value) looking for a path back to itself. Returns the cycle
 * chain (ids, first repeated at both ends) or `null` if acyclic. A
 * self-dependency (`ticketId` in its own proposed `dependsOn`) is just the
 * length-2 case of this same check, no special-casing needed.
 */
function findDependencyCycle(
  ticketId: string,
  proposedDependsOn: readonly string[],
  byId: ReadonlyMap<string, Ticket>,
): string[] | null {
  const edgesOf = (id: string): readonly string[] =>
    id === ticketId ? proposedDependsOn : (byId.get(id)?.dependsOn ?? []);

  const path: string[] = [];
  const onPath = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): string[] | null {
    if (onPath.has(id)) return [...path.slice(path.indexOf(id)), id];
    if (visited.has(id)) return null;
    visited.add(id);
    onPath.add(id);
    path.push(id);
    for (const dep of edgesOf(id)) {
      const found = visit(dep);
      if (found) return found;
    }
    onPath.delete(id);
    path.pop();
    return null;
  }

  return visit(ticketId);
}

export function registerTicketEditRoutes(
  app: FastifyInstance,
  opts: TicketEditRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  /** `PATCH /api/v1/tickets/:id?project=` body `{ dependsOn: string[] }` — reprioritize only (module header). */
  app.patch(
    '/api/v1/tickets/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: ticketId } = request.params as { id: string };
      const query = request.query as { project?: string };
      if (!query.project) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"project" query param is required'));
      }
      const record = await resolveProjectRecord(registryPath, query.project);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${query.project}`));
      }

      const body = request.body as { dependsOn?: unknown } | undefined;
      if (
        !Array.isArray(body?.dependsOn) ||
        !body.dependsOn.every((v) => typeof v === 'string')
      ) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"dependsOn" must be an array of ticket id strings'));
      }
      const proposedDependsOn = body.dependsOn;

      const db = openEventLogReader(stateDbPath(record.path));
      try {
        const log = { db, path: stateDbPath(record.path), close: () => db.close() };
        const byId = loadTickets(log);
        if (!byId.has(ticketId)) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(notFound(request, `no ticket with id ${ticketId}`));
        }

        const unknown = proposedDependsOn.filter((depId) => !byId.has(depId));
        if (unknown.length > 0) {
          return reply
            .code(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              problem({
                type: 'https://dokima.dev/errors/depends-on-unknown-ticket',
                title: 'Unknown dependency',
                status: 409,
                detail: `dependsOn references ticket id(s) that do not exist: ${unknown.join(', ')}`,
                instance: request.url,
                requestId: request.id.toString(),
                rule: 'DEPENDS_ON_UNKNOWN_TICKET',
              }),
            );
        }

        const cycle = findDependencyCycle(ticketId, proposedDependsOn, byId);
        if (cycle) {
          return reply
            .code(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              problem({
                type: 'https://dokima.dev/errors/depends-on-cycle',
                title: 'Dependency cycle',
                status: 409,
                detail: `this edit introduces a dependency cycle: ${cycle.join(' -> ')}`,
                instance: request.url,
                requestId: request.id.toString(),
                rule: 'DEPENDS_ON_CYCLE',
              }),
            );
        }

        // Schema-valid, but there is no event type to persist it as (module header).
        return reply
          .code(501)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            problem({
              type: 'https://dokima.dev/errors/not-persisted',
              title: 'Validated, not yet persisted',
              status: 501,
              detail:
                'this dependsOn edit passed schema validation (no unknown ids, no cycle) but ' +
                'cannot be written yet — packages/tickets has no ticket-update event type ' +
                "(HANDOFF, see this route's module header)",
              instance: request.url,
              requestId: request.id.toString(),
              rule: 'NOT_PERSISTED',
            }),
          );
      } finally {
        db.close();
      }
    },
  );
}
