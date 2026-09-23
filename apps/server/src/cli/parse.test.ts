import { describe, expect, it } from 'vitest';
import { CliUsageError, parseCliArgs } from './parse.js';

describe('parseCliArgs', () => {
  it('requires a command', () => {
    expect(() => parseCliArgs([])).toThrow(CliUsageError);
  });

  it('rejects an unknown command', () => {
    expect(() => parseCliArgs(['bogus'])).toThrow(CliUsageError);
  });

  it('parses board with an optional --db override', () => {
    expect(parseCliArgs(['board'])).toEqual({ kind: 'board', dbPath: undefined });
    expect(parseCliArgs(['board', '--db', 'x.db'])).toEqual({
      kind: 'board',
      dbPath: 'x.db',
    });
  });

  it('parses verify-chain', () => {
    expect(parseCliArgs(['verify-chain'])).toEqual({
      kind: 'verify-chain',
      dbPath: undefined,
    });
  });

  for (const verb of ['claim', 'start', 'accept', 'release'] as const) {
    it(`parses ${verb} <ticketId> --actor <id>`, () => {
      expect(parseCliArgs([verb, 'W1-01', '--actor', 'maker-1'])).toEqual({
        kind: 'verb',
        verb,
        ticketId: 'W1-01',
        actorId: 'maker-1',
        dbPath: undefined,
      });
    });

    it(`${verb} refuses without a ticket id`, () => {
      expect(() => parseCliArgs([verb, '--actor', 'maker-1'])).toThrow(CliUsageError);
    });

    it(`${verb} refuses without --actor`, () => {
      expect(() => parseCliArgs([verb, 'W1-01'])).toThrow(CliUsageError);
    });
  }

  it('parses comment with --body', () => {
    expect(
      parseCliArgs(['comment', 'W1-01', '--actor', 'maker-1', '--body', 'looks good']),
    ).toEqual({
      kind: 'comment',
      ticketId: 'W1-01',
      actorId: 'maker-1',
      body: 'looks good',
      dbPath: undefined,
    });
  });

  it('comment refuses without --body', () => {
    expect(() => parseCliArgs(['comment', 'W1-01', '--actor', 'maker-1'])).toThrow(
      CliUsageError,
    );
  });

  it('parses close with csv files/commits and a verify COMMAND — never an exit code (W23-42)', () => {
    expect(
      parseCliArgs([
        'close',
        'W1-01',
        '--actor',
        'maker-1',
        '--files',
        'a.ts, b.ts',
        '--commits',
        'abc123',
        '--verify-cmd',
        'pnpm test',
      ]),
    ).toEqual({
      kind: 'close',
      ticketId: 'W1-01',
      actorId: 'maker-1',
      files: ['a.ts', 'b.ts'],
      commits: ['abc123'],
      verifyCommand: 'pnpm test',
      dbPath: undefined,
    });
  });

  it('W23-42: close refuses --verify-exit by name — the exit is measured, never supplied', () => {
    expect(() =>
      parseCliArgs([
        'close',
        'W1-01',
        '--actor',
        'maker-1',
        '--files',
        'a.ts',
        '--commits',
        'abc',
        '--verify-cmd',
        'pnpm test',
        '--verify-exit',
        '0',
      ]),
    ).toThrow(
      /--verify-exit is no longer accepted: close runs the verify command itself/,
    );
  });

  it('W23-48: an old caller passing --verify-exit WITHOUT --verify-cmd is told what to do instead, not "requires --verify-cmd"', () => {
    let message = '';
    try {
      parseCliArgs([
        'close',
        'W1-01',
        '--actor',
        'maker-1',
        '--files',
        'a.ts',
        '--commits',
        'abc',
        '--verify-exit',
        '0',
      ]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/--verify-exit is no longer accepted/);
    // The replacement, named: drop the flag, pass the command to run.
    expect(message).toMatch(/drop --verify-exit/i);
    expect(message).toMatch(/--verify-cmd <command>/);
    expect(message).toMatch(/ticket's own verify/);
  });

  it('close refuses a non-integer --verify-exit', () => {
    expect(() =>
      parseCliArgs([
        'close',
        'W1-01',
        '--actor',
        'maker-1',
        '--files',
        'a.ts',
        '--commits',
        'abc',
        '--verify-cmd',
        'pnpm test',
        '--verify-exit',
        'nope',
      ]),
    ).toThrow(CliUsageError);
  });

  it('close refuses without --files/--commits/--verify-cmd', () => {
    const base = ['close', 'W1-01', '--actor', 'maker-1'];
    expect(() => parseCliArgs(base)).toThrow(CliUsageError);
    expect(() => parseCliArgs([...base, '--files', 'a.ts'])).toThrow(CliUsageError);
    expect(() => parseCliArgs([...base, '--files', 'a.ts', '--commits', 'abc'])).toThrow(
      CliUsageError,
    );
  });
});

/**
 * W21-91. Node's `parseArgs` throws a native TypeError on an unknown flag, and
 * `runCli` catches only `CliUsageError` — so a typo reached the top-level
 * handler and printed a stack trace through parse_args and dist/main.js.
 * Measured on `dokima board --wrongflag` and `dokima claim T1 --actor me
 * --bogus`. The neighbouring cases were already right, so only the likeliest
 * typo of the three crashed.
 */
describe('a mistyped flag refuses, it does not crash (W21-91)', () => {
  for (const argv of [
    ['board', '--wrongflag'],
    ['verify-chain', '--nope'],
    ['claim', 'W9-01', '--actor', 'me', '--bogus'],
    ['reject', 'W9-01', '--actor', 'me', '--reason', 'x', '--huh'],
    ['comment', 'W9-01', '--actor', 'me', '--body', 'x', '--huh'],
    ['close', 'W9-01', '--actor', 'me', '--huh'],
  ]) {
    it(`RED FIXTURE: ${argv[0]} names the unknown option and prints usage`, () => {
      let caught: unknown;
      try {
        parseCliArgs(argv);
      } catch (err) {
        caught = err;
      }
      // A CliUsageError is what runCli turns into exit 2 with one line; a bare
      // TypeError is what reached the top-level catch in bootstrap/main.ts and
      // printed err.stack. W22-01 made that catch refuse by default.
      expect(caught).toBeInstanceOf(CliUsageError);
      const message = (caught as Error).message;
      expect(message).toMatch(/Unknown option/);
      expect(message).toMatch(/usage: dokima/);
      expect(message).not.toContain('    at ');
    });
  }

  it('a KNOWN option is untouched', () => {
    expect(parseCliArgs(['board', '--db', '/tmp/x.db'])).toMatchObject({
      kind: 'board',
      dbPath: '/tmp/x.db',
    });
    expect(parseCliArgs(['claim', 'W9-01', '--actor', 'me'])).toMatchObject({
      kind: 'verb',
      verb: 'claim',
      ticketId: 'W9-01',
      actorId: 'me',
    });
  });
});
