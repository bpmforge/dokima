/**
 * W21-90. A rejection is the most specific thing anyone knows about a ticket,
 * and it arrived as advice a maker could decline. These fixtures are the live
 * Tally sequence: reject naming package.json, close touching everything else.
 */
import { describe, expect, it } from 'vitest';
import {
  rejectionNamedPaths,
  unaddressedRejectionNotice,
} from './loop-gates-close.js';

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
