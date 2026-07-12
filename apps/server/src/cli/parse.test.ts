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

  it('parses close with csv files/commits and defaults verify-exit to 0', () => {
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
      verify: { command: 'pnpm test', exitCode: 0 },
      dbPath: undefined,
    });
  });

  it('parses an explicit non-zero --verify-exit', () => {
    const parsed = parseCliArgs([
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
      '1',
    ]);
    expect(parsed.kind).toBe('close');
    if (parsed.kind === 'close') expect(parsed.verify.exitCode).toBe(1);
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
