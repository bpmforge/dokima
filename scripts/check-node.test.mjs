/**
 * W13-08. A stop hook reported "tests failed" when the suite was green — its
 * shell had a different Node than the one better-sqlite3 was built for.
 */
import { describe, expect, it } from 'vitest';
import { checkNodeSupported } from '../apps/server/src/bootstrap/node-abi-guard.mjs';
import { readEngines } from './check-node.mjs';

describe('the test runner refuses the wrong Node (W13-08)', () => {
  it('reads the supported version from engines, not a literal that can drift', () => {
    expect(readEngines()).toMatch(/^\d+\.x$/);
  });

  it(
    'RED FIXTURE: refuses a mismatched Node BY NAME. Unguarded, the suite died ' +
      'with "NODE_MODULE_VERSION 127 ... requires 147" — a message naming ' +
      'neither this product nor the fix, which is why a green suite was ' +
      'reported as failing',
    () => {
      const problem = checkNodeSupported(readEngines(), '26.7.0');
      expect(problem).not.toBeNull();
      expect(problem).toContain('unsupported Node version');
      expect(problem).toContain('26.7.0');
      // The message has to carry the fix, not just the complaint.
      expect(problem).toMatch(/fnm use \d+/);
    },
  );

  it('says nothing on a supported Node — a guard that cries wolf gets removed', () => {
    const major = readEngines().replace(/[^0-9].*$/, '');
    expect(checkNodeSupported(readEngines(), `${major}.23.1`)).toBeNull();
  });

  it(
    'reuses the W12-24 guard rather than reimplementing it. Four duplicated ' +
      'tables and dispatches have already been consolidated on this board; a ' +
      'second copy of this check would be the fifth',
    async () => {
      const { readFileSync } = await import('node:fs');
      const { stripComments } = await import('./validate-exports.mjs');
      const raw = readFileSync(new URL('./check-node.mjs', import.meta.url), 'utf8');
      expect(raw).toContain('node-abi-guard.mjs');
      // Comment-stripped, because this file's own doc comment QUOTES the ABI
      // error it exists to explain — and the first version of this assertion
      // failed on that quote. Same reason W12-39 moved the strip inside
      // countReferences: prose about a thing is not the thing.
      expect(stripComments(raw)).not.toMatch(/NODE_MODULE_VERSION\s*\d/);
    },
  );
});
