import { parseArgs } from 'node:util';
import type { VerifyResult } from '@dokima/tickets';
import { CliUsageError } from './cli-usage-error.js';
import { parseBoardEdit, requirePositional, splitCsv, type BoardEditCommand } from './parse-board-edits.js';

export { CliUsageError } from './cli-usage-error.js';

/**
 * `parseArgs` that refuses like the rest of the CLI instead of crashing.
 *
 * Node's `parseArgs` throws a native TypeError with code
 * ERR_PARSE_ARGS_UNKNOWN_OPTION on a flag it does not know. `runCli` catches
 * only `CliUsageError`, so that reached the top-level handler in cli/index.ts
 * and printed `err.stack` — a node stack trace through parse_args and
 * dist/main.js. LIVE: `dokima board --wrongflag` and
 * `dokima claim T1 --actor me --bogus` both did it.
 *
 * The neighbouring cases were already right — `dokima --foo` names the unknown
 * command, a missing positional prints its usage line — so only the likeliest
 * typo of the three crashed. Same shape as W21-81 one layer down: a refusal
 * escaping as a crash because the handler recognised only its own error class.
 *
 * NOTE for whoever generalises this: `parse-board-edits.ts` has five more
 * `parseArgs` call sites with the same exposure. It cannot import this helper
 * from here — parse.ts already imports THAT chapter, and the reverse edge is
 * the cycle `cli-usage-error.ts`'s own header was created to avoid. Moving the
 * helper beside `CliUsageError` is the way, and both files are outside this
 * ticket's write_scope.
 */
function parseArgsOrUsage<T>(parse: () => T, usage: string): T {
  try {
    return parse();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      // Node's message names the option and then explains `--` handling at
      // length; the first sentence is the part a person needs.
      const first = String((err as Error).message).split('.')[0];
      throw new CliUsageError(`${first}\n${usage}`);
    }
    throw err;
  }
}

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
  | BoardEditCommand
  | {
      /** W21-42: the reviewer sending work back — the counterpart of accept. */
      kind: 'reject';
      ticketId: string;
      actorId: string;
      reason: string;
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
    const { values } = parseArgsOrUsage(
      () =>
        parseArgs({
          args: rest,
          options: { db: { type: 'string' }, project: { type: 'string' } },
          allowPositionals: false,
        }),
      `usage: dokima ${command} [--project <id> | --db <path>]`,
    );
    return { kind: command, dbPath: values.db, projectId: values.project };
  }

  if (isSimpleVerb(command)) {
    const { values, positionals } = parseArgsOrUsage(
      () =>
        parseArgs({
          args: rest,
          options: {
            actor: { type: 'string' },
            db: { type: 'string' },
            project: { type: 'string' },
          },
          allowPositionals: true,
        }),
      `usage: dokima ${command} <ticketId> --actor <actorId> [--project <id> | --db <path>]`,
    );
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

  const boardEdit = parseBoardEdit(command, rest);
  if (boardEdit) return boardEdit;

  if (command === 'reject') {
    const { values, positionals } = parseArgsOrUsage(
      () =>
        parseArgs({
          args: rest,
          options: {
            actor: { type: 'string' },
            reason: { type: 'string' },
            db: { type: 'string' },
            project: { type: 'string' },
          },
          allowPositionals: true,
        }),
      'usage: dokima reject <ticketId> --actor <actorId> --reason <why> [--db <path>]',
    );
    const ticketId = requirePositional(
      positionals,
      'usage: dokima reject <ticketId> --actor <actorId> --reason <why> [--db <path>]',
    );
    if (!values.actor) throw new CliUsageError('reject requires --actor <actorId>');
    if (!values.reason) throw new CliUsageError('reject requires --reason <why>');
    return {
      kind: 'reject',
      ticketId,
      actorId: values.actor,
      reason: values.reason,
      dbPath: values.db,
      projectId: values.project,
    };
  }

  if (command === 'comment') {
    const { values, positionals } = parseArgsOrUsage(
      () =>
        parseArgs({
          args: rest,
          options: {
            actor: { type: 'string' },
            body: { type: 'string' },
            db: { type: 'string' },
            project: { type: 'string' },
          },
          allowPositionals: true,
        }),
      'usage: dokima comment <ticketId> --actor <actorId> --body <text> [--db <path>]',
    );
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
    const { values, positionals } = parseArgsOrUsage(
      () =>
        parseArgs({
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
        }),
      'usage: dokima close <ticketId> --actor <actorId> --files <a,b> --commits <sha> --verify-cmd <cmd> [--db <path>]',
    );
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
