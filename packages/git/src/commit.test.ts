import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitWithScopeCheck, getStagedPaths } from './commit.js';
import { createWorktree, destroyWorktree, type WorktreeHandle } from './worktree.js';
import { git } from './git-cli.js';
import { createTempRepo, type TempRepo } from './test-helpers.js';

describe('commitWithScopeCheck', () => {
  let repo: TempRepo | undefined;
  let handle: WorktreeHandle | undefined;

  afterEach(async () => {
    if (handle) await destroyWorktree(handle, { deleteBranch: true });
    await repo?.cleanup();
    repo = undefined;
    handle = undefined;
  });

  it('stages explicit paths and commits when everything is in scope', async () => {
    repo = await createTempRepo();
    handle = await createWorktree({
      repoRoot: repo.repoRoot,
      ticketId: 'W0-06',
      slug: 'git worktree service',
    });

    const filePath = path.join(handle.path, 'packages', 'git', 'src', 'new-file.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const x = 1;\n');

    const result = await commitWithScopeCheck(handle, {
      paths: ['packages/git/src/new-file.ts'],
      message: 'feat(W0-06): add new-file',
      writeScope: ['packages/git/**'],
    });

    expect(result.committed).toBe(true);
    expect(result.violations).toEqual([]);

    const { stdout: log } = await git(handle.path, ['log', '-1', '--pretty=%s']);
    expect(log).toBe('feat(W0-06): add new-file');
  });

  it('refuses to commit and unstages when a staged path is outside write_scope', async () => {
    repo = await createTempRepo();
    handle = await createWorktree({
      repoRoot: repo.repoRoot,
      ticketId: 'W0-06',
      slug: 'git worktree service',
    });

    const inScope = path.join(handle.path, 'packages', 'git', 'src', 'ok.ts');
    const outOfScope = path.join(handle.path, 'packages', 'events', 'src', 'sneaky.ts');
    await fs.mkdir(path.dirname(inScope), { recursive: true });
    await fs.mkdir(path.dirname(outOfScope), { recursive: true });
    await fs.writeFile(inScope, 'export const ok = 1;\n');
    await fs.writeFile(outOfScope, 'export const sneaky = 1;\n');

    const result = await commitWithScopeCheck(handle, {
      paths: ['packages/git/src/ok.ts', 'packages/events/src/sneaky.ts'],
      message: 'feat(W0-06): should be refused',
      writeScope: ['packages/git/**'],
    });

    expect(result.committed).toBe(false);
    expect(result.violations).toEqual([
      { path: 'packages/events/src/sneaky.ts', reason: 'outside-scope' },
    ]);

    // Refusing must not leave anything staged and must not create a commit.
    expect(await getStagedPaths(handle)).toEqual([]);
    const { stdout: log } = await git(handle.path, ['log', '-1', '--pretty=%s']);
    expect(log).toBe('chore: initial commit');
  });
});

/**
 * W21-60. `git commit` with an empty index exits non-zero, so this used to
 * throw out of commitWithScopeCheck and out of the agent tool's {ok, reason}
 * contract entirely — the maker got an exception where every other refusal
 * gives it a sentence it can act on.
 *
 * Live: run 44's session called commit once, the branch tip did not move, and
 * the file it had just written was still unstaged. It then spent the rest of
 * its budget without trying again.
 */
describe('an empty index is a refusal, not an exception (W21-60)', () => {
  let repo: TempRepo | undefined;
  let handle: WorktreeHandle | undefined;

  afterEach(async () => {
    if (handle) await destroyWorktree(handle, { deleteBranch: true });
    await repo?.cleanup();
    repo = undefined;
    handle = undefined;
  });

  const setup = async (): Promise<WorktreeHandle> => {
    repo = await createTempRepo();
    handle = await createWorktree({
      repoRoot: repo.repoRoot,
      ticketId: 'W21-60',
      slug: 'empty index',
    });
    return handle;
  };

  it('RED FIXTURE: committing a path with no changes refuses rather than throwing', async () => {
    const wt = await setup();
    const filePath = path.join(wt.path, 'packages', 'git', 'src', 'untouched.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const x = 1;\n');
    await commitWithScopeCheck(wt, {
      paths: ['packages/git/src/untouched.ts'],
      message: 'first',
      writeScope: ['packages/git/**'],
    });

    // Committing the SAME path again stages nothing — the live shape.
    const again = await commitWithScopeCheck(wt, {
      paths: ['packages/git/src/untouched.ts'],
      message: 'again',
      writeScope: ['packages/git/**'],
    });
    expect(again.committed).toBe(false);
    expect(again.nothingStaged).toBe(true);
    expect(again.violations).toEqual([]);
  });

  it('a real change still commits and is not reported as nothingStaged', async () => {
    const wt = await setup();
    const filePath = path.join(wt.path, 'packages', 'git', 'src', 'real.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const a = 1;\n');
    const result = await commitWithScopeCheck(wt, {
      paths: ['packages/git/src/real.ts'],
      message: 'real change',
      writeScope: ['packages/git/**'],
    });
    expect(result.committed).toBe(true);
    expect(result.nothingStaged).toBeUndefined();
  });

  it('a scope violation is still a scope violation — the two are told apart', async () => {
    const wt = await setup();
    const filePath = path.join(wt.path, 'outside.ts');
    await fs.writeFile(filePath, 'export const x = 1;\n');
    const result = await commitWithScopeCheck(wt, {
      paths: ['outside.ts'],
      message: 'outside',
      writeScope: ['packages/git/**'],
    });
    expect(result.committed).toBe(false);
    expect(result.nothingStaged).toBeUndefined();
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
