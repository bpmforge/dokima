import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  getIdentity,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import type { BreakerLevel } from '@shipwright/gateway';
import { git } from '@shipwright/git';
import {
  closeTicket,
  createTicket,
  getTicket,
  listTickets,
  type Ticket,
} from '@shipwright/tickets';
import { berthIdentityId } from '../src/berths-identity.js';
import {
  runBerths,
  type BerthTicketRunner,
  type RunBerthsOptions,
} from '../src/berths.js';
import { forEachSeedAsync, randInt } from './berths-test-helpers.js';

interface Fixture {
  repoRoot: string;
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-berths-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-berths-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'human-1', name: 'Brad', kind: 'human' });

  return {
    repoRoot,
    dbDir,
    log,
    cleanup: async () => {
      log.close();
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

function seedTicket(
  log: EventLog,
  id: string,
  lane: string,
  overrides: Partial<Parameters<typeof createTicket>[2]> = {},
): Ticket {
  return createTicket(log, 'human-1', {
    id,
    type: 'task',
    title: `Ticket ${id}`,
    lane,
    writeScope: [`lanes/${lane}/**`],
    verify: 'true',
    ...overrides,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lands a ticket immediately (no real session/close-gate — that machinery is injected in production; this is the test double). */
function landingRunner(
  log: EventLog,
  delayMs: (ticketId: string) => number,
): BerthTicketRunner {
  return async ({ ticket, actorId }) => {
    await sleep(delayMs(ticket.id));
    closeTicket(log, {
      ticketId: ticket.id,
      actorId,
      files: [`lanes/${ticket.lane}/file.txt`],
      verify: { command: 'true', exitCode: 0 },
      commits: ['deadbeef'],
    });
  };
}

const NEVER_ok: () => BreakerLevel = () => 'ok';

describe('runBerths (D-010, FR-H5)', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('mints one machine identity per berth and attributes every claim/close to it', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01', 'core');
    seedTicket(log, 'W9-02', 'infra');

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 2,
      breakerLevel: NEVER_ok,
      runTicket: landingRunner(log, () => 0),
    });

    expect(result.berths).toHaveLength(2);
    expect(result.berths.map((b) => b.actorId).sort()).toEqual([
      berthIdentityId('run-1', 1),
      berthIdentityId('run-1', 2),
    ]);
    for (const berth of result.berths) {
      expect(getIdentity(log, berth.actorId)?.role).toBe('berth');
      expect(getIdentity(log, berth.actorId)?.kind).toBe('machine');
    }

    const w901 = getTicket(log, 'W9-01') as Ticket;
    const w902 = getTicket(log, 'W9-02') as Ticket;
    expect(w901.status).toBe('in_review');
    expect(w902.status).toBe('in_review');
    expect([w901.ownerId, w902.ownerId].sort()).toEqual(
      [berthIdentityId('run-1', 1), berthIdentityId('run-1', 2)].sort(),
    );
  });

  it('landing is serialized through review: N berths land tickets to in_review, never past it, regardless of N', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01', 'core');
    seedTicket(log, 'W9-02', 'infra');
    seedTicket(log, 'W9-03', 'ui');
    seedTicket(log, 'W9-04', 'docs');

    await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 4,
      breakerLevel: NEVER_ok,
      runTicket: landingRunner(log, () => 0),
    });

    // `closeTicket` (this test's landing runner) is the only lifecycle verb
    // `runBerths`/its injected runner ever calls -- `acceptTicket` (the
    // distinct-reviewer verb that would advance a ticket past `in_review`
    // to `done`) is never invoked by this module at any berth count, so no
    // amount of parallelism can merge/accept on its own (D-018/BLUEPRINT
    // §297 NEVER-AUTO).
    const tickets = listTickets(log);
    expect(tickets.every((t) => t.status === 'in_review')).toBe(true);
    expect(tickets.some((t) => t.status === 'done')).toBe(false);
  });

  it('gives every concurrently-active ticket its own git worktree (FR-H5 "own worktree")', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01', 'core');
    seedTicket(log, 'W9-02', 'infra');
    seedTicket(log, 'W9-03', 'ui');

    const seenPaths: string[] = [];
    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 3,
      breakerLevel: NEVER_ok,
      runTicket: async ({ ticket, worktree, actorId }) => {
        seenPaths.push(worktree.path);
        expect(worktree.ticketId).toBe(ticket.id);
        const exists = await fs
          .stat(worktree.path)
          .then((s) => s.isDirectory())
          .catch(() => false);
        expect(exists).toBe(true);
        await sleep(5);
        closeTicket(log, {
          ticketId: ticket.id,
          actorId,
          files: [`lanes/${ticket.lane}/file.txt`],
          verify: { command: 'true', exitCode: 0 },
          commits: ['deadbeef'],
        });
      },
    });

    expect(new Set(seenPaths).size).toBe(3);
    expect(
      result.berths.flatMap((b) => b.processed).filter((p) => p.landed),
    ).toHaveLength(3);
  });

  it('at most one berth per lane: two tickets sharing a lane are never active at the same time, even under real concurrency', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    // Two tickets per lane across three lanes -- with 3 berths racing, a
    // buggy scheduler would happily run both same-lane tickets at once.
    seedTicket(log, 'W9-01', 'core');
    seedTicket(log, 'W9-02', 'core');
    seedTicket(log, 'W9-03', 'infra');
    seedTicket(log, 'W9-04', 'infra');
    seedTicket(log, 'W9-05', 'ui');
    seedTicket(log, 'W9-06', 'ui');

    const activeByLane = new Map<string, string>();
    const collisions: string[] = [];
    const delays = [12, 3, 9, 1, 6, 4];
    let idx = 0;

    const runTicket: BerthTicketRunner = async ({ ticket, actorId }) => {
      if (activeByLane.has(ticket.lane)) {
        collisions.push(
          `${ticket.lane}: ${activeByLane.get(ticket.lane)} vs ${ticket.id}`,
        );
      }
      activeByLane.set(ticket.lane, ticket.id);
      await sleep(delays[idx % delays.length]!);
      idx += 1;
      closeTicket(log, {
        ticketId: ticket.id,
        actorId,
        files: [`lanes/${ticket.lane}/file.txt`],
        verify: { command: 'true', exitCode: 0 },
        commits: ['deadbeef'],
      });
      activeByLane.delete(ticket.lane);
    };

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 3,
      breakerLevel: NEVER_ok,
      runTicket,
    });

    expect(collisions).toEqual([]);
    // A landed (in_review) ticket keeps its lane busy until a reviewer
    // accepts it (FR-T3) -- nothing in this test accepts anything, so only
    // the FIRST ticket per lane can ever land; its same-lane sibling stays
    // `ready`, blocked behind it for the rest of the run. That is exactly
    // "landing serialized through review" (acceptance 1) demonstrated
    // end-to-end: a second same-lane ticket physically cannot proceed
    // until review clears the first.
    const landed = result.berths.flatMap((b) => b.processed).filter((p) => p.landed);
    expect(landed).toHaveLength(3);
    const tickets = listTickets(log);
    expect(tickets.filter((t) => t.status === 'in_review')).toHaveLength(3);
    expect(tickets.filter((t) => t.status === 'ready')).toHaveLength(3);
  });

  it('breakpoint "ticket" pauses every berth at its next ticket boundary once any ticket lands', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01', 'core');
    seedTicket(log, 'W9-02', 'infra');

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 2,
      breakpoint: 'ticket',
      breakerLevel: NEVER_ok,
      runTicket: landingRunner(log, () => 0),
    });

    expect(result.berths.every((b) => b.stopReason === 'breakpoint')).toBe(true);
    expect(
      result.berths.flatMap((b) => b.processed).filter((p) => p.landed),
    ).toHaveLength(2);
  });

  it('breakpoint "never" (autorun) never pauses -- both berths run to idle', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01', 'core');
    seedTicket(log, 'W9-02', 'infra');

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 2,
      breakpoint: 'never',
      breakerLevel: NEVER_ok,
      runTicket: landingRunner(log, () => 0),
    });

    expect(result.berths.every((b) => b.stopReason === 'idle')).toBe(true);
  });

  it('a budget breaker tripped by one berth halts every berth at its next ticket boundary', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    const LANE_COUNT = 10;
    for (let i = 1; i <= LANE_COUNT; i += 1) {
      seedTicket(log, `W9-${String(i).padStart(2, '0')}`, `lane-${i}`);
    }

    let calls = 0;
    const TRIP_AFTER_OK_RESPONSES = 2;
    const breakerLevel: RunBerthsOptions['breakerLevel'] = () => {
      calls += 1;
      return calls > TRIP_AFTER_OK_RESPONSES ? 'hard_stop' : 'ok';
    };

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 3,
      breakerLevel,
      runTicket: landingRunner(log, () => 2),
    });

    const landed = result.berths.flatMap((b) => b.processed).filter((p) => p.landed);
    expect(landed).toHaveLength(TRIP_AFTER_OK_RESPONSES);
    expect(result.berths.some((b) => b.stopReason === 'budget')).toBe(true);
    expect(
      result.berths.every((b) => b.stopReason === 'budget' || b.stopReason === 'idle'),
    ).toBe(true);
    const stillReady = listTickets(log).filter((t) => t.status === 'ready');
    expect(stillReady).toHaveLength(LANE_COUNT - TRIP_AFTER_OK_RESPONSES);
  });

  it('a stopSwitch tripped mid-run halts every berth at its next boundary', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01', 'core');
    seedTicket(log, 'W9-02', 'infra');

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 2,
      breakerLevel: NEVER_ok,
      stopSwitch: () => true,
      runTicket: landingRunner(log, () => 0),
    });

    expect(result.berths.every((b) => b.stopReason === 'stopped')).toBe(true);
    expect(result.berths.flatMap((b) => b.processed)).toHaveLength(0);
    expect(listTickets(log).every((t) => t.status === 'ready')).toBe(true);
  });

  it("when one berth's runTicket throws, every other berth finishes its current ticket but never claims a second one", async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    for (let i = 1; i <= 8; i += 1) {
      seedTicket(log, `W9-${String(i).padStart(2, '0')}`, `lane-${i}`);
    }

    const boom = new Error('boom: simulated session crash');
    const runTicket: BerthTicketRunner = async ({ ticket, actorId }) => {
      if (ticket.id === 'W9-01') {
        throw boom;
      }
      await sleep(50);
      closeTicket(log, {
        ticketId: ticket.id,
        actorId,
        files: [`lanes/${ticket.lane}/file.txt`],
        verify: { command: 'true', exitCode: 0 },
        commits: ['deadbeef'],
      });
    };

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 4,
      breakerLevel: NEVER_ok,
      runTicket,
    });

    expect(result.berths).toHaveLength(4);
    expect(result.berths.every((b) => b.stopReason === 'error')).toBe(true);
    expect(result.berths.every((b) => b.error === boom)).toBe(true);

    // The berth that hit the throwing ticket never records it as processed
    // (it never reached closeTicket); the other three finish the ticket
    // they already held when the error landed, but none of them go on to
    // claim a second ticket -- exactly one processed entry per surviving
    // berth, none unaccounted for.
    const totalProcessed = result.berths.flatMap((b) => b.processed);
    expect(totalProcessed).toHaveLength(3);
    expect(totalProcessed.every((p) => p.landed)).toBe(true);

    const tickets = listTickets(log);
    expect(tickets.filter((t) => t.status === 'in_review')).toHaveLength(3);
    expect(tickets.filter((t) => t.status === 'in_progress')).toHaveLength(1);
    expect(tickets.filter((t) => t.status === 'ready')).toHaveLength(4);
  });

  it('auto-blocks (comment + release) a ticket a runner leaves in_progress, freeing its lane', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01', 'core');

    const stuckRunner: BerthTicketRunner = async () => {
      // deliberately never calls closeTicket/releaseTicket
    };

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 1,
      breakerLevel: NEVER_ok,
      runTicket: stuckRunner,
    });

    const outcome = result.berths[0]!.processed[0]!;
    expect(outcome.parked).toBe(true);
    expect(outcome.finalStatus).toBe('ready');
    const ticket = getTicket(log, 'W9-01') as Ticket;
    expect(ticket.ownerId).toBeNull();
    const lastHistoryEntry = ticket.history[ticket.history.length - 1]!;
    expect(lastHistoryEntry.verb).toBe('release');
    const comment = ticket.history.find((h) => h.verb === 'comment');
    expect(comment?.body).toContain('auto-blocked with evidence');
  });

  it('extra berths beyond available lanes simply idle once lanes are exhausted', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01', 'core');

    const result = await runBerths({
      log,
      runId: 'run-1',
      projectId: 'proj-1',
      repoRoot,
      berths: 4,
      breakerLevel: NEVER_ok,
      runTicket: landingRunner(log, () => 0),
    });

    expect(result.berths).toHaveLength(4);
    const totalLanded = result.berths.flatMap((b) => b.processed).filter((p) => p.landed);
    expect(totalLanded).toHaveLength(1);
    expect(result.berths.filter((b) => b.processed.length === 0)).toHaveLength(3);
  });

  it('holds "one berth halts all" for randomized berth counts and trip points (acceptance 2)', async () => {
    // A fresh repo (worktrees are cheap to create/discard) but, crucially,
    // a FRESH EventLog per seed: `pickNextBerthTicket` always considers the
    // whole board, so reusing one log across seeds would let a later seed's
    // berths pick up an earlier seed's leftover `ready` tickets and corrupt
    // the count this test is checking.
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-berths-repo-'));
    await git(repoRoot, ['init', '-b', 'main']);
    await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
    await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
    await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
    await git(repoRoot, ['add', '--', 'README.md']);
    await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

    const LANE_COUNT = 12;
    const dbDirs: string[] = [];

    try {
      await forEachSeedAsync(8, async (rng, seed) => {
        const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-berths-db-'));
        dbDirs.push(dbDir);
        const log = openEventLog(path.join(dbDir, 'state.db'));
        createIdentity(log, { id: 'human-1', name: 'Brad', kind: 'human' });

        const lane = `lane-${seed}`;
        for (let i = 1; i <= LANE_COUNT; i += 1) {
          seedTicket(log, `S${seed}-${String(i).padStart(2, '0')}`, `${lane}-${i}`);
        }

        const berths = randInt(rng, 1, 4);
        const tripAfter = randInt(rng, 0, LANE_COUNT - 1);
        let calls = 0;
        const breakerLevel: RunBerthsOptions['breakerLevel'] = () => {
          calls += 1;
          return calls > tripAfter ? 'hard_stop' : 'ok';
        };

        const result = await runBerths({
          log,
          runId: `run-seed-${seed}`,
          projectId: 'proj-1',
          repoRoot,
          berths,
          breakerLevel,
          runTicket: landingRunner(log, () => randInt(rng, 0, 3)),
        });

        const landedCount = result.berths
          .flatMap((b) => b.processed)
          .filter((p) => p.landed).length;
        // Every lane is distinct and the board always has spare capacity
        // (tripAfter < LANE_COUNT), so every 'ok' breakerLevel response is
        // guaranteed to find a claimable ticket -- landedCount tracks
        // tripAfter exactly, regardless of berth count or interleaving.
        expect(landedCount).toBe(tripAfter);
        expect(
          result.berths.every(
            (b) => b.stopReason === 'budget' || b.stopReason === 'idle',
          ),
        ).toBe(true);
        const stillReady = listTickets(log).filter((t) => t.status === 'ready');
        expect(stillReady).toHaveLength(LANE_COUNT - landedCount);
        log.close();
      });
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
      await Promise.all(
        dbDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
      );
    }
  });
});
