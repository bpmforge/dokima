import {
  listEvents,
  openEventLog,
  openEventLogReader,
  type EventLog,
} from '@shipwright/events';
import {
  acceptTicket,
  claimTicket,
  closeTicket,
  commentTicket,
  loadTickets,
  releaseTicket,
  startTicket,
  TicketError,
  type LifecycleVerb,
  type Ticket,
} from '@shipwright/tickets';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  EVENT_SEQ_HEADER,
  extractIdempotencyKey,
  IdempotencyStore,
} from '../idempotency.js';
import { computeFleetRegistryPath } from '../projects.js';
import type { WsHub } from '../ws-hub.js';
import { ensureOperatorIdentity, OPERATOR_ACTOR_ID } from './board-actor.js';
import { PROBLEM_CONTENT_TYPE, ticketErrorToProblem } from './board-errors.js';
import { resolveProjectOrProblem, stateDbPath } from './board-project.js';
import { toWireBoardTicket } from './board-wire.js';
import { problem } from '../problem.js';

export interface BoardRoutesOptions {
  /** Fleet registry home dir override (defaults to computeShipwrightHome()) — tests only. */
  home?: string;
  wsHub: WsHub;
}

const VERBS: readonly LifecycleVerb[] = [
  'claim',
  'start',
  'close',
  'accept',
  'release',
  'comment',
];

/** Board `board:{projectId}` subscription event type per verb (API_DESIGN §3, mirrors the internal `ticket.*` event names). */
const VERB_EVENT_TYPE: Record<LifecycleVerb, string> = {
  claim: 'ticket.claimed',
  start: 'ticket.started',
  close: 'ticket.closed',
  accept: 'ticket.accepted',
  release: 'ticket.released',
  comment: 'ticket.commented',
};

function isLifecycleVerb(value: string): value is LifecycleVerb {
  return (VERBS as readonly string[]).includes(value);
}

function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

/** Opens `{project}/.shipwright/state.db`, or replies 404 (unregistered id)
 * / 503 (corrupt `fleet.json`, THREAT_MODEL §5.6) and returns `undefined`. */
async function openProjectLog(
  request: FastifyRequest,
  reply: FastifyReply,
  registryPath: string,
  projectId: string,
  mode: 'read' | 'write',
): Promise<EventLog | undefined> {
  const record = await resolveProjectOrProblem(request, reply, registryPath, projectId);
  if (!record) return undefined;
  const dbPath = stateDbPath(record.path);
  if (mode === 'write') return openEventLog(dbPath);
  const db = openEventLogReader(dbPath);
  return { db, path: dbPath, close: () => db.close() };
}

function parseBoolFilter(value: unknown): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

/** `GET /api/v1/projects/:id/tickets` (API_DESIGN "tickets — verbs"). */
function registerListRoute(app: FastifyInstance, registryPath: string): void {
  app.get(
    '/api/v1/projects/:id/tickets',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const log = await openProjectLog(request, reply, registryPath, projectId, 'read');
      if (!log) return reply;
      try {
        const tickets = loadTickets(log);
        const query = request.query as Record<string, unknown>;
        const claimableFilter = parseBoolFilter(query.claimable);
        const staleFilter = parseBoolFilter(query.stale);
        let items = Array.from(tickets.values()).map((t) =>
          toWireBoardTicket(t, tickets),
        );
        if (typeof query.status === 'string') {
          items = items.filter((t) => t.status === query.status);
        }
        if (typeof query.lane === 'string') {
          items = items.filter((t) => t.lane === query.lane);
        }
        if (typeof query.type === 'string') {
          items = items.filter((t) => t.type === query.type);
        }
        if (claimableFilter !== undefined) {
          items = items.filter((t) => t.claimable === claimableFilter);
        }
        if (staleFilter !== undefined) {
          items = items.filter((t) => t.staleBlocked === staleFilter);
        }
        return reply.send({ items, next_cursor: null });
      } finally {
        log.close();
      }
    },
  );
}

