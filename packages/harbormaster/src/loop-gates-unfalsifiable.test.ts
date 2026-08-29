/**
 * W21-50. I wrote two of these myself with W21-48's add-ticket, an hour apart,
 * and the gate had nothing to say about either: PLAN-vault-001a and
 * PLAN-vault-001b both carried acceptance `npm run typecheck`, which passes
 * whether or not the work was done. The first landed having changed one line
 * and skipped the file it was created for.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '@dokima/git';
import {
  unfalsifiableCriteria,
  unfalsifiableReason,
  baseProbeId,
  baseProbePath,
  isBaseProbeWorktree,
} from './loop-gates-unfalsifiable.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function repo(): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'unfalsifiable-'));
  dirs.push(dir);
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 't@dokima.test']);
  await git(dir, ['config', 'user.name', 'T']);
  await fs.writeFile(path.join(dir, 'marker.txt'), 'base\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

const run = (id: string, command: string) => ({
  id,
  command,
  exitCode: 0,
  ranNothing: false,
});

describe('unfalsifiableCriteria (W21-50)', () => {
  it('RED FIXTURE: a criterion that passes at BASE too certifies nothing', async () => {
    const dir = await repo();
    const found = await unfalsifiableCriteria({
      repoRoot: dir,
      ticketId: 'T-1',
      baseRef: 'main',
      // Passes everywhere, exactly like `npm run typecheck` did on my tickets.
      runs: [run('AC-1', 'node -e "process.exit(0)"')],
      timeoutMs: 30_000,
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe('AC-1');
  }, 40_000);

  it('a criterion that FAILS at base is a real check — it is not reported', async () => {
    const dir = await repo();
    // Fails at base (no such file), so a pass in the worktree means the ticket
    // did something.
    const found = await unfalsifiableCriteria({
      repoRoot: dir,
      ticketId: 'T-2',
      baseRef: 'main',
      runs: [run('AC-1', 'cat made-by-ticket.txt')],
      timeoutMs: 30_000,
    });
    expect(found).toEqual([]);
  }, 40_000);

  it('a criterion that FAILED in the worktree is skipped — the gate is already refusing', async () => {
    const dir = await repo();
    const found = await unfalsifiableCriteria({
      repoRoot: dir,
      ticketId: 'T-3',
      baseRef: 'main',
      runs: [{ id: 'AC-1', command: 'node -e "process.exit(0)"', exitCode: 1, ranNothing: false }],
      timeoutMs: 30_000,
    });
    expect(found).toEqual([]);
  });

  it('a vacuously-green run is W21-41’s business, not this one — no double refusal', async () => {
    const dir = await repo();
    const found = await unfalsifiableCriteria({
      repoRoot: dir,
      ticketId: 'T-4',
      baseRef: 'main',
      runs: [{ id: 'AC-1', command: 'node --test nope/*.spec.ts', exitCode: 0, ranNothing: true }],
      timeoutMs: 30_000,
    });
    expect(found).toEqual([]);
  });

  it('no criteria means no probe — the expensive half never runs for nothing', async () => {
    const dir = await repo();
    expect(
      await unfalsifiableCriteria({
        repoRoot: dir,
        ticketId: 'T-5',
        baseRef: 'main',
        runs: [],
        timeoutMs: 30_000,
      }),
    ).toEqual([]);
  });

  it('a probe that cannot be built refuses NOTHING — infrastructure must not reject real work', async () => {
    const dir = await repo();
    const found = await unfalsifiableCriteria({
      repoRoot: dir,
      ticketId: 'T-6',
      baseRef: 'no-such-ref-anywhere',
      runs: [run('AC-1', 'node -e "process.exit(0)"')],
      timeoutMs: 30_000,
    });
    expect(found).toEqual([]);
  }, 40_000);
});

describe('unfalsifiableReason (W21-50)', () => {
  it('names the criterion and what would fix it', () => {
    const [reason] = unfalsifiableReason([{ id: 'AC-1', command: 'npm run typecheck' }]);
    expect(reason).toContain('AC-1');
    expect(reason).toContain('npm run typecheck');
    expect(reason).toContain('BASE');
    expect(reason).toContain('FAILS before the work');
  });
});

describe('a base probe is nameable, so a stale one can be recognised (W22-14)', () => {
  it('the id is built in one place, and the path agrees with it', () => {
    // The id used to be spelt inline where the probe is created and again in
    // baseProbePath — two constructions of the same string, either free to
    // drift from createWorktree's real layout.
    expect(baseProbeId('PLAN-tally-01')).toBe('PLAN-tally-01--base-probe');
    expect(baseProbePath('/repo', 'PLAN-tally-01')).toBe(
      '/repo/.dokima/worktrees/PLAN-tally-01--base-probe',
    );
  });

  it('RED FIXTURE: a probe worktree is distinguishable from a ticket’s', () => {
    // This is what `dokima doctor` could not do. A leftover probe was reported
    // as a bare directory name, reading like a ticket whose record had
    // vanished — sending someone to look for a ticket that never existed.
    expect(isBaseProbeWorktree('PLAN-tally-01--base-probe')).toBe(true);
    expect(isBaseProbeWorktree('PLAN-tally-01')).toBe(false);
  });

  it('does not mistake a ticket that merely contains the words', () => {
    // The suffix is anchored: only a name that ENDS with it is a probe.
    expect(isBaseProbeWorktree('W1-01--base-probe-notes')).toBe(false);
  });
});
