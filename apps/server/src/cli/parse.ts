import { parseArgs } from 'node:util';
import type { VerifyResult } from '@dokima/tickets';

export class CliUsageError extends Error {}

const SIMPLE_VERBS = ['claim', 'start', 'accept', 'release'] as const;
export type SimpleVerb = (typeof SIMPLE_VERBS)[number];

/**
 * W10-74: every db-addressing command also accepts `--project <id>`, the only
 * handle a founder who created a product through the Fleet actually has.
 * `--db` still wins when both are given (see `resolveDbPathForProject`).
 */
export type CliCommand =
  | { kind: 'board'; dbPath?: string; projectId?: string }
  | { kind: 'verify-chain'; dbPath?: string; projectId?: string }
  | {
      kind: 'verb';
      verb: SimpleVerb;
      ticketId: string;
      actorId: string;
      dbPath?: string;
      projectId?: string;
    }
  | {
      kind: 'close';
      ticketId: string;
      actorId: string;
      files: string[];
      commits: string[];
      verify: VerifyResult;
      dbPath?: string;
      projectId?: string;
    }
  | {
      /** W21-27: the founder answering "this ticket is not right as written". */
      kind: 'widen-scope';
      ticketId: string;
      actorId: string;
      add: string[];
      reason: string;
      dbPath?: string;
      projectId?: string;
    }
  | {
      /**
       * W21-48: the founder answering "this BOARD is not right as written".
       * W21-27's widen-scope covers a ticket that is wrong; this covers one
       * that is missing, which a decomposition produced once cannot fix.
       */
      kind: 'add-ticket';
      ticketId: string;
      actorId: string;
      lane: string;
      title: string;
      writeScope: string[];
      dependsOn: string[];
      acceptance?: string;
      verify?: string;
      dbPath?: string;
      projectId?: string;
    }
  | {
      /** W21-51: the founder pointing a ticket at work the board was missing. */
      kind: 'depends-on';
      ticketId: string;
      actorId: string;
      on: string[];
      reason: string;
      dbPath?: string;
      projectId?: string;
    }
  | {
      /** W21-59: the founder telling a stuck maker something it cannot discover. */
      kind: 'brief';
      ticketId: string;
      actorId: string;
      text: string;
      dbPath?: string;
      projectId?: string;
    }
  | {
      kind: 'comment';
      ticketId: string;
      actorId: string;
      body: string;
      dbPath?: string;
      projectId?: string;
    }
  /** `dokima run <start|pause|resume|stop> ...` (FR-C7) — `args` is the untouched rest, owned and parsed by `run-cmd.ts`. */
  | { kind: 'run'; args: string[] };

