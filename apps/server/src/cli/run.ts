import {
  acceptTicket,
  claimTicket,
  closeTicket,
  commentTicket,
  createTicketValidatingLanes,
  rejectTicket,
  retargetTicketAcceptance,
  retargetTicketDependencies,
  setTicketBrief,
  widenTicketScope,
  listTickets,
  releaseTicket,
  startTicket,
  TicketError,
  type Ticket,
} from '@dokima/tickets';
import { renderBoard } from './board.js';
import {
  openReadOnlyLog,
  openWritableLog,
  resolveDbPathForProject,
  UnknownProjectError,
} from './db.js';
import { ensureActorIdentity } from './identity.js';
import { CliUsageError, parseCliArgs, type SimpleVerb } from './parse.js';
import { executeRunCommand } from './run-cmd.js';
import { checkChain, renderChainResult } from './verify-chain.js';

export interface CliIO {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Injectable clock for deterministic tests (TESTING.md §2). */
  now?: () => string;
  /** W10-74: `--project <id>` resolves through the fleet registry under this env's DOKIMA_HOME. */
  env?: NodeJS.ProcessEnv;
}

const SIMPLE_VERB_FNS: Record<
  SimpleVerb,
  (
    log: Parameters<typeof claimTicket>[0],
    input: { ticketId: string; actorId: string },
    opts: { now?: () => string },
  ) => Ticket
> = {
  claim: claimTicket,
  start: startTicket,
  accept: acceptTicket,
  release: releaseTicket,
};

/** Prints refusal reasons for a ticket verb (FR-T4) and returns the process exit code. */
function reportVerbError(err: unknown, io: CliIO): number {
  if (err instanceof TicketError) {
    io.stderr(`refused [${err.code}]: ${err.message}`);
    return 1;
  }
  throw err;
}

/** CLI entry point over the ticket verbs + projections (BLUEPRINT §3.6, "a board that cannot lie, moved by CLI"). */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let command;
  try {
    command = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      io.stderr(err.message);
      return 2;
    }
    throw err;
  }

  if (command.kind === 'run') {
    return executeRunCommand(command.args, io);
  }

  let dbPath: string;
  try {
    dbPath = await resolveDbPathForProject(io.cwd, {
      db: command.dbPath,
      projectId: command.projectId,
      env: io.env,
    });
  } catch (err) {
    // An id that is not in the registry is a usage problem, not a crash — and
    // the message names where to find real ids rather than echoing the bad one.
    if (err instanceof UnknownProjectError) {
      io.stderr(`refused: ${err.message}`);
      return 2;
    }
    throw err;
  }

  if (command.kind === 'verify-chain') {
    let log;
    try {
      log = openReadOnlyLog(dbPath);
    } catch (err) {
      io.stderr(
        `verify-chain refused: cannot open event log at ${dbPath} (${(err as Error).message})`,
      );
      return 1;
    }
    try {
      const result = checkChain(log);
      io.stdout(renderChainResult(result));
      return result.valid ? 0 : 1;
    } finally {
      log.close();
    }
  }

  const log = openWritableLog(dbPath);
  try {
    switch (command.kind) {
      case 'board': {
        io.stdout(renderBoard(listTickets(log)));
        return 0;
      }
      case 'verb': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const fn = SIMPLE_VERB_FNS[command.verb];
          const ticket = fn(
            log,
            { ticketId: command.ticketId, actorId: command.actorId },
            { now: io.now },
          );
          io.stdout(`${ticket.id} ${command.verb} -> ${ticket.status}`);
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      case 'close': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const ticket = closeTicket(
            log,
            {
              ticketId: command.ticketId,
              actorId: command.actorId,
              files: command.files,
              commits: command.commits,
              verify: command.verify,
            },
            { now: io.now },
          );
          io.stdout(`${ticket.id} close -> ${ticket.status}`);
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      case 'widen-scope': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const ticket = widenTicketScope(
            log,
            {
              ticketId: command.ticketId,
              actorId: command.actorId,
              add: command.add,
              reason: command.reason,
            },
            { now: io.now },
          );
          io.stdout(
            `${ticket.id} write_scope -> ${ticket.writeScope.join(', ')}`,
          );
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      case 'add-ticket': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const ticket = createTicketValidatingLanes(
            log,
            command.actorId,
            {
              id: command.ticketId,
              type: 'task',
              title: command.title,
              lane: command.lane,
              writeScope: command.writeScope,
              dependsOn: command.dependsOn,
              ...(command.acceptance
                ? { acceptance: [{ id: 'AC-1', text: command.acceptance, done: false }] }
                : {}),
              ...(command.verify ? { verify: command.verify } : {}),
            },
            { now: io.now },
          );
          io.stdout(`${ticket.id} created in lane ${ticket.lane} -> ${ticket.status}`);
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      case 'retarget-acceptance': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const ticket = retargetTicketAcceptance(
            log,
            {
              ticketId: command.ticketId,
              actorId: command.actorId,
              criteria: command.criteria,
              reason: command.reason,
            },
            { now: io.now },
          );
          io.stdout(
            `${ticket.id} acceptance -> ${ticket.acceptance.map((c) => `${c.id} ${c.text}`).join(' | ')}`,
          );
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      case 'depends-on': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const ticket = retargetTicketDependencies(
            log,
            {
              ticketId: command.ticketId,
              actorId: command.actorId,
              dependsOn: command.on,
              reason: command.reason,
            },
            { now: io.now },
          );
          io.stdout(
            `${ticket.id} depends_on -> ${ticket.dependsOn.join(', ') || '(nothing)'}`,
          );
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      case 'brief': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const ticket = setTicketBrief(
            log,
            { ticketId: command.ticketId, actorId: command.actorId, brief: command.text },
            { now: io.now },
          );
          io.stdout(`${ticket.id} brief set — the next handoff carries it as context`);
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      case 'reject': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const ticket = rejectTicket(
            log,
            { ticketId: command.ticketId, actorId: command.actorId, reason: command.reason },
            { now: io.now },
          );
          io.stdout(`${ticket.id} reject -> ${ticket.status}`);
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      case 'comment': {
        ensureActorIdentity(log, command.actorId, io.now);
        try {
          const ticket = commentTicket(
            log,
            { ticketId: command.ticketId, actorId: command.actorId, body: command.body },
            { now: io.now },
          );
          io.stdout(`${ticket.id} comment -> ${ticket.status}`);
          return 0;
        } catch (err) {
          return reportVerbError(err, io);
        }
      }
      default: {
        const unreachable: never = command;
        throw new Error(`unhandled CLI command: ${JSON.stringify(unreachable)}`);
      }
    }
  } finally {
    log.close();
  }
}
