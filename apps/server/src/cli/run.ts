import {
  acceptTicket,
  claimTicket,
  closeTicket,
  commentTicket,
  listTickets,
  releaseTicket,
  startTicket,
  TicketError,
  type Ticket,
} from '@shipwright/tickets';
import { renderBoard } from './board.js';
import { openReadOnlyLog, openWritableLog, resolveDbPath } from './db.js';
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

  const dbPath = resolveDbPath(io.cwd, command.dbPath);

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
