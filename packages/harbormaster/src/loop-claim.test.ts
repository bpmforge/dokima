import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { BudgetBreakerTracker, CostLedger } from '@dokima/gateway';
import { createChildProcessSpawn, type SpawnSession } from '@dokima/loop';
import {
  closeTicket,
  createTicket,
  getTicket,
  type Ticket,
  type TicketStatus,
} from '@dokima/tickets';
import { git } from '@dokima/git';
import { defaultHandoffBuilder } from './loop-handoff.js';
import { runClaimLoop,
  findAbandonedTickets,
  STALE_CLAIM_MS,
} from './loop-claim.js';

interface Fixture {
  repoRoot: string;
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-hm-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-hm-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });

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
  overrides: Partial<Parameters<typeof createTicket>[2]> = {},
) {
  return createTicket(log, 'worker-1', {
    id,
    type: 'task',
    title: `Ticket ${id}`,
    lane: 'core',
    writeScope: ['packages/example/**'],
    verify: 'true',
    ...overrides,
  });
}

/** A fake spawn that never produces a manifest — the session runs and exits, but nothing resolves the ticket. */
const neverResolvingSpawn: SpawnSession = async () => ({
  stdout: 'no manifest here',
  stderr: '',
  exitCode: 0,
});

describe('runClaimLoop', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('claims the lowest-id claimable ticket first', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-02');
    seedTicket(log, 'W9-01');

    const claimed: string[] = [];
    const spawn: SpawnSession = async (input) => {
      claimed.push(input.cwd);
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    // Both tickets exhaust their session cap and auto-block so the loop keeps
    // going and we can observe claim order via `processed`.
    const result = await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn,
      buildHandoff: defaultHandoffBuilder(),
      maxSessionsPerTicket: 2,
    });

    expect(result.stopReason).toBe('idle');
    expect(result.processed.map((p) => p.ticketId)).toEqual(['W9-01', 'W9-02']);
  });

  it('auto-blocks a ticket after the session cap (2) with evidence, then moves to the next ticket', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01');
    seedTicket(log, 'W9-02');

    const result = await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn: neverResolvingSpawn,
      buildHandoff: defaultHandoffBuilder(),
      maxSessionsPerTicket: 2,
    });

    expect(result.stopReason).toBe('idle');
    expect(result.processed).toHaveLength(2);

    const first = result.processed[0]!;
    expect(first.ticketId).toBe('W9-01');
    expect(first.attempts).toHaveLength(2);
    expect(first.autoBlocked).toBe(true);
    expect(first.finalStatus).toBe('ready');

    const ticket = getTicket(log, 'W9-01') as Ticket;
    expect(ticket.status).toBe('ready');
    expect(ticket.ownerId).toBeNull();
    const lastHistoryEntry = ticket.history[ticket.history.length - 1]!;
    expect(lastHistoryEntry.verb).toBe('release');
    const comment = ticket.history.find((h) => h.verb === 'comment');
    expect(comment?.body).toContain('auto-blocked with evidence');
    expect(comment?.body).toContain('attempt 1/2');
    expect(comment?.body).toContain('attempt 2/2');

    expect(result.processed[1]!.ticketId).toBe('W9-02');
  });

  it('stops retrying once the ticket is resolved out-of-session (status advances past in_progress)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01');

    let sessionCount = 0;
    const spawn: SpawnSession = async () => {
      sessionCount++;
      // Simulate W3-01b's out-of-session close landing after the first session.
      closeTicket(log, {
        ticketId: 'W9-01',
        actorId: 'worker-1',
        files: ['packages/example/file.ts'],
        verify: { command: 'true', exitCode: 0 },
        commits: ['deadbeef'],
      });
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    const result = await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn,
      buildHandoff: defaultHandoffBuilder(),
      maxSessionsPerTicket: 2,
    });

    expect(sessionCount).toBe(1);
    expect(result.processed[0]!.attempts).toHaveLength(1);
    expect(result.processed[0]!.autoBlocked).toBe(false);
    expect(result.processed[0]!.finalStatus).toBe('in_review' satisfies TicketStatus);
  });

  it('reclaims an auto-blocked, released ticket on a later run without crashing (worktree/branch already exist)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01');

    const firstRun = await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn: neverResolvingSpawn,
      buildHandoff: defaultHandoffBuilder(),
      maxSessionsPerTicket: 2,
    });
    expect(firstRun.processed[0]!.autoBlocked).toBe(true);
    expect(getTicket(log, 'W9-01')?.status).toBe('ready');

    // A fresh `runClaimLoop` call (a later process run in production) reclaims the
    // same ticket; its worktree/branch from the first run are still on disk.
    const secondRun = await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn: neverResolvingSpawn,
      buildHandoff: defaultHandoffBuilder(),
      maxSessionsPerTicket: 2,
    });

    expect(secondRun.stopReason).toBe('idle');
    expect(secondRun.processed).toHaveLength(1);
    expect(secondRun.processed[0]!.ticketId).toBe('W9-01');
    expect(secondRun.processed[0]!.autoBlocked).toBe(true);
    expect(getTicket(log, 'W9-01')?.status).toBe('ready');
  });

  it('stops before claiming when the stop switch is tripped (kill-file/pause, checked between tickets)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01');

    const result = await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn: neverResolvingSpawn,
      buildHandoff: defaultHandoffBuilder(),
      stopSwitch: () => true,
    });

    expect(result.stopReason).toBe('stopped');
    expect(result.processed).toEqual([]);
    expect(getTicket(log, 'W9-01')?.status).toBe('ready');
  });

  it('honors the real W2-07 breaker policy: hard_stop refuses new claims', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01');

    const ledger = new CostLedger();
    const tracker = new BudgetBreakerTracker(ledger, { runLimitUsd: 10 });
    await tracker.record({
      projectId: 'proj-1',
      runId: 'run-1',
      ticketId: 'ignored',
      berthId: 'berth-1',
      costUsd: 10,
      promptTokens: 0,
      completionTokens: 0,
      model: 'test-model',
      recordedAt: '2026-07-16T00:00:00.000Z',
    });

    const result = await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn: neverResolvingSpawn,
      buildHandoff: defaultHandoffBuilder(),
      breakerLevel: () => tracker.levelFor('proj-1', 'run-1'),
    });

    expect(result.stopReason).toBe('budget');
    expect(result.processed).toEqual([]);
    expect(getTicket(log, 'W9-01')?.status).toBe('ready');
  });

  it('idle-exits cleanly when nothing is claimable', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;

    const result = await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn: neverResolvingSpawn,
      buildHandoff: defaultHandoffBuilder(),
    });

    expect(result.stopReason).toBe('idle');
    expect(result.processed).toEqual([]);
  });

  it('runs a fresh session per attempt inside the ticket worktree, on its own sw/<id>-<slug> branch (FR-I1)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01');

    const cwds: string[] = [];
    const branches: string[] = [];
    const spawn: SpawnSession = async (input) => {
      cwds.push(input.cwd);
      const { stdout } = await git(input.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      branches.push(stdout);
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    await runClaimLoop({
      log,
      actorId: 'worker-1',
      repoRoot,
      spawn,
      buildHandoff: defaultHandoffBuilder(),
      maxSessionsPerTicket: 2,
    });

    expect(cwds).toHaveLength(2);
    expect(cwds[0]).toBe(cwds[1]);
    expect(branches[0]).toBe('sw/W9-01-ticket-w9-01');
  });

  it('the spawned session env carries zero credential/token vars, end-to-end (SC-03/SC-07 planted-secret regression)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01');

    process.env.DOKIMA_TEST_PLANTED_SECRET = 'sk-should-not-leak';
    try {
      const spawn = createChildProcessSpawn({
        command: 'node',
        args: ['-e', 'console.log(JSON.stringify(process.env));'],
      });

      const result = await runClaimLoop({
        log,
        actorId: 'worker-1',
        repoRoot,
        spawn,
        buildHandoff: defaultHandoffBuilder(),
        maxSessionsPerTicket: 1,
      });

      const session = result.processed[0]!.attempts[0]!.session;
      const childEnv = JSON.parse(session.output) as Record<string, string | undefined>;
      expect(childEnv.DOKIMA_TEST_PLANTED_SECRET).toBeUndefined();
      expect(childEnv.PATH).toBe(process.env.PATH);
      const unexpected = Object.keys(childEnv).filter(
        (key) => key !== 'PATH' && !key.startsWith('__CF_'),
      );
      expect(unexpected).toEqual([]);
    } finally {
      delete process.env.DOKIMA_TEST_PLANTED_SECRET;
    }
  });

  it(
    '(W11-17, FR-S2/SC-06 red fixture) a `secretValues` supplied to `ClaimLoopOptions` ' +
      'reaches the spawn boundary: an exact value with no known credential shape, ' +
      'embedded in the ticket context that ends up in the rendered HANDOFF prompt, ' +
      'does not appear in the prompt `spawn` actually receives',
    async () => {
      fixture = await setupFixture();
      const { log, repoRoot } = fixture;
      const secret = 'correcthorsebatterystaple';
      seedTicket(log, 'W9-01', { interface: `token=${secret}` });

      const prompts: string[] = [];
      const capturingSpawn: SpawnSession = async (input) => {
        prompts.push(input.prompt);
        return { stdout: '', stderr: '', exitCode: 0 };
      };

      await runClaimLoop({
        log,
        actorId: 'worker-1',
        repoRoot,
        spawn: capturingSpawn,
        buildHandoff: defaultHandoffBuilder(),
        maxSessionsPerTicket: 1,
        secretValues: [secret],
      });

      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('CONTEXT: token=');
      expect(prompts[0]).not.toContain(secret);
      expect(prompts[0]).toContain('[REDACTED:secret]');
    },
  );
});

