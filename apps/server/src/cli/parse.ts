import { parseArgs } from 'node:util';
import type { VerifyResult } from '@dokima/tickets';

export class CliUsageError extends Error {}

const SIMPLE_VERBS = ['claim', 'start', 'accept', 'release'] as const;
export type SimpleVerb = (typeof SIMPLE_VERBS)[number];

export type CliCommand =
  | { kind: 'board'; dbPath?: string }
  | { kind: 'verify-chain'; dbPath?: string }
  | { kind: 'verb'; verb: SimpleVerb; ticketId: string; actorId: string; dbPath?: string }
  | {
      kind: 'close';
      ticketId: string;
      actorId: string;
      files: string[];
      commits: string[];
      verify: VerifyResult;
      dbPath?: string;
    }
  | { kind: 'comment'; ticketId: string; actorId: string; body: string; dbPath?: string }
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
      options: { db: { type: 'string' } },
      allowPositionals: false,
    });
    return { kind: command, dbPath: values.db };
  }

  if (isSimpleVerb(command)) {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { actor: { type: 'string' }, db: { type: 'string' } },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      `usage: dokima ${command} <ticketId> --actor <actorId> [--db <path>]`,
    );
    if (!values.actor) throw new CliUsageError(`${command} requires --actor <actorId>`);
    return {
      kind: 'verb',
      verb: command,
      ticketId,
      actorId: values.actor,
      dbPath: values.db,
    };
  }

  if (command === 'comment') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        body: { type: 'string' },
        db: { type: 'string' },
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
    };
  }

  throw new CliUsageError(`unknown command '${command}'`);
}
