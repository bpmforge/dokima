import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import {
  claimTicket,
  closeTicket,
  createTicket,
  getTicket,
  startTicket,
} from '@dokima/tickets';
import { createWorktree } from '@dokima/git';
import { git } from '@dokima/git';
import { runReviewPass, type ReviewPassOptions } from './loop-review.js';

/**
 * W15-01 red fixtures. Law 9(a): `reviewChat` is an injected fake; the
 * only thing that really executes is the CORE's own re-run of a shell
 * fixture command inside a real temp worktree — no network, no models.
 */

const NOW = () => '2026-08-20T00:00:00.000Z';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function fixture(
  verify: string,
  ticketVerify: string | null = verify,
): Promise<{ log: EventLog; repoRoot: string }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-review-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-review-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  createTicket(log, 'worker-1', {
    id: 'T-1',
    type: 'task',
    title: 'Ship the fixture',
    lane: 'core',
    writeScope: ['src/**'],
    verify: ticketVerify,
    acceptance: [{ id: 'AC-1', text: 'the fixture ships', done: false }],
  });
  claimTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });
  startTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });
  const worktree = await createWorktree({
    repoRoot,
    ticketId: 'T-1',
    slug: 'ship-the-fixture',
    baseRef: 'main',
  });
  await fs.writeFile(path.join(worktree.path, 'work.txt'), 'done\n');
  await git(worktree.path, ['add', '--', 'work.txt']);
  await git(worktree.path, ['commit', '-m', 'T-1: work']);
  const sha = (await git(worktree.path, ['rev-parse', 'HEAD'])).stdout.trim();
  closeTicket(log, {
    ticketId: 'T-1',
    actorId: 'worker-1',
    files: ['work.txt'],
    verify: { command: verify, exitCode: 0 },
    commits: [sha],
  });

  cleanups.push(async () => {
    log.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(dbDir, { recursive: true, force: true });
  });
  return { log, repoRoot };
}

function options(
  log: EventLog,
  repoRoot: string,
  overrides: Partial<ReviewPassOptions> = {},
): ReviewPassOptions {
  return {
    log,
    actorId: 'worker-1',
    runId: 'run-1',
    repoRoot,
    makerModel: 'local-coder',
    reviewerModel: 'big-reviewer',
    reviewChat: async () =>
      '{"verdict":"CONFIRMED","score":8,"reasoning":"work.txt exists and verify passes."}',
    now: NOW,
    ...overrides,
  };
}

const events = (log: EventLog, type: string) =>
  listEvents(log).filter((e) => e.eventType === type);

describe('runReviewPass (W15-01)', () => {
  it('P6-18: with no ticket verify, the re-run uses the close manifest command the gate already proved — not the workspace default', async () => {
    const { log, repoRoot } = await fixture('printf "2 tests passed\\n"', null);
    const outcomes = await runReviewPass(options(log, repoRoot));

    expect(outcomes[0]).toMatchObject({ status: 'recorded', verdict: 'CONFIRMED' });
    const comment = getTicket(log, 'T-1')!
      .history.filter((h) => h.verb === 'comment')
      .at(-1)!;
    expect(comment.body).toContain('re-ran independently: printf');
    expect(comment.body).not.toContain('pnpm lint');
  });

  it('RED FIXTURE: a passing ticket gets a CONFIRMED verdict whose comment carries the re-ran-independently line — executed by the core, not claimed by the model', async () => {
    const { log, repoRoot } = await fixture('printf "3 tests passed\\n"');
    const outcomes = await runReviewPass(options(log, repoRoot));

    expect(outcomes).toEqual([
      {
        ticketId: 'T-1',
        status: 'recorded',
        verdict: 'CONFIRMED',
        score: 8,
        action: 'ACCEPT',
      },
    ]);
    const ticket = getTicket(log, 'T-1')!;
    const comment = ticket.history.filter((h) => h.verb === 'comment').at(-1)!;
    expect(comment.body).toContain('Review verdict: CONFIRMED');
    expect(comment.body).toContain('re-ran independently: printf');
    expect(comment.body).toContain('"passed":3');
    expect(comment.body).toContain('exit 0');
    expect(events(log, 'review.verdict')).toHaveLength(1);
  });

  it('RED FIXTURE: a same-model install refuses machine review with the honest sentence — never a laundered self-review (C-4, Law 9b)', async () => {
    const { log, repoRoot } = await fixture('true');
    const outcomes = await runReviewPass(
      options(log, repoRoot, { reviewerModel: 'local-coder' }),
    );
    expect(outcomes[0]).toMatchObject({
      status: 'skipped',
      reason: 'same model as maker',
    });
    const comment = getTicket(log, 'T-1')!
      .history.filter((h) => h.verb === 'comment')
      .at(-1)!;
    expect(comment.body).toContain('never reviews its own work');
    expect(comment.body).toContain('review this ticket yourself');
    expect(events(log, 'review.verdict')).toHaveLength(0);
  });

  it('RED FIXTURE: an unparseable verdict is bounced (one retry), never counted', async () => {
    const { log, repoRoot } = await fixture('true');
    let calls = 0;
    const outcomes = await runReviewPass(
      options(log, repoRoot, {
        reviewChat: async () => {
          calls += 1;
          return 'I feel good about this one!';
        },
      }),
    );
    expect(calls).toBe(2);
    expect(outcomes[0]).toMatchObject({
      status: 'bounced',
      reason: 'unparseable verdict',
    });
    expect(events(log, 'review.bounced').length).toBeGreaterThanOrEqual(2);
    expect(events(log, 'review.verdict')).toHaveLength(0);
  });

  it("RED FIXTURE: when the core's independent re-run FAILS, the verdict is CONTRADICTED by construction — the model's CONFIRMED cannot out-vote the gate (C-2)", async () => {
    const { log, repoRoot } = await fixture('exit 1');
    const outcomes = await runReviewPass(options(log, repoRoot));
    expect(outcomes[0]).toMatchObject({ status: 'recorded', verdict: 'CONTRADICTED' });
    const comment = getTicket(log, 'T-1')!
      .history.filter((h) => h.verb === 'comment')
      .at(-1)!;
    expect(comment.body).toContain('CONTRADICTED by construction');
    expect(comment.body).toContain('exit 1');
  });

  it('no reviewer configured skips with a ledgered reason, and nothing is accepted by any path', async () => {
    const { log, repoRoot } = await fixture('true');
    const outcomes = await runReviewPass(options(log, repoRoot, { reviewerModel: null }));
    expect(outcomes[0]).toMatchObject({ status: 'skipped' });
    expect(events(log, 'review.skipped')).toHaveLength(1);
    // The verdict machinery NEVER accepts: the ticket is still in_review.
    expect(getTicket(log, 'T-1')!.status).toBe('in_review');
  });
});

