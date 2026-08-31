// remediate.test.mjs — P2-03 suite for bounded mechanical remediation.
// RED provenance: pre-ticket, a formatter-class failure consumed a full
// coding attempt (the founding incident's Attempt One). The out-of-scope
// rejection case is the acceptance's own negative control.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { remediablePlan, outOfScopeFixes, applyRemediation } from './remediate.mjs';

const FIX = [{ match: 'pnpm lint', cmd: ['pnpm', ['lint', '--fix']] }];
const failCmd = (command) => ({ command, exitCode: 1, tailOfOutput: 'x' });
const okCmd = (command) => ({ command, exitCode: 0, tailOfOutput: '' });

describe('remediablePlan (P2-03)', () => {
  it('plans a fix when EVERY failed command has an approved autofix', () => {
    const plan = remediablePlan(
      { commands: [okCmd('pnpm typecheck'), failCmd('pnpm lint')] },
      FIX,
    );
    expect(plan).toEqual([['pnpm', ['lint', '--fix']]]);
  });

  it('one unfixable failure disqualifies the whole receipt — half-fixes hide the other half', () => {
    expect(
      remediablePlan({ commands: [failCmd('pnpm lint'), failCmd('pnpm test')] }, FIX),
    ).toBeNull();
  });

  it('a green receipt plans nothing', () => {
    expect(remediablePlan({ commands: [okCmd('pnpm lint')] }, FIX)).toBeNull();
  });
});

describe('outOfScopeFixes (P2-03)', () => {
  it('flags exactly the files no scope or allowlist glob covers', () => {
    const scope = [/^src\/mod\//];
    const always = [/^pnpm-lock\.yaml$/];
    expect(
      outOfScopeFixes(
        ['src/mod/a.ts', 'pnpm-lock.yaml', 'src/other/b.ts'],
        scope,
        always,
      ),
    ).toEqual(['src/other/b.ts']);
  });
});

describe('applyRemediation (P2-03)', () => {
  let wt;
  beforeEach(() => {
    wt = mkdtempSync(join(tmpdir(), 'remediate-'));
    const g = (...a) => execFileSync('git', a, { cwd: wt, encoding: 'utf8' });
    g('init', '-q');
    writeFileSync(join(wt, 'in-scope.txt'), 'unfixed\n');
    writeFileSync(join(wt, 'out-of-scope.txt'), 'untouched\n');
    g('add', '.');
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'],
      { cwd: wt },
    );
  });
  afterEach(() => rmSync(wt, { recursive: true, force: true }));

  // A fake sh: the "autofix" edits files; git commands pass through for real.
  const shWith = (autofix) => (cmd, args, opts) => {
    if (cmd === 'git')
      return execFileSync('git', args, { cwd: wt, encoding: 'utf8', ...opts });
    autofix();
    return '';
  };

  it('in-scope fix commits an amendment and reports applied', () => {
    const sh = shWith(() => writeFileSync(join(wt, 'in-scope.txt'), 'fixed\n'));
    const res = applyRemediation({
      wt,
      ticketId: 'T-1',
      plan: [['fake-fixer', []]],
      scopeRes: [/^in-scope\.txt$/],
      alwaysOkRes: [],
      sh,
    });
    expect(res.applied).toBe(true);
    expect(res.changed).toEqual(['in-scope.txt']);
    const last = execFileSync('git', ['log', '-1', '--format=%s'], {
      cwd: wt,
      encoding: 'utf8',
    });
    expect(last).toContain('mechanical remediation');
    expect(last).toContain('no coding attempt consumed');
  });

  it('an autofix touching an OUT-OF-SCOPE file is rejected WHOLE and reverted', () => {
    const sh = shWith(() => {
      writeFileSync(join(wt, 'in-scope.txt'), 'fixed\n');
      writeFileSync(join(wt, 'out-of-scope.txt'), 'sneaky edit\n');
    });
    const res = applyRemediation({
      wt,
      ticketId: 'T-1',
      plan: [['fake-fixer', []]],
      scopeRes: [/^in-scope\.txt$/],
      alwaysOkRes: [],
      sh,
    });
    expect(res.applied).toBe(false);
    expect(res.rejected).toEqual(['out-of-scope.txt']);
    // WHOLE pass reverted — the in-scope half must not survive either
    expect(readFileSync(join(wt, 'in-scope.txt'), 'utf8')).toBe('unfixed\n');
    expect(readFileSync(join(wt, 'out-of-scope.txt'), 'utf8')).toBe('untouched\n');
  });

  it('a no-diff autofix reports not-mechanical instead of committing emptiness', () => {
    const res = applyRemediation({
      wt,
      ticketId: 'T-1',
      plan: [['fake-fixer', []]],
      scopeRes: [/./],
      alwaysOkRes: [],
      sh: shWith(() => {}),
    });
    expect(res.applied).toBe(false);
    expect(res.error).toContain('not mechanical');
  });

  it('a crashing FIXER surfaces its error and changes nothing', () => {
    const sh = (cmd, args, opts) => {
      if (cmd === 'git')
        return execFileSync('git', args, { cwd: wt, encoding: 'utf8', ...opts });
      const e = new Error('fixer exploded');
      e.stdout = 'fixer exploded';
      throw e;
    };
    const res = applyRemediation({
      wt,
      ticketId: 'T-1',
      plan: [['fake-fixer', []]],
      scopeRes: [/./],
      alwaysOkRes: [],
      sh,
    });
    expect(res.applied).toBe(false);
    expect(res.error).toContain('fixer exploded');
  });
});
