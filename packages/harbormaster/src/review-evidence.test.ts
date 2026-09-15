/**
 * W23-03. Real git, real worktrees — the whole point of this module is what
 * git actually does with a repository an agent just wrote to, and a fake git
 * would assert only that the code calls the functions it calls.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '@dokima/git';
import {
  REVIEW_DIFF_LIMIT_CHARS,
  collectReviewEvidence,
  evidenceStillCurrent,
  reviewEvidenceSection,
} from './review-evidence.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function repoWithOneChange(
  second = 'export const answer = 42;\n',
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-review-evidence-'));
  dirs.push(dir);
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'a@b.c']);
  await git(dir, ['config', 'user.name', 'fixture']);
  await fs.writeFile(path.join(dir, 'app.ts'), 'export const answer = 0;\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-qm', 'base']);
  await fs.writeFile(path.join(dir, 'app.ts'), second);
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-qm', 'change']);
  return dir;
}

describe('the reviewer is shown the change, not a list of filenames', () => {
  it('carries the planted line itself', async () => {
    const dir = await repoWithOneChange(
      'export const answer = 42; // planted-by-the-test\n',
    );
    const bundle = await collectReviewEvidence({ ticketId: 'T-1', worktreePath: dir });

    expect(bundle.complete).toBe(true);
    expect(bundle.diff).toContain('planted-by-the-test');
    expect(bundle.diff).toContain('+export const answer = 42;');
    expect(bundle.files).toEqual(['app.ts']);
    expect(bundle.headCommit).toMatch(/^[0-9a-f]{40}$/);

    const section = reviewEvidenceSection(bundle);
    expect(section).toContain('planted-by-the-test');
  });

  it('a change that PASSES ITS TESTS and is insecure is still fully visible', async () => {
    // The case the old prompt could not see at all: nothing here fails, and
    // nothing about the filename says what happened inside it.
    const dir = await repoWithOneChange(
      [
        'export function isAdmin(token: string): boolean {',
        '  // authentication temporarily disabled to unblock the tests',
        '  return true;',
        '}',
        '',
      ].join('\n'),
    );
    const bundle = await collectReviewEvidence({ ticketId: 'T-1', worktreePath: dir });
    expect(bundle.complete).toBe(true);
    expect(bundle.diff).toContain('authentication temporarily disabled');
    expect(bundle.diff).toContain('return true;');
  });

  it('redacts registered values AND credential-shaped text before anything sees the diff', async () => {
    // BUILT AT RUNTIME, NOT WRITTEN AS LITERALS. The repo's own pre-commit
    // scan reads the STAGED DIFF, so a realistic-looking credential in a test
    // fixture is indistinguishable to it from a real leak — and it is right to
    // refuse. Assembling the strings keeps the fixture honest without teaching
    // anyone that the scanner can be talked past.
    const registered = ['registered', 'value', '01234567890123456789'].join('-');
    const apiKeyShaped = ['sk', 'ant', 'a'.repeat(28)].join('-');
    const dir = await repoWithOneChange(
      `const a = '${registered}';\nconst b = '${apiKeyShaped}';\n`,
    );
    const bundle = await collectReviewEvidence({
      ticketId: 'T-1',
      worktreePath: dir,
      secretValues: [registered],
    });
    expect(bundle.complete).toBe(true);
    // The exact registered value: gone.
    expect(bundle.diff).not.toContain(registered);
    // And the one nobody registered, caught by shape alone — which is the
    // case that matters, because an agent that just committed a credential did
    // not register it first.
    expect(bundle.diff).not.toContain(apiKeyShaped);
  });
});

describe('incomplete evidence is a state with a reason, never a quiet truncation', () => {
  it('an oversized change is incomplete and carries NO diff — not a half of one', async () => {
    const dir = await repoWithOneChange(`${'x'.repeat(500)}\n`.repeat(200));
    const bundle = await collectReviewEvidence({
      ticketId: 'T-1',
      worktreePath: dir,
      limitChars: 1_000,
    });
    expect(bundle.complete).toBe(false);
    expect(bundle.diff).toBe('');
    expect(bundle.reason).toMatch(/over the 1000-character review budget/);
    expect(reviewEvidenceSection(bundle)).toMatch(/Do not answer CONFIRMED/);
  });

  it('a dirty worktree is incomplete: there is no settled tree to review', async () => {
    const dir = await repoWithOneChange();
    await fs.writeFile(
      path.join(dir, 'app.ts'),
      'export const answer = 43; // uncommitted\n',
    );
    const bundle = await collectReviewEvidence({ ticketId: 'T-1', worktreePath: dir });
    expect(bundle.complete).toBe(false);
    expect(bundle.reason).toMatch(/uncommitted changes/);
  });

  it('a path that is not a repository is incomplete rather than a thrown run-ending error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-review-norepo-'));
    dirs.push(dir);
    const bundle = await collectReviewEvidence({ ticketId: 'T-1', worktreePath: dir });
    expect(bundle.complete).toBe(false);
    expect(bundle.reason).toMatch(/could not be read/);
  });

  it('the default budget is a real number, and the reason names it', async () => {
    expect(REVIEW_DIFF_LIMIT_CHARS).toBeGreaterThan(10_000);
  });
});

describe('a verdict is bound to the source it was given', () => {
  it('the digest changes when the code changes, and not otherwise', async () => {
    const dir = await repoWithOneChange();
    const first = await collectReviewEvidence({ ticketId: 'T-1', worktreePath: dir });
    const again = await collectReviewEvidence({ ticketId: 'T-1', worktreePath: dir });
    expect(again.sourceDigest).toBe(first.sourceDigest);

    await fs.writeFile(path.join(dir, 'app.ts'), 'export const answer = 43;\n');
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '-qm', 'moved on']);

    const moved = await collectReviewEvidence({ ticketId: 'T-1', worktreePath: dir });
    expect(moved.sourceDigest).not.toBe(first.sourceDigest);
  });

  it('evidence collected before a commit is no longer current after it', async () => {
    const dir = await repoWithOneChange();
    const input = { ticketId: 'T-1', worktreePath: dir };
    const bundle = await collectReviewEvidence(input);
    expect(await evidenceStillCurrent(bundle, input)).toBe(true);

    await fs.writeFile(path.join(dir, 'app.ts'), 'export const answer = 44;\n');
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '-qm', 'while the model was thinking']);

    expect(await evidenceStillCurrent(bundle, input)).toBe(false);
  });
});

describe('producing a diff must not execute the repository', () => {
  it('RED FIXTURE: a repo configuring an external diff program and a textconv filter runs neither', async () => {
    const dir = await repoWithOneChange('export const answer = 42; // real-diff-line\n');
    const marker = path.join(dir, 'EXTERNAL_DIFF_RAN');
    const script = path.join(dir, 'evil.sh');
    await fs.writeFile(
      script,
      `#!/usr/bin/env bash\ntouch '${marker}'\necho "nothing to see here"\n`,
    );
    await fs.chmod(script, 0o755);

    // Exactly the two mechanisms git will use to hand a diff to a program:
    // a global external differ, and a per-path textconv filter. Both are
    // configured the way a hostile repository would configure them.
    await git(dir, ['config', 'diff.external', script]);
    await git(dir, ['config', 'diff.evil.textconv', script]);
    await fs.writeFile(path.join(dir, '.gitattributes'), '*.ts diff=evil\n');
    await git(dir, ['add', '.gitattributes']);
    await git(dir, ['commit', '-qm', 'attributes']);

    const bundle = await collectReviewEvidence({ ticketId: 'T-1', worktreePath: dir });

    await expect(fs.access(marker)).rejects.toThrow();
    expect(bundle.diff).not.toContain('nothing to see here');
  });
});
