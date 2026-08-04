import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '@dokima/git';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProject } from './registry-verbs.js';

/**
 * W10-79. `New Product` created a bare directory with a `.dokima/` in it and
 * nothing else. That was invisible until W10-77 landed the agentic loop, which
 * claims each ticket into a real git worktree branched from the project root —
 * so every product the Fleet had ever created would have failed on its first
 * claim, and the loop was only ever proven this session against a repository
 * initialised by hand.
 */
describe('registerProject makes a new product a git repository (W10-79)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratch(): Promise<{ registryPath: string; projectPath: string }> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1079-'));
    dirs.push(home);
    return {
      registryPath: path.join(home, 'fleet.json'),
      projectPath: path.join(home, 'product'),
    };
  }

  it('RED FIXTURE: a new product has a git repo with a real fork point to branch from', async () => {
    const { registryPath, projectPath } = await scratch();

    await registerProject(registryPath, { path: projectPath, mode: 'new' });

    // `git rev-parse HEAD` is the assertion that matters: `createWorktree`
    // branches from a fork point, so an initialised repo with no commit would
    // still fail the loop's first claim.
    const { stdout } = await git(projectPath, ['rev-parse', 'HEAD']);
    expect(stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('ignores the event log, so an agent session can never commit state.db', async () => {
    const { registryPath, projectPath } = await scratch();
    await registerProject(registryPath, { path: projectPath, mode: 'new' });

    // The state.db really exists by now (ensureStateDb ran) — this asserts git
    // does not see it, not merely that a .gitignore line was written.
    const { stdout } = await git(projectPath, ['status', '--porcelain']);
    expect(stdout).not.toContain('.dokima');
  });

  it('leaves a directory that is ALREADY a repo root alone — history and .gitignore untouched', async () => {
    const { registryPath, projectPath } = await scratch();
    await fs.mkdir(projectPath, { recursive: true });
    await git(projectPath, ['init', '-b', 'main']);
    await git(projectPath, ['config', 'user.email', 'someone@example.com']);
    await git(projectPath, ['config', 'user.name', 'Someone']);
    await fs.writeFile(path.join(projectPath, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(projectPath, 'README.md'), '# theirs\n');
    await git(projectPath, ['add', '-A']);
    await git(projectPath, ['commit', '-m', 'their commit']);
    const { stdout: before } = await git(projectPath, ['rev-parse', 'HEAD']);

    await registerProject(registryPath, { path: projectPath, mode: 'new' });

    const { stdout: after } = await git(projectPath, ['rev-parse', 'HEAD']);
    expect(after.trim()).toBe(before.trim());
    expect(await fs.readFile(path.join(projectPath, '.gitignore'), 'utf8')).toBe(
      'node_modules/\n',
    );
  });

  it('initialises its OWN repo when created inside someone else’s, never adopting the parent', async () => {
    const { registryPath, projectPath } = await scratch();
    const parent = path.dirname(projectPath);
    await git(parent, ['init', '-b', 'main']);

    await registerProject(registryPath, { path: projectPath, mode: 'new' });

    // Adopting the parent would put `sw/<ticket>` branches and agent commits in
    // a repository the founder never pointed at — a worse surprise than a
    // nested repo, which is why this is the deliberate choice.
    const { stdout } = await git(projectPath, ['rev-parse', '--show-toplevel']);
    // realpath both sides: macOS temp dirs are symlinks (/var -> /private/var),
    // which is the same trap the implementation had to handle.
    expect(await fs.realpath(stdout.trim())).toBe(await fs.realpath(projectPath));
  });

  it('does not touch git for import/onboard — those are directories someone already owns', async () => {
    const { registryPath, projectPath } = await scratch();
    await fs.mkdir(projectPath, { recursive: true });

    await registerProject(registryPath, { path: projectPath, mode: 'import' });

    await expect(git(projectPath, ['rev-parse', '--git-dir'])).rejects.toThrow();
  });
});
