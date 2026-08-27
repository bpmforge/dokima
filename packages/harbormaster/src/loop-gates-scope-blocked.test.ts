/**
 * W21-80. The live case: Tally's PLAN-tally-01 could not pass — acceptance
 * `npm run build` (tsc), tsconfig include ["src/**\/*.ts"], write_scope
 * package.json/tsconfig.json/.gitignore. 61 tool calls, 25 writes, no src/,
 * zero refusals: the maker never tried the path it was forbidden, it just
 * rewrote the two files it was allowed to touch.
 */
import { describe, expect, it } from 'vitest';
import {
  outsideWriteScope,
  pathsInFailure,
  scopeBlockedNotice,
} from './loop-gates-scope-blocked.js';

const WT = '/w/PLAN-tally-01';

/** The real tsc output from the run, trimmed. */
const TALLY_OUTPUT = `> tally@1.0.0 lint ${WT}
> tsc --noEmit

error TS18003: No inputs were found in config file '${WT}/tsconfig.json'. Specified 'include' paths were '["src/**/*.ts"]' and 'exclude' paths were '["node_modules","dist"]'.`;

describe('the unwinnable ticket is named as such', () => {
  it('Tally: says the build needs src/ and the ticket may not write it', () => {
    const notice = scopeBlockedNotice({
      command: 'npm run build',
      output: TALLY_OUTPUT,
      writeScope: ['package.json', 'tsconfig.json', '.gitignore'],
      worktreePath: WT,
    });
    expect(notice).toContain('src/**/*.ts');
    expect(notice).toContain('npm run build');
    expect(notice).toContain('widen-scope');
  });

  it('goes quiet once the scope is widened to something under src/', () => {
    expect(
      scopeBlockedNotice({
        command: 'npm run build',
        output: TALLY_OUTPUT,
        writeScope: ['package.json', 'tsconfig.json', '.gitignore', 'src/index.ts'],
        worktreePath: WT,
      }),
    ).toBeNull();
  });

  it('says nothing about an ordinary failure with no path outside scope', () => {
    expect(
      scopeBlockedNotice({
        command: 'npm test',
        output: 'AssertionError: expected 3 to equal 4\n  at src/add.ts:12',
        writeScope: ['src/**/*.ts'],
        worktreePath: WT,
      }),
    ).toBeNull();
  });

  it('says nothing when the ticket has no write_scope to judge against', () => {
    expect(
      scopeBlockedNotice({
        command: 'npm test',
        output: TALLY_OUTPUT,
        writeScope: [],
        worktreePath: WT,
      }),
    ).toBeNull();
  });
});

describe('path extraction', () => {
  it('makes worktree-absolute paths relative so they can be compared at all', () => {
    expect(pathsInFailure(`error in '${WT}/tsconfig.json'`, WT)).toContain('tsconfig.json');
  });

  it('ignores build and dependency noise', () => {
    const found = pathsInFailure('cannot find node_modules/typescript/lib/tsc.js', WT);
    expect(found.every((p) => !p.startsWith('node_modules/'))).toBe(true);
  });
});

describe('a glob is judged by its literal prefix', () => {
  it('src/**/*.ts is covered by any write_scope entry under src/', () => {
    expect(outsideWriteScope('src/**/*.ts', ['src/index.ts'])).toBe(false);
    expect(outsideWriteScope('src/**/*.ts', ['package.json'])).toBe(true);
  });

  it('a concrete path is matched by the scope globs themselves', () => {
    expect(outsideWriteScope('src/cli/parser.ts', ['src/**/*.ts'])).toBe(false);
    expect(outsideWriteScope('src/cli/parser.ts', ['docs/**'])).toBe(true);
  });
});
