/**
 * W21-83. Tally's PLAN-tally-01 parked "ladder attempt cap reached" while
 * `npm run build` exited 0 in its worktree. 72 tool calls — 14 commits, ZERO
 * verify — so the maker finished the job and never found out, and the close
 * gate never ran because there was no manifest to run it against.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '@dokima/git';
import {
  DERIVED_BY_HARNESS,
  deriveManifest,
  NOTHING_TO_REPORT,
  silentCompletion,
  silentCompletionGap,
  type SilentCompletion,
} from './loop-land-session-acceptance.js';

const dirs: string[] = [];
async function worktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'silent-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const ac = (...texts: string[]) => texts.map((text, i) => ({ id: `AC-${i + 1}`, text }));
const TIMEOUT = 30_000;

describe('a session that finished and could not say so', () => {
  it('reports complete when every criterion passes', async () => {
    const found = await silentCompletion({
      worktreePath: await worktree(),
      criteria: ac('node -e "process.exit(0)"'),
      timeoutMs: TIMEOUT,
    });
    expect(found.complete).toBe(true);
    expect(found.passing).toEqual(['node -e "process.exit(0)"']);
  });

  it('reports nothing when a criterion fails — the ordinary case', async () => {
    const found = await silentCompletion({
      worktreePath: await worktree(),
      criteria: ac('node -e "process.exit(1)"'),
      timeoutMs: TIMEOUT,
    });
    expect(found).toEqual(NOTHING_TO_REPORT);
  });

  it('one failing criterion is enough to report nothing', async () => {
    const found = await silentCompletion({
      worktreePath: await worktree(),
      criteria: ac('node -e "process.exit(0)"', 'node -e "process.exit(1)"'),
      timeoutMs: TIMEOUT,
    });
    expect(found.complete).toBe(false);
  });

  it('a ticket with no criteria claims nothing it never checked', async () => {
    const found = await silentCompletion({
      worktreePath: await worktree(),
      criteria: [],
      timeoutMs: TIMEOUT,
    });
    expect(found).toEqual(NOTHING_TO_REPORT);
  });

  it('prose criteria are not evidence either way', async () => {
    const found = await silentCompletion({
      worktreePath: await worktree(),
      criteria: ac('the founder agrees the copy reads well'),
      timeoutMs: TIMEOUT,
    });
    expect(found).toEqual(NOTHING_TO_REPORT);
  });
});

describe('the sentence the next attempt reads', () => {
  it('says the work is done, names the criteria, and forbids redoing it', () => {
    const gap = silentCompletionGap({ complete: true, passing: ['npm run build'] });
    expect(gap).toContain('npm run build');
    expect(gap).toContain('Do NOT redo it');
    expect(gap).toContain('Completion Manifest');
  });

  it('is silent when the work is not done, so the ordinary message stands', () => {
    expect(silentCompletionGap(NOTHING_TO_REPORT)).toBeNull();
  });
});

/**
 * W23-35. `silentCompletion` above only ever produced a SENTENCE for the next
 * attempt, and the Vault runs of 2026-09-18 proved a sentence is not enough:
 * told "your criteria already pass, just return the manifest", neither rung
 * returned one. These cover the claim the harness now writes itself — and, more
 * importantly, every case in which it declines to.
 */
const DONE: SilentCompletion = { complete: true, passing: ['node check.mjs'] };

async function repo(): Promise<string> {
  const dir = await worktree();
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'Dokima Test']);
  await git(dir, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(dir, 'README.md'), '# fixture\n');
  await git(dir, ['add', '--', 'README.md']);
  await git(dir, ['commit', '-m', 'chore: base']);
  return dir;
}

async function commitWork(dir: string, relative = 'src/file.ts'): Promise<void> {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'export const x = 1;\n');
  await git(dir, ['add', '--', relative]);
  await git(dir, ['commit', '-m', 'feat: work']);
}

const derive = (worktreePath: string, over: Record<string, unknown> = {}) =>
  deriveManifest({
    worktreePath,
    ticketId: 'W9-01',
    ticketVerify: 'true',
    criteria: ac('node -e "process.exit(0)"'),
    baseRef: 'main',
    found: DONE,
    timeoutMs: TIMEOUT,
    ...over,
  });

describe('the manifest the harness writes when the session would not', () => {
  it('derives files, commits and an OBSERVED verify from git', async () => {
    const dir = await repo();
    await git(dir, ['checkout', '-b', 'sw/W9-01']);
    await commitWork(dir);

    const manifest = await derive(dir);

    expect(manifest).not.toBeNull();
    expect(manifest!.ticket).toBe('W9-01');
    expect(manifest!.files).toEqual(['src/file.ts']);
    expect(manifest!.commits).toHaveLength(1);
    // Observed, not asserted: the command was actually re-run.
    expect(manifest!.verify).toEqual({ command: 'true', exit: 0 });
    // R-G2: the harness cannot claim memory it did not write, so it does not.
    expect(manifest!.memory_written).toBeUndefined();
  });

  it('says in its own evidence that a human did not write it', async () => {
    const dir = await repo();
    await git(dir, ['checkout', '-b', 'sw/W9-01']);
    await commitWork(dir);

    const manifest = await derive(dir);

    expect(manifest!.evidence[0]).toContain(DERIVED_BY_HARNESS);
    expect(manifest!.evidence.join('\n')).toContain('node check.mjs');
  });

  it('declines when the criteria did not pass — there is no claim to make', async () => {
    const dir = await repo();
    await git(dir, ['checkout', '-b', 'sw/W9-01']);
    await commitWork(dir);

    expect(await derive(dir, { found: NOTHING_TO_REPORT })).toBeNull();
  });

  it('declines when the session committed nothing', async () => {
    const dir = await repo();
    await git(dir, ['checkout', '-b', 'sw/W9-01']);

    expect(await derive(dir)).toBeNull();
  });

  it('declines when the verify it re-runs fails — it never claims an exit it did not see', async () => {
    const dir = await repo();
    await git(dir, ['checkout', '-b', 'sw/W9-01']);
    await commitWork(dir);

    expect(await derive(dir, { ticketVerify: 'false' })).toBeNull();
  });

  it('declines when the base ref cannot be resolved', async () => {
    const dir = await repo();
    await git(dir, ['checkout', '-b', 'sw/W9-01']);
    await commitWork(dir);

    expect(await derive(dir, { baseRef: 'no-such-ref' })).toBeNull();
  });

  it('never claims a file that was committed and then deleted', async () => {
    const dir = await repo();
    await git(dir, ['checkout', '-b', 'sw/W9-01']);
    await commitWork(dir, 'src/gone.ts');
    await commitWork(dir, 'src/kept.ts');
    await git(dir, ['rm', '--', 'src/gone.ts']);
    await git(dir, ['commit', '-m', 'chore: drop it']);

    const manifest = await derive(dir);

    // The gate stats every claimed file and refuses a missing one; claiming a
    // deleted path would manufacture that refusal rather than report the work.
    expect(manifest!.files).toEqual(['src/kept.ts']);
  });
});