function isSimpleVerb(command: string): command is SimpleVerb {
  return (SIMPLE_VERBS as readonly string[]).includes(command);
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function requirePositional(positionals: string[], usage: string): string {
  const ticketId = positionals[0];
  if (!ticketId) throw new CliUsageError(usage);
  return ticketId;
}

export function parseCliArgs(argv: string[]): CliCommand {
  const [command, ...rest] = argv;
  if (!command) {
    throw new CliUsageError(
      'usage: dokima <board|verify-chain|claim|start|close|accept|release|comment|run> ...',
    );
  }

  if (command === 'run') {
    return { kind: 'run', args: rest };
  }

  if (command === 'board' || command === 'verify-chain') {
    const { values } = parseArgs({
      args: rest,
      options: { db: { type: 'string' }, project: { type: 'string' } },
      allowPositionals: false,
    });
    return { kind: command, dbPath: values.db, projectId: values.project };
  }

  if (isSimpleVerb(command)) {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        db: { type: 'string' },
        project: { type: 'string' },
      },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      `usage: dokima ${command} <ticketId> --actor <actorId> [--project <id> | --db <path>]`,
    );
    if (!values.actor) throw new CliUsageError(`${command} requires --actor <actorId>`);
    return {
      kind: 'verb',
      verb: command,
      ticketId,
      actorId: values.actor,
      dbPath: values.db,
      projectId: values.project,
    };
  }

  if (command === 'widen-scope') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        add: { type: 'string' },
        reason: { type: 'string' },
        db: { type: 'string' },
        project: { type: 'string' },
      },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      'usage: dokima widen-scope <ticketId> --actor <actorId> --add <glob,glob> ' +
        '--reason <why> [--db <path>]',
    );
    if (!values.actor) throw new CliUsageError('widen-scope requires --actor <actorId>');
    if (!values.add) throw new CliUsageError('widen-scope requires --add <glob,glob>');
    if (!values.reason) throw new CliUsageError('widen-scope requires --reason <why>');
    return {
      kind: 'widen-scope',
      ticketId,
      actorId: values.actor,
      add: values.add.split(',').map((s2) => s2.trim()).filter(Boolean),
      reason: values.reason,
      dbPath: values.db,
      projectId: values.project,
    };
  }

  if (command === 'add-ticket') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        lane: { type: 'string' },
        title: { type: 'string' },
        'write-scope': { type: 'string' },
        'depends-on': { type: 'string' },
        acceptance: { type: 'string' },
        verify: { type: 'string' },
        db: { type: 'string' },
        project: { type: 'string' },
      },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      'usage: dokima add-ticket <ticketId> --actor <actorId> --lane <lane> ' +
        '--title <title> --write-scope <glob,glob> [--depends-on <id,id>] ' +
        '[--acceptance <text>] [--verify <cmd>] [--db <path>]',
    );
    if (!values.actor) throw new CliUsageError('add-ticket requires --actor <actorId>');
    if (!values.lane) throw new CliUsageError('add-ticket requires --lane <lane>');
    if (!values.title) throw new CliUsageError('add-ticket requires --title <title>');
    if (!values['write-scope']) {
      throw new CliUsageError('add-ticket requires --write-scope <glob,glob>');
    }
    const list = (v: string | undefined): string[] =>
      (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return {
      kind: 'add-ticket',
      ticketId,
      actorId: values.actor,
      lane: values.lane,
      title: values.title,
      writeScope: list(values['write-scope']),
      dependsOn: list(values['depends-on']),
      ...(values.acceptance ? { acceptance: values.acceptance } : {}),
      ...(values.verify ? { verify: values.verify } : {}),
      dbPath: values.db,
      projectId: values.project,
    };
  }

  if (command === 'depends-on') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        on: { type: 'string' },
        reason: { type: 'string' },
        db: { type: 'string' },
        project: { type: 'string' },
      },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      'usage: dokima depends-on <ticketId> --actor <actorId> --on <id,id> ' +
        '--reason <why> [--db <path>]',
    );
    if (!values.actor) throw new CliUsageError('depends-on requires --actor <actorId>');
    if (values.on === undefined) {
      throw new CliUsageError('depends-on requires --on <id,id> (empty string clears)');
    }
    if (!values.reason) throw new CliUsageError('depends-on requires --reason <why>');
    return {
      kind: 'depends-on',
      ticketId,
      actorId: values.actor,
      on: values.on.split(',').map((x) => x.trim()).filter(Boolean),
      reason: values.reason,
      dbPath: values.db,
      projectId: values.project,
    };
  }

  if (command === 'brief') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        text: { type: 'string' },
        db: { type: 'string' },
        project: { type: 'string' },
      },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      'usage: dokima brief <ticketId> --actor <actorId> --text <context> [--db <path>]',
    );
    if (!values.actor) throw new CliUsageError('brief requires --actor <actorId>');
    if (!values.text) throw new CliUsageError('brief requires --text <context>');
    return {
      kind: 'brief',
      ticketId,
      actorId: values.actor,
      text: values.text,
      dbPath: values.db,
      projectId: values.project,
    };
  }

  if (command === 'comment') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        body: { type: 'string' },
        db: { type: 'string' },
        project: { type: 'string' },
      },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      'usage: dokima comment <ticketId> --actor <actorId> --body <text> [--db <path>]',
    );
    if (!values.actor) throw new CliUsageError('comment requires --actor <actorId>');
    if (values.body === undefined)
      throw new CliUsageError('comment requires --body <text>');
    return {
      kind: 'comment',
      ticketId,
      actorId: values.actor,
      body: values.body,
      dbPath: values.db,
      projectId: values.project,
    };
  }

  if (command === 'close') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        files: { type: 'string' },
        commits: { type: 'string' },
        'verify-cmd': { type: 'string' },
        'verify-exit': { type: 'string' },
        db: { type: 'string' },
        project: { type: 'string' },
      },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      'usage: dokima close <ticketId> --actor <id> --files <a,b> --commits <c1,c2> ' +
        '--verify-cmd <cmd> [--verify-exit <n>] [--db <path>]',
    );
    if (!values.actor) throw new CliUsageError('close requires --actor <actorId>');
    if (!values.files)
      throw new CliUsageError('close requires --files <comma-separated paths>');
    if (!values.commits)
      throw new CliUsageError('close requires --commits <comma-separated shas>');
    if (!values['verify-cmd'])
      throw new CliUsageError('close requires --verify-cmd <command string>');
    const exitCodeRaw = values['verify-exit'] ?? '0';
    const exitCode = Number(exitCodeRaw);
    if (!Number.isInteger(exitCode)) {
      throw new CliUsageError(`--verify-exit must be an integer, got '${exitCodeRaw}'`);
    }
    return {
      kind: 'close',
      ticketId,
      actorId: values.actor,
      files: splitCsv(values.files),
      commits: splitCsv(values.commits),
      verify: { command: values['verify-cmd'], exitCode },
      dbPath: values.db,
      projectId: values.project,
    };
  }

  throw new CliUsageError(`unknown command '${command}'`);
}
