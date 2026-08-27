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
import {
  NOTHING_TO_REPORT,
  silentCompletion,
  silentCompletionGap,
} from './loop-land-session-acceptance.js';

const dirs: string[] = [];
async function worktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'silent-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
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
