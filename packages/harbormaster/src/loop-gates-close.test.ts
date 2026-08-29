/**
 * W21-90. A rejection is the most specific thing anyone knows about a ticket,
 * and it arrived as advice a maker could decline. These fixtures are the live
 * Tally sequence: reject naming package.json, close touching everything else.
 */
import { describe, expect, it } from 'vitest';
import {
  lastObservedGateOutput,
  rejectionNamedPaths,
  unaddressedRejectionNotice,
} from './loop-gates-close.js';
import { formatFailureComment } from './loop-gates-secrets.js';

describe('a close that reverses an unaddressed rejection says so (W21-90)', () => {
  const REJECTION =
    "package.json ships \"test\": \"echo 'Tests passed' || true\", a script that " +
    'cannot fail. Change that and nothing else.';

  it('RED FIXTURE: Tally PLAN-tally-01 — the reviewer named package.json and the close did not touch it', () => {
    // From the ledger: receipt 22:13, rejected 22:14, receipt again 22:44.
    // The maker committed .gitignore and src/index.ts, left package.json
    // alone, and the gate re-ran the unfailable script and minted.
    const notice = unaddressedRejectionNotice(REJECTION, ['.gitignore', 'src/index.ts']);
    expect(notice).toContain('package.json');
    expect(notice).toContain('REVERSES A REJECTION');
    // Acceptance 3, in the words the person reads: it did not block.
    expect(notice).toContain('did not block');
  });

  it('a close that DOES touch the named file is unaffected (acceptance 2)', () => {
    expect(unaddressedRejectionNotice(REJECTION, ['package.json'])).toBeNull();
  });

  it('matches a named file inside a directory the close changed', () => {
    expect(unaddressedRejectionNotice('fix apps/web/src/App.tsx', ['apps/web/src/App.tsx'])).toBeNull();
    expect(unaddressedRejectionNotice('fix App.tsx', ['apps/web/src/App.tsx'])).toBeNull();
  });

  it('a rejection naming NO file yields nothing rather than a guess', () => {
    // The same conservatism referencedPaths applies: whether a rejection was
    // "addressed" is a judgement about meaning, and this makes none.
    expect(unaddressedRejectionNotice('this is not good enough yet', ['src/index.ts'])).toBeNull();
    expect(rejectionNamedPaths('please try harder')).toEqual([]);
  });

  it('reads paths out of ordinary reviewer prose', () => {
    const named = rejectionNamedPaths('package.json and src/crypto/argon2id.ts both need work.');
    expect(named).toContain('package.json');
    expect(named).toContain('src/crypto/argon2id.ts');
  });
});

/**
 * W22-10. W21-73 carries the gate's real output across ATTEMPTS. A run that
 * starts fresh has no attempt to carry from, so the successor met the same
 * confident wrong sentence with nothing beside it — the defect W21-73 closed,
 * one level out.
 *
 * These pin the reader. The events are the shape `runCloseGate` actually
 * writes: a `ticket.commented` row whose body is `formatFailureComment`.
 */
describe('the last gate output survives across runs (W22-10)', () => {
  const commented = (ticketId: string, body: string) => ({
    eventType: 'ticket.commented',
    ticketId,
    payload: { body },
  });

  it('RED FIXTURE: a new run reads the last gate output the log already holds', () => {
    const events = [
      commented('T-1', formatFailureComment(['verify exited 1: 7 passing, 3 failing'])),
    ];
    expect(lastObservedGateOutput(events, 'T-1')).toEqual([
      'verify exited 1: 7 passing, 3 failing',
    ]);
  });

  it('ROUND-TRIP against the real formatter — the parser cannot drift from it', () => {
    // The producer lives in loop-gates-secrets.ts and the reader here. This
    // is the mechanical pin between them: reformat, reparse, same reasons.
    const reasons = ['manifest declares zero files', 'validator secrets-scan exited 2'];
    expect(
      lastObservedGateOutput([commented('T-1', formatFailureComment(reasons))], 'T-1'),
    ).toEqual(reasons);
  });

  it('A3: a ticket whose gate has never run carries nothing', () => {
    expect(lastObservedGateOutput([], 'T-1')).toBeNull();
    expect(
      lastObservedGateOutput([commented('T-1', 'an ordinary comment')], 'T-1'),
    ).toBeNull();
  });

  it('a receipt minted since supersedes the failure — order decides, not presence', () => {
    // The same discipline as the standing-rejection reader: a failure the
    // gate has since gone past is history, not "what it last observed".
    const events = [
      commented('T-1', formatFailureComment(['verify exited 1'])),
      { eventType: 'gate.receipt_minted', ticketId: 'T-1', payload: {} },
    ];
    expect(lastObservedGateOutput(events, 'T-1')).toBeNull();
  });

  it('the most recent failure wins, and another ticket cannot supply it', () => {
    const events = [
      commented('T-1', formatFailureComment(['first'])),
      commented('T-2', formatFailureComment(['someone else'])),
      commented('T-1', formatFailureComment(['second'])),
    ];
    expect(lastObservedGateOutput(events, 'T-1')).toEqual(['second']);
  });

  it('W21-90 notices and scope-widened rows are not gate output', () => {
    const events = [
      commented('T-1', 'write_scope widened with src/a.ts — the acceptance needed it'),
      commented('T-1', 'THIS CLOSE REVERSES A REJECTION THAT WAS NOT ADDRESSED. …'),
    ];
    expect(lastObservedGateOutput(events, 'T-1')).toBeNull();
  });
});
