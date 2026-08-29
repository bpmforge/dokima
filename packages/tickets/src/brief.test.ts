/**
 * W21-59. PLAN-vault-002a had five runs. Run 41 accumulated real work; run 42
 * added nothing and the model oscillated between `./argon2id` and
 * `./argon2id.js`, both ERR_MODULE_NOT_FOUND, when the correct form is
 * `./argon2id.ts` — enabled deliberately by PLAN-vault-001b's tsconfig.
 *
 * The founder could see exactly what the maker needed and had no way to say
 * it. The channel already existed: buildHandoff renders `context` as
 * `ticket.interface ?? ticket.title`, so `interface` IS the line to the maker
 * — set once at decomposition and never writable again.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { briefToolSurfaceWarning, setTicketBrief } from './brief.js';
import { createTicket } from './create.js';
import { TicketError } from './errors.js';
import { getTicket } from './query.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function board(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'brief-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'local-operator', name: 'Founder', kind: 'human' });
  createTicket(log, 'local-operator', {
    id: 'PLAN-vault-002a',
    type: 'task',
    title: 'Argon2id password hashing',
    lane: 'vault-002',
    writeScope: ['src/crypto/argon2id.ts'],
  });
  return log;
}

const LIVE_BRIEF =
  'Import sibling modules with an explicit .ts extension (./argon2id.ts): the ' +
  'tsconfig sets allowImportingTsExtensions and there is no build step, so ' +
  './argon2id and ./argon2id.js both fail with ERR_MODULE_NOT_FOUND.';

describe('setTicketBrief (W21-59)', () => {
  it('RED FIXTURE: the live case — the founder can tell the maker the import form', () => {
    const log = board();
    const updated = setTicketBrief(log, {
      ticketId: 'PLAN-vault-002a',
      actorId: 'local-operator',
      brief: LIVE_BRIEF,
    });
    // `interface` is exactly what buildHandoff renders as the context block.
    expect(updated.interface).toBe(LIVE_BRIEF);
    log.close();
  });

  it('the previous brief is on the event — an append, never a rewrite (C-6)', () => {
    const log = board();
    setTicketBrief(log, { ticketId: 'PLAN-vault-002a', actorId: 'local-operator', brief: 'first' });
    setTicketBrief(log, { ticketId: 'PLAN-vault-002a', actorId: 'local-operator', brief: 'second' });
    const events = listEvents(log).filter((e) => e.eventType === 'ticket.brief_set');
    expect(events).toHaveLength(2);
    expect(events[1]!.payload).toMatchObject({ from: 'first', to: 'second' });
    log.close();
  });

  it('an empty brief is refused — silently clearing it would look like nothing was meant', () => {
    const log = board();
    expect(() =>
      setTicketBrief(log, { ticketId: 'PLAN-vault-002a', actorId: 'local-operator', brief: '   ' }),
    ).toThrow(TicketError);
    log.close();
  });

  it('an unknown ticket is refused, named', () => {
    const log = board();
    expect(() =>
      setTicketBrief(log, { ticketId: 'PLAN-nope', actorId: 'local-operator', brief: 'x' }),
    ).toThrow(/PLAN-nope/);
    log.close();
  });

  it('the lifecycle does not move — a brief is context, not a verb on the work', () => {
    const log = board();
    setTicketBrief(log, { ticketId: 'PLAN-vault-002a', actorId: 'local-operator', brief: 'x' });
    expect(getTicket(log, 'PLAN-vault-002a')!.status).toBe('ready');
    log.close();
  });

  it('a brief changes NOTHING about the gates — acceptance and write_scope are untouched', () => {
    const log = board();
    const before = getTicket(log, 'PLAN-vault-002a')!;
    setTicketBrief(log, { ticketId: 'PLAN-vault-002a', actorId: 'local-operator', brief: LIVE_BRIEF });
    const after = getTicket(log, 'PLAN-vault-002a')!;
    expect(after.acceptance).toEqual(before.acceptance);
    expect(after.writeScope).toEqual(before.writeScope);
    expect(after.verify).toEqual(before.verify);
    log.close();
  });
});

describe('a brief cannot ask for what the maker has no tool to do (W21-68)', () => {
  it('RED FIXTURE: the real brief that caused this warns, naming the seven tools', () => {
    // PLAN-vault-002a brief #2, verbatim in substance. The maker guessed, and
    // its guess was internally consistent and wrong — it landed a commit that
    // violated both constraints stated in the document it could not read.
    const warning = briefToolSurfaceWarning(
      'the tests fail with ERR_CRYPTO_INVALID_SCRYPT_PARAMS — consult the node:crypto ' +
        'documentation for the permitted relationship between N, r and maxmem.',
    );
    expect(warning).not.toBeNull();
    for (const tool of ['read', 'list', 'search', 'write', 'edit', 'commit', 'verify']) {
      expect(warning).toContain(tool);
    }
    expect(warning).toContain('The brief was still set');
  });

  it('the founder’s own CORRECTION passes clean — the case a looser rule breaks', () => {
    // Brief #3, the fix for #2. It contains "look them up" and must not fire:
    // it is stating the facts precisely BECAUSE the maker cannot look them up.
    expect(
      briefToolSurfaceWarning(
        "Node's crypto.scrypt enforces two limits your current values break, and they " +
          'are stated here because you have no way to look them up: N < 2^(128*r/8).',
      ),
    ).toBeNull();
  });

  it('STATING what a document says is fine; being told to go read it is not', () => {
    // Acceptance 2. The distinction is a directive verb near an off-repo noun.
    expect(
      briefToolSurfaceWarning('The node:crypto documentation says N must be under 65536.'),
    ).toBeNull();
    expect(briefToolSurfaceWarning('Refer to the RFC for the exact framing.')).not.toBeNull();
  });

  it('ordinary in-repo instructions never fire', () => {
    for (const brief of [
      "Import sibling modules with an explicit .ts extension (from './argon2id.ts').",
      "Run 'node --test src/crypto/argon2id.spec.ts' and read the output before committing.",
      'Check the values you are passing against the ones in the test.',
      'STOP rewriting the spec. It already passes and was accepted.',
    ]) {
      expect(briefToolSurfaceWarning(brief)).toBeNull();
    }
  });
});
