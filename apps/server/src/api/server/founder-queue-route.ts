/**
 * `GET /api/v1/projects/:id/founder-queue` — Otto's funnel (W20-09, D-030).
 *
 * Collects every OPEN founder-facing item across the five classes
 * OPERATIONS.md allows, then hands the whole set to `orderFounderQueue`. The
 * route has no filter, no cap, and no page size: whatever is open is what is
 * returned, so `depth` is the true count and "Otto cannot drop an item" stays
 * a property of the code rather than a promise in a doc.
 *
 * Nothing here decides. Answering happens through the existing verbs (decide
 * a slate, approve a tool call, accept a ticket) — this route only says what
 * is waiting and, mechanically, why it is in that order.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openEventLogReader } from '@dokima/events';
import { listTickets } from '@dokima/tickets';
import { listPendingApprovals } from '@dokima/mcp';
import {
  countBlockedDependents,
  isStuckTicket,
  orderFounderQueue,
  type FounderQueueItem,
} from '@dokima/harbormaster';
import { listSlates } from '../decisions/store.js';
import { computeFleetRegistryPath } from '../projects.js';
import { notFound } from './artifacts-helpers.js';
import { PROBLEM_CONTENT_TYPE } from './board-errors.js';
import { resolveProjectRecord, stateDbPath } from './board-project.js';

export interface FounderQueueRouteOptions {
  home?: string;
}

/** The maker of a ticket, as an actor id — who would be seated waiting (W20-10). */
function ownerOf(
  ticketId: string | null,
  tickets: readonly { id: string; ownerId: string | null }[],
): string | null {
  if (!ticketId) return null;
  return tickets.find((t) => t.id === ticketId)?.ownerId ?? null;
}

export function registerFounderQueueRoute(
  app: FastifyInstance,
  opts: FounderQueueRouteOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  app.get(
    '/api/v1/projects/:id/founder-queue',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const record = await resolveProjectRecord(registryPath, id);
      if (!record) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no project registered with id ${id}`));
      }

      const dbPath = stateDbPath(record.path);
      let db: ReturnType<typeof openEventLogReader>;
      try {
        db = openEventLogReader(dbPath);
      } catch {
        // A project with no state.db yet has nothing open — an empty queue is
        // the honest answer, not an error the founder has to interpret.
        return reply.send({ depth: 0, items: [] });
      }

      try {
        const log = { db, path: dbPath, close: () => db.close() };
        const tickets = Array.from(listTickets(log).values()).map((t) => ({
          id: t.id,
          ownerId: t.ownerId,
          dependsOn: t.dependsOn,
        }));

        const items: FounderQueueItem[] = [];

        // 1 + 5. Founder decisions and interview questions — open slates.
        for (const slate of listSlates(log, { status: 'open' })) {
          const isFounder = slate.slate.kind === 'founder';
          items.push({
            id: `slate:${slate.id}`,
            kind: isFounder ? 'founder-decision' : 'interview',
            actorId: 'pm-interviewer',
            title: slate.slate.title,
            ticketId: null,
            openedAt: slate.createdAt,
            estimatedCostUsd: null,
            // A slate raised before the board exists stops everything behind it.
            blocksRun: tickets.length === 0,
            blockedDependents: 0,
          });
        }

        // 2. Approvals with a cost or blast radius — pending MCP tool calls.
        for (const approval of listPendingApprovals(log)) {
          items.push({
            id: `approval:${approval.id}`,
            kind: 'approval',
            actorId: approval.requestedBy,
            title: `${approval.toolId} needs your approval`,
            ticketId: null,
            openedAt: approval.requestedAt ?? new Date(0).toISOString(),
            estimatedCostUsd: approval.estimatedCost,
            blocksRun: false,
            blockedDependents: 0,
          });
        }

        // 4. Acceptance — finished work waiting on a human verb (D-020).
        for (const ticket of listTickets(log).values()) {
          if (ticket.status !== 'in_review') continue;
          items.push({
            id: `accept:${ticket.id}`,
            kind: 'acceptance',
            actorId: ownerOf(ticket.id, tickets) ?? 'coding-agent',
            title: `${ticket.id} is finished — accept it?`,
            ticketId: ticket.id,
            openedAt: ticket.claimedAt ?? new Date(0).toISOString(),
            estimatedCostUsd: null,
            blocksRun: false,
            blockedDependents: countBlockedDependents(ticket.id, tickets),
          });
        }

        // W21-26: a ticket the loop keeps picking up and putting back down.
        // Each park returns it to Ready and the next run repeats it, so
        // without this it is retried forever and nobody is told — observed on
        // a real project as seven consecutive parks. The signal is the
        // ledgered verbs, never a model's account of what happened (C-2); the
        // last park comment rides along as evidence for the person deciding.
        for (const ticket of listTickets(log).values()) {
          if (!isStuckTicket(ticket)) continue;
          const lastComment = [...ticket.history]
            .reverse()
            .find((h) => h.verb === 'comment' && h.body);
          items.push({
            id: `stuck:${ticket.id}`,
            kind: 'stuck-ticket',
            actorId: ownerOf(ticket.id, tickets) ?? 'coding-agent',
            title: `${ticket.id} keeps being retried and never finishes — is it right as written?`,
            ticketId: ticket.id,
            openedAt: lastComment?.at ?? ticket.claimedAt ?? new Date(0).toISOString(),
            estimatedCostUsd: null,
            blocksRun: false,
            blockedDependents: countBlockedDependents(ticket.id, tickets),
          });
        }

        const ordered = orderFounderQueue(items);
        // depth === items.length, always: there is no filter above this line.
        return reply.send({
          depth: ordered.length,
          items: ordered.map((o) => ({
            id: o.id,
            kind: o.kind,
            actor_id: o.actorId,
            title: o.title,
            ticket_id: o.ticketId,
            opened_at: o.openedAt,
            estimated_cost_usd: o.estimatedCostUsd,
            position: o.position,
            reason: o.reason,
          })),
        });
      } finally {
        db.close();
      }
    },
  );
}