describe('reviewer availability (W15-01)', () => {
  it('a reviewer endpoint that is down skips honestly — a run that landed real work never crashes over its reviewer', async () => {
    const { log, repoRoot } = await fixture('true');
    const outcomes = await runReviewPass(
      options(log, repoRoot, {
        reviewChat: async () => {
          throw new Error('endpoint unreachable');
        },
      }),
    );
    expect(outcomes[0]).toMatchObject({ status: 'skipped' });
    expect(events(log, 'review.skipped')).toHaveLength(1);
    expect(getTicket(log, 'T-1')!.status).toBe('in_review');
  });
});

describe('calibration reaches the verdict (W15-02)', () => {
  const OVERCLAIMER = {
    model: 'local-coder',
    phase: 'coding-agent',
    bias: 0,
    sampleCount: 6,
    meanRawConf: 1,
    meanVerifiedConf: 0,
    updatedAt: '2026-08-20T00:00:00.000Z',
  };

  it('RED FIXTURE: a borderline score from a chronic over-claimer escalates to a person, and the comment says why — the same score from a clean maker stays bounded polish', async () => {
    const borderline = async () =>
      '{"verdict":"CONFIRMED","score":6,"reasoning":"Looks fine but thin tests."}';

    const clean = await fixture('true');
    const cleanOutcome = await runReviewPass(
      options(clean.log, clean.repoRoot, { reviewChat: borderline }),
    );
    expect(cleanOutcome[0]).toMatchObject({ action: 'BOUNDED_POLISH' });

    const flagged = await fixture('true');
    const flaggedOutcome = await runReviewPass(
      options(flagged.log, flagged.repoRoot, {
        reviewChat: borderline,
        makerCalibration: () => OVERCLAIMER,
      }),
    );
    expect(flaggedOutcome[0]).toMatchObject({ action: 'ESCALATE_TO_HUMAN' });
    const comment = getTicket(flagged.log, 'T-1')!
      .history.filter((h) => h.verb === 'comment')
      .at(-1)!;
    expect(comment.body).toContain('claimed done more often than the gate confirmed');
  });

  it('an over-claimer never gains acceptance from calibration: score 8 stays ACCEPT, score 6 never becomes ACCEPT', async () => {
    const { log, repoRoot } = await fixture('true');
    const outcome = await runReviewPass(
      options(log, repoRoot, { makerCalibration: () => OVERCLAIMER }),
    );
    expect(outcome[0]).toMatchObject({ score: 8, action: 'ACCEPT' });
  });
});

describe('the C-4 refusal set covers every rung (W16-01)', () => {
  it("a reviewer matching ANY model that made work this run refuses — a ticket that landed on R2 must not be reviewed by R2's model", async () => {
    const { log, repoRoot } = await fixture('true');
    const outcomes = await runReviewPass(
      options(log, repoRoot, {
        makerModel: 'cheap-local',
        makerModels: ['cheap-local', 'frontier'],
        reviewerModel: 'frontier',
      }),
    );
    expect(outcomes[0]).toMatchObject({
      status: 'skipped',
      reason: 'same model as maker',
    });
    expect(events(log, 'review.verdict')).toHaveLength(0);
  });
});