/**
 * W13-12. Two runs in one session of live testing left a ticket stuck in
 * `in_progress` — one killed from outside, one crashed by an uncaught provider
 * timeout — and the next run reported "0 landed, 0 parked" in zero seconds,
 * because nothing was claimable and nothing said why.
 */
describe('reclaiming a claim whose owner is gone (W13-12)', () => {
  const NOW = '2026-08-19T12:00:00.000Z';
  const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

  function ticket(overrides: Partial<Ticket> = {}): Ticket {
    return {
      id: 'T-1',
      type: 'task',
      title: 'a ticket',
      lane: 'core',
      ownerId: 'worker-1',
      status: 'in_progress',
      interface: null,
      writeScope: ['src/**'],
      dependsOn: [],
      acceptance: [],
      verify: null,
      manifest: null,
      history: [],
      evidence: [],
      claimedAt: ago(60 * 60_000),
      closedAt: null,
      ...overrides,
    } as Ticket;
  }

  it(
    'RED FIXTURE: a held ticket with no activity for longer than the bound is ' +
      'reclaimable. Before this it stayed in in_progress forever and the next ' +
      'run silently found nothing to do',
    () => {
      const found = findAbandonedTickets(
        [ticket()],
        [{ ticketId: 'T-1', createdAt: ago(45 * 60_000) }],
        NOW,
      );
      expect(found.map((t) => t.id)).toEqual(['T-1']);
    },
  );

  it(
    'DOES NOT REAP A LIVE SESSION — the one thing this must never do. A running ' +
      'session emits a tool call per turn, so recent events ARE the heartbeat; ' +
      'claimedAt alone could not tell a long healthy session from a dead one',
    () => {
      const found = findAbandonedTickets(
        // Claimed an hour ago, still working ten seconds ago.
        [ticket({ claimedAt: ago(60 * 60_000) })],
        [
          { ticketId: 'T-1', createdAt: ago(60 * 60_000) },
          { ticketId: 'T-1', createdAt: ago(10_000) },
        ],
        NOW,
      );
      expect(found).toEqual([]);
    },
  );

  it('the bound is longer than the longest silence a healthy session can produce', () => {
    // One verify (10 min) plus one local model call (5 min) is the worst
    // legitimate gap; the bound must clear it with room.
    expect(STALE_CLAIM_MS).toBeGreaterThan((10 + 5) * 60_000);
  });

  it('leaves ready, in_review and done tickets alone — only a HELD ticket can be abandoned', () => {
    for (const status of ['ready', 'in_review', 'done', 'blocked'] as const) {
      expect(
        findAbandonedTickets([ticket({ status })], [], NOW),
      ).toEqual([]);
    }
  });

  it('treats an unreadable or missing timestamp as no evidence of life, not as immortality', () => {
    expect(
      findAbandonedTickets([ticket()], [{ ticketId: 'T-1', createdAt: 'not-a-date' }], NOW),
    ).toHaveLength(1);
    expect(findAbandonedTickets([ticket()], [], NOW)).toHaveLength(1);
  });

  it('ignores events belonging to other tickets', () => {
    const found = findAbandonedTickets(
      [ticket()],
      [{ ticketId: 'T-2', createdAt: ago(1000) }],
      NOW,
    );
    expect(found).toHaveLength(1);
  });
});
