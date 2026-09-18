import { describe, expect, it } from 'vitest';
import {
  UNRUNNABLE_VERIFY_MARKER,
  unrunnableVerifyIn,
  unrunnableVerifyReason,
  verifyCommandFile,
} from './loop-gates-verify-unrunnable.js';

describe('where a verify command lives, and who may fix it (W23-30)', () => {
  it('a package script lives in package.json; a bare command lives in the ticket', () => {
    expect(verifyCommandFile('npm run test')).toBe('package.json');
    expect(verifyCommandFile('pnpm lint && pnpm typecheck && pnpm test')).toBe(
      'package.json',
    );
    expect(verifyCommandFile('yarn test')).toBe('package.json');
    expect(verifyCommandFile('node --test src/crypto/argon2id.spec.ts')).toBeNull();
    expect(verifyCommandFile('true')).toBeNull();
  });

  it('RED FIXTURE (Vault, 2026-09-18): package.json outside write_scope is a board-level sentence with the marker', () => {
    const reason = unrunnableVerifyReason('npm run test', ['src/crypto/argon2id.ts']);
    expect(reason).not.toBeNull();
    expect(reason!.startsWith(UNRUNNABLE_VERIFY_MARKER)).toBe(true);
    expect(reason).toContain('package.json');
    expect(reason).toContain("outside this ticket's write_scope");
    expect(unrunnableVerifyIn(['verify ran NOTHING: …', reason!])).toBe(reason);
  });

  it('a ticket that MAY change the file, or that owns the command, gets no board-level claim', () => {
    expect(unrunnableVerifyReason('npm run test', ['package.json', 'src/**'])).toBeNull();
    expect(unrunnableVerifyReason('npm run test', ['**'])).toBeNull();
    expect(unrunnableVerifyReason('node --test src/x.spec.ts', ['src/**'])).toBeNull();
    expect(unrunnableVerifyReason('npm run test', undefined)).toBeNull();
    expect(unrunnableVerifyIn(['verify ran NOTHING: …'])).toBeNull();
  });
});
