import { describe, expect, it } from 'vitest';
import {
  fabricatedScripts,
  fabricatesEvidence,
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

describe('a check that manufactures its evidence is not a check (W23-33)', () => {
  const VAULT_SCRIPT =
    'cat > smoke.spec.js <<\'VAULTSMOKEEOF\'\nconst { test } = require("node:test");\ntest("x", () => {});\nVAULTSMOKEEOF\nnode --test smoke.spec.js && rm -f smoke.spec.js';

  it('RED FIXTURE (Vault run 3, receipt 5335c2e2): the exact script that landed is refused, naming its construct', () => {
    expect(fabricatesEvidence(VAULT_SCRIPT)).toBe('heredoc');
    expect(fabricatesEvidence('node --test smoke.spec.js && rm -f smoke.spec.js')).toBe(
      'rm',
    );
    expect(fabricatesEvidence("echo 'ok' > result.txt && cat result.txt")).toBe(
      'redirect into a file',
    );
    expect(fabricatesEvidence('touch .ran && node --test')).toBe('touch');
    expect(fabricatesEvidence('vitest run | tee out.log')).toBe('tee');
  });

  it('a script that only RUNS checks is not judged — including fd redirects, which are plumbing', () => {
    for (const body of [
      'node --test',
      'node --test "src/**/*.spec.ts"',
      'vitest run --reporter=verbose 2>&1',
      'eslint . 2>/dev/null',
      'tsc --noEmit && node --test src/crypto/*.spec.ts',
      'npm run lint && npm run typecheck && npm run test',
    ]) {
      expect(fabricatesEvidence(body), body).toBeNull();
    }
  });

  it('only scripts the verify command invokes are judged — a build script that cleans dist is not a test script', () => {
    const scripts = {
      build: 'rm -rf dist && tsc',
      test: 'node --test',
      lint: 'eslint .',
    };
    expect(fabricatedScripts(scripts, ['lint', 'test'])).toEqual([]);
    expect(fabricatedScripts({ ...scripts, test: VAULT_SCRIPT }, ['test'])).toMatchObject(
      [{ name: 'test', construct: 'heredoc' }],
    );
  });
});
