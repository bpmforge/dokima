import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { computeChangedPaths, detectScopeViolations } from './session-scope.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

interface TempRepo {
  repoRoot: string;
  cleanup: () => Promise<void>;
}

/** A throwaway git repo (main branch, one commit, local identity) for tests. */
async function createTempRepo(): Promise<TempRepo> {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'shipwright-loop-session-test-'),
  );
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.mkdir(path.join(repoRoot, 'packages', 'loop', 'src'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return { repoRoot, cleanup: () => fs.rm(repoRoot, { recursive: true, force: true }) };
}

describe('detectScopeViolations', () => {
  it('reports no violations when every changed path matches a write_scope glob', () => {
    const violations = detectScopeViolations(
      ['packages/loop/src/session.ts', 'packages/loop/src/handoff.ts'],
      ['packages/loop/src/session*', 'packages/loop/src/handoff*'],
    );
    expect(violations).toEqual([]);
  });

  it('reports paths that match no write_scope glob', () => {
    const violations = detectScopeViolations(
      ['packages/loop/src/session.ts', 'packages/events/src/index.ts'],
      ['packages/loop/src/session*'],
    );
    expect(violations).toEqual(['packages/events/src/index.ts']);
  });

  it('matches ** across any depth', () => {
    const violations = detectScopeViolations(
      ['packages/loop/src/deep/nested/file.ts'],
      ['packages/loop/**'],
    );
    expect(violations).toEqual([]);
  });
});

describe('computeChangedPaths', () => {
  let repo: TempRepo | undefined;

  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  it('reports a modified tracked file', async () => {
    repo = await createTempRepo();
    await fs.writeFile(path.join(repo.repoRoot, 'README.md'), '# fixture changed\n');
    const changed = await computeChangedPaths(repo.repoRoot);
    expect(changed).toEqual(['README.md']);
  });

  it('reports a new untracked file', async () => {
    repo = await createTempRepo();
    await fs.writeFile(
      path.join(repo.repoRoot, 'packages', 'loop', 'src', 'session.ts'),
      'export {};\n',
    );
    const changed = await computeChangedPaths(repo.repoRoot);
    expect(changed).toEqual(['packages/loop/src/session.ts']);
  });

  it('reports a staged (added but uncommitted) file', async () => {
    repo = await createTempRepo();
    const filePath = path.join(repo.repoRoot, 'packages', 'loop', 'src', 'handoff.ts');
    await fs.writeFile(filePath, 'export {};\n');
    await git(repo.repoRoot, ['add', '--', 'packages/loop/src/handoff.ts']);
    const changed = await computeChangedPaths(repo.repoRoot);
    expect(changed).toEqual(['packages/loop/src/handoff.ts']);
  });

  it('reports no changes on a clean worktree', async () => {
    repo = await createTempRepo();
    const changed = await computeChangedPaths(repo.repoRoot);
    expect(changed).toEqual([]);
  });

  it('combines observed diff with detectScopeViolations to flag an out-of-scope edit', async () => {
    repo = await createTempRepo();
    await fs.writeFile(path.join(repo.repoRoot, 'README.md'), '# out of scope edit\n');
    await fs.writeFile(
      path.join(repo.repoRoot, 'packages', 'loop', 'src', 'session.ts'),
      'export {};\n',
    );
    const changed = await computeChangedPaths(repo.repoRoot);
    const violations = detectScopeViolations(changed, ['packages/loop/src/session*']);
    expect(violations).toEqual(['README.md']);
  });
});
