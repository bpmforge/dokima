/**
 * parse-board-edits.ts — the verbs that correct a board, split out of
 * parse.ts (W21-71).
 *
 * These five are one concern: a person telling the product the BOARD is wrong,
 * not the work. `widen-scope` (W21-27) when a ticket cannot satisfy its own
 * acceptance, `add-ticket` (W21-48) when the board is missing one,
 * `depends-on` (W21-51) when existing work points at the wrong dependency,
 * `brief` (W21-59) when a maker is missing knowledge, and
 * `retarget-acceptance` (W21-71) when a criterion proves nothing. They arrived
 * one at a time and each added its own parser to parseCliArgs, which is how
 * that function reached the 400-line cap.
 *
 * Splitting by CONCERN rather than by size: the five share their shape (a
 * ticket id, an actor, a reason) and their rule — none of them can make
 * anything pass, they only change what is being asked for. A future board
 * correction belongs here, not back in parse.ts.
 */
import { parseArgs } from 'node:util';
import { CliUsageError } from './cli-usage-error.js';

/** Commands that correct the board rather than move work through it. */
export type BoardEditCommand =
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
      /** W21-71: the founder amending a criterion W21-50 proved unfalsifiable. */
      kind: 'retarget-acceptance';
      ticketId: string;
      actorId: string;
      criteria: string[];
      reason: string;
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
    };

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function requirePositional(positionals: string[], usage: string): string {
  const ticketId = positionals[0];
  if (!ticketId) throw new CliUsageError(usage);
  return ticketId;
}

/**
 * Parses a board-correction command, or returns null when `command` is not
 * one of them so the caller can go on to the lifecycle verbs.
 */
export function parseBoardEdit(command: string, rest: string[]): BoardEditCommand | null {
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

  if (command === 'retarget-acceptance') {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        actor: { type: 'string' },
        set: { type: 'string', multiple: true },
        reason: { type: 'string' },
        db: { type: 'string' },
        project: { type: 'string' },
      },
      allowPositionals: true,
    });
    const ticketId = requirePositional(
      positionals,
      'usage: dokima retarget-acceptance <ticketId> --actor <actorId> --set <cmd> ' +
        '[--set <cmd>] --reason <why> [--db <path>]',
    );
    if (!values.actor) {
      throw new CliUsageError('retarget-acceptance requires --actor <actorId>');
    }
    const criteria = (values.set ?? []).map((x) => x.trim()).filter(Boolean);
    if (criteria.length === 0) {
      throw new CliUsageError(
        'retarget-acceptance requires at least one --set <command>; a ticket with no ' +
          'criterion can never be closed',
      );
    }
    if (!values.reason) {
      throw new CliUsageError('retarget-acceptance requires --reason <why>');
    }
    return {
      kind: 'retarget-acceptance',
      ticketId,
      actorId: values.actor,
      criteria,
      reason: values.reason,
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
  return null;
}
