/**
 * W21-75. The live case: Tally, a plain npm project built through the UI, had
 * `pnpm lint && pnpm typecheck && pnpm test` — Dokima's own gate — re-run
 * against it, because decomposition writes no verify command and the fallback
 * was that literal.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveVerifyCommand, runnerFor, verifyCommandFor } from './verify-command.js';

const dirs: string[] = [];
async function tree(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-cmd-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), body);
  }
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: 'x', scripts });

describe('the runner comes from the lockfile', () => {
  it('npm for a package-lock, pnpm for a pnpm-lock, yarn for a yarn.lock', async () => {
    expect(await runnerFor(await tree({ 'package-lock.json': '{}' }))).toBe('npm');
    expect(await runnerFor(await tree({ 'pnpm-lock.yaml': '' }))).toBe('pnpm');
    expect(await runnerFor(await tree({ 'yarn.lock': '' }))).toBe('yarn');
  });

  it('a greenfield manifest with no lockfile gets npm', async () => {
    expect(await runnerFor(await tree({ 'package.json': '{}' }))).toBe('npm');
  });
});

describe('the command comes from the scripts that exist', () => {
  it('Tally: an npm project is never handed pnpm', async () => {
    const dir = await tree({
      'package.json': pkg({ build: 'tsc', lint: 'tsc --noEmit', test: 'node --test' }),
      'package-lock.json': '{}',
    });
    const command = await deriveVerifyCommand(dir);
    expect(command).toBe('npm run lint && npm run test');
    expect(command).not.toContain('pnpm');
  });

  it('skips scripts the project does not define', async () => {
    const dir = await tree({ 'package.json': pkg({ test: 'node --test' }) });
    expect(await deriveVerifyCommand(dir)).toBe('npm run test');
  });

  it('a worktree with no manifest yields nothing rather than a guess', async () => {
    expect(await deriveVerifyCommand(await tree({}))).toBeNull();
  });

  it('a manifest with none of the scripts yields nothing', async () => {
    const dir = await tree({ 'package.json': pkg({ start: 'node .' }) });
    expect(await deriveVerifyCommand(dir)).toBeNull();
  });
});

describe('verifyCommandFor', () => {
  const ac = (...t: string[]) => t.map((text) => ({ text }));

  it("the ticket's own command always wins", async () => {
    const dir = await tree({ 'package.json': pkg({ test: 'node --test' }) });
    expect(await verifyCommandFor(dir, 'make check', ac('x'))).toBe('make check');
  });

  it('falls back to the acceptance criteria the founder actually saw, not another project’s gate', async () => {
    const dir = await tree({});
    const command = await verifyCommandFor(dir, null, ac('node --test spec.ts'));
    expect(command).toBe('node --test spec.ts');
    expect(command).not.toContain('pnpm');
  });

  it('joins several criteria', async () => {
    const dir = await tree({});
    expect(await verifyCommandFor(dir, null, ac('a', 'b'))).toBe('a && b');
  });

  it('a ticket with nothing at all verifies trivially rather than running a foreign command', async () => {
    expect(await verifyCommandFor(await tree({}), null, [])).toBe('true');
  });
});