interface VerbBody {
  body?: unknown;
  files?: unknown;
  verify?: { command?: unknown; exitCode?: unknown };
  commits?: unknown;
}

function fireVerb(
  log: EventLog,
  verb: LifecycleVerb,
  ticketId: string,
  body: VerbBody,
): Ticket {
  const actorId = OPERATOR_ACTOR_ID;
  switch (verb) {
    case 'claim':
      return claimTicket(log, { ticketId, actorId });
    case 'start':
      return startTicket(log, { ticketId, actorId });
    case 'accept':
      return acceptTicket(log, { ticketId, actorId });
    case 'release':
      return releaseTicket(log, { ticketId, actorId });
    case 'comment':
      return commentTicket(log, {
        ticketId,
        actorId,
        body: typeof body.body === 'string' ? body.body : '',
      });
    case 'close': {
      const files = Array.isArray(body.files) ? (body.files as string[]) : [];
      const commits = Array.isArray(body.commits) ? (body.commits as string[]) : [];
      const verify = {
        command: typeof body.verify?.command === 'string' ? body.verify.command : '',
        exitCode: typeof body.verify?.exitCode === 'number' ? body.verify.exitCode : 1,
      };
      return closeTicket(log, { ticketId, actorId, files, commits, verify });
    }
  }
}

/** `POST /api/v1/tickets/:id/:verb` (API_DESIGN "tickets — verbs", FR-T1..T4;
 * idempotency + `X-Event-Seq` per API_DESIGN §1/§5). */
function registerVerbRoute(
  app: FastifyInstance,
  registryPath: string,
  wsHub: WsHub,
  idempotency: IdempotencyStore,
): void {
  app.post(
    '/api/v1/tickets/:id/:verb',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: ticketId, verb } = request.params as { id: string; verb: string };
      if (!isLifecycleVerb(verb)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, `unknown verb "${verb}"`));
      }
      const idempotencyKey = extractIdempotencyKey(request.headers);
      if (!idempotencyKey) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'missing required Idempotency-Key header'));
      }
      const projectId = (request.query as Record<string, unknown>).project;
      if (typeof projectId !== 'string' || projectId.length === 0) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'missing required "project" query parameter'));
      }
      const replayKey = `${projectId}:${verb}:${ticketId}:${idempotencyKey}`;
      const replay = idempotency.get(replayKey);
      if (replay) {
        return reply.code(replay.status).headers(replay.headers).send(replay.body);
      }
      const log = await openProjectLog(request, reply, registryPath, projectId, 'write');
      if (!log) return reply;
      try {
        ensureOperatorIdentity(log);
        const body = (request.body ?? {}) as VerbBody;
        let updated: Ticket;
        try {
          updated = fireVerb(log, verb, ticketId, body);
        } catch (err) {
          if (err instanceof TicketError) {
            const { status, body: problemBody } = ticketErrorToProblem(
              err,
              request.url,
              request.id.toString(),
            );
            return reply.code(status).type(PROBLEM_CONTENT_TYPE).send(problemBody);
          }
          throw err;
        }
        const tickets = loadTickets(log);
        const wireTicket = toWireBoardTicket(updated, tickets);
        wsHub.publish(`board:${projectId}`, VERB_EVENT_TYPE[verb], wireTicket);
        const events = listEvents(log);
        const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
        const headers = { [EVENT_SEQ_HEADER]: String(lastSeq) };
        idempotency.put(replayKey, { status: 200, body: updated, headers });
        return reply.headers(headers).send(updated);
      } finally {
        log.close();
      }
    },
  );
}

/** Ticket board REST routes (API_DESIGN §2 "tickets — verbs") over per-project `state.db`s. */
export function registerBoardRoutes(
  app: FastifyInstance,
  opts: BoardRoutesOptions,
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  const idempotency = new IdempotencyStore();
  registerListRoute(app, registryPath);
  registerVerbRoute(app, registryPath, opts.wsHub, idempotency);
}
