import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import { BudgetBreakerTracker, CostLedger } from '@shipwright/gateway';
import { branchNameFor, git } from '@shipwright/git';
import type { SpawnSession } from '@shipwright/loop';
import { createTicket, getTicket, type Ticket } from '@shipwright/tickets';
import type { PushToRemotesFn } from './land-push.js';
import type { CompletionManifest } from './loop-gates.js';
import { defaultHandoffBuilder } from './loop-handoff.js';
import { runLandLoop, type LandLoopOptions } from './loop-land.js';
import type { LandEscalationTokenHook } from './loop-land-policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_VALIDATORS_DIR = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  'content',
  'validators',
);
const TEST_SIGNING_KEY = 'test-land-loop-signing-key';
const PROJECT_ID = 'proj-w3-01c';

interface Fixture {
  repoRoot: string;
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-land-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-land-db-'));
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

/** No remotes are ever configured on the throwaway fixture repos by default, so this should never actually be invoked. */
const unusedPushToRemotes: PushToRemotesFn = async () => {
  throw new Error('pushToRemotes invoked with no remotes configured on the fixture repo');
};

function baseOptions(fixture: Fixture, spawn: SpawnSession): LandLoopOptions {
  return {
    log: fixture.log,
    actorId: 'worker-1',
    projectId: PROJECT_ID,
    repoRoot: fixture.repoRoot,
    contentDir: CONTENT_VALIDATORS_DIR,
    signingKey: TEST_SIGNING_KEY,
    spawn,
    pushToRemotes: unusedPushToRemotes,
    buildHandoff: defaultHandoffBuilder(),
    now: () => '2026-07-16T00:00:00.000Z',
  };
}

function buildManifest(overrides: Partial<CompletionManifest> = {}): CompletionManifest {
  return {
    ticket: 'W9-01',
    files: [],
    verify: { command: 'true', exit: 0 },
    commits: [],
    evidence: [],
    ...overrides,
  };
}

/** Commits `packages/example/file.ts` in the session worktree and returns a manifest a real `runCloseGate` accepts. */
const landingSpawn: SpawnSession = async (input) => {
  const filePath = path.join(input.cwd, 'packages/example/file.ts');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'export const x = 1;\n');
  await git(input.cwd, ['add', '--', 'packages/example/file.ts']);
  await git(input.cwd, ['commit', '-m', 'feat: add file']);
  const manifest = buildManifest({ files: ['packages/example/file.ts'] });
  return { stdout: JSON.stringify(manifest), stderr: '', exitCode: 0 };
};

/** Never produces a completion manifest — the close gate is never even attempted. */
const neverResolvingSpawn: SpawnSession = async () => ({
  stdout: 'no manifest here',
  stderr: '',
  exitCode: 0,
});

/** Always returns a manifest claiming a file that was never committed — the close gate refuses every time. */
const spoofedSpawn: SpawnSession = async () => {
  const manifest = buildManifest({ files: ['packages/example/never-existed.ts'] });
  return { stdout: JSON.stringify(manifest), stderr: '', exitCode: 0 };
};

describe('runLandLoop', () => {
  let fixture: Fixture | undefined;
  let extraTempDirs: string[] = [];

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
    await Promise.all(
      extraTempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    extraTempDirs = [];
  });

  it('closes, checkpoints (receipt + verified commit), and repeats to the next claimable ticket (acceptance 1)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');
    seedTicket(log, 'W9-02');

    const result = await runLandLoop(baseOptions(fixture, landingSpawn));

    expect(result.stopReason).toBe('idle');
    expect(result.processed.map((p) => p.ticketId)).toEqual(['W9-01', 'W9-02']);
    for (const outcome of result.processed) {
      expect(outcome.landed).toBe(true);
      expect(outcome.parked).toBe(false);
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.attempts[0]!.closeGate?.ok).toBe(true);
      expect(outcome.finalStatus).toBe('in_review');
      expect(outcome.mode).toBe('ladder');
    }

    const ticket1 = getTicket(log, 'W9-01') as Ticket;
    expect(ticket1.status).toBe('in_review');
    expect(ticket1.ownerId).toBe('worker-1');
    expect(ticket1.manifest?.closeReceipt).toBeDefined();
  });

  it('ladder mode: parks blocked-with-evidence after the attempt cap with no manifest, then moves on (FR-H1/H2)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');
    seedTicket(log, 'W9-02');

    const options = baseOptions(fixture, neverResolvingSpawn);
    const result = await runLandLoop({ ...options, maxLadderAttempts: 2 });

    expect(result.stopReason).toBe('idle');
    expect(result.processed).toHaveLength(2);

    const first = result.processed[0]!;
    expect(first.ticketId).toBe('W9-01');
    expect(first.landed).toBe(false);
    expect(first.parked).toBe(true);
    expect(first.parkedReason).toBe('ladder_exhausted');
    expect(first.attempts).toHaveLength(2);
    expect(first.attempts.every((a) => a.closeGate === null)).toBe(true);

    const ticket = getTicket(log, 'W9-01') as Ticket;
    expect(ticket.status).toBe('ready');
    expect(ticket.ownerId).toBeNull();
    const lastHistoryEntry = ticket.history[ticket.history.length - 1]!;
    expect(lastHistoryEntry.verb).toBe('release');
    const comment = ticket.history.find((h) => h.verb === 'comment');
    expect(comment?.body).toContain('auto-blocked with evidence');
    expect(comment?.body).toContain('attempt 1/2');
    expect(comment?.body).toContain('attempt 2/2');
    expect(comment?.body).toContain('no completion manifest returned');

    expect(result.processed[1]!.ticketId).toBe('W9-02');
  });

  it('attaches the real close-gate failure reasons to the park comment when a manifest is returned but refused', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const result = await runLandLoop({
      ...baseOptions(fixture, spoofedSpawn),
      maxLadderAttempts: 1,
    });

    expect(result.processed[0]!.parked).toBe(true);
    expect(result.processed[0]!.attempts[0]!.closeGate?.ok).toBe(false);

    const ticket = getTicket(log, 'W9-01') as Ticket;
    const comment = ticket.history.filter((h) => h.verb === 'comment').pop();
    expect(comment?.body).toContain('close gate refused');
    expect(comment?.body).toMatch(/never-existed\.ts/);
  });

  it('locked mode: loops in place under the convergence ceiling then parks, never escalating (D-018)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const result = await runLandLoop({
      ...baseOptions(fixture, neverResolvingSpawn),
      policyScope: {
        run: {
          'coding-agent': { mode: 'locked', pinnedTier: 'R1', tierKind: 'metered' },
        },
      },
    });

    const outcome = result.processed[0]!;
    expect(outcome.mode).toBe('locked');
    expect(outcome.parked).toBe(true);
    expect(outcome.parkedReason).toBe('locked_ceiling_reached');
    expect(outcome.attempts).toHaveLength(8); // LAND_CONVERGENCE_CEILING.metered

    const ticket = getTicket(log, 'W9-01') as Ticket;
    const comment = ticket.history.filter((h) => h.verb === 'comment').pop();
    expect(comment?.body).toContain('locked-mode convergence ceiling (8)');
  });

  it('token-gated mode: parks at the named tier boundary with a Decide card when no token is granted (D-018)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const tokenHook: LandEscalationTokenHook = { checkToken: async () => undefined };
    const result = await runLandLoop({
      ...baseOptions(fixture, neverResolvingSpawn),
      policyScope: { run: { 'coding-agent': { mode: 'token-gated', namedTier: 'R2' } } },
      tokenHook,
    });

    const outcome = result.processed[0]!;
    expect(outcome.mode).toBe('token-gated');
    expect(outcome.parked).toBe(true);
    expect(outcome.parkedReason).toBe('awaiting_escalation_token');
    expect(outcome.attempts).toHaveLength(2); // stops exactly at the R2 boundary (attempt 2)

    const ticket = getTicket(log, 'W9-01') as Ticket;
    const comment = ticket.history.filter((h) => h.verb === 'comment').pop();
    expect(comment?.body).toContain('DECIDE CARD');
    expect(comment?.body).toContain('Grant an escalation token');
    expect(comment?.body).toContain('R2');
  });

  it('token-gated mode: a granted token lets the ticket keep climbing past the boundary', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    let checked = 0;
    const tokenHook: LandEscalationTokenHook = {
      checkToken: async (request) => {
        checked += 1;
        return {
          ticketId: request.ticketId,
          boundary: request.boundary,
          grantedBy: 'human-1',
          grantedAt: '2026-07-16T00:00:00.000Z',
        };
      },
    };
    const result = await runLandLoop({
      ...baseOptions(fixture, neverResolvingSpawn),
      policyScope: { run: { 'coding-agent': { mode: 'token-gated', namedTier: 'R2' } } },
      tokenHook,
    });

    expect(checked).toBe(1);
    const outcome = result.processed[0]!;
    expect(outcome.parked).toBe(true);
    expect(outcome.parkedReason).toBe('ladder_exhausted');
    expect(outcome.attempts).toHaveLength(3); // climbs past R2 to the R1-R3 ceiling

    const ticket = getTicket(log, 'W9-01') as Ticket;
    const comment = ticket.history.filter((h) => h.verb === 'comment').pop();
    expect(comment?.body).not.toContain('DECIDE CARD');
  });

  it('idle-exits cleanly when nothing is claimable', async () => {
    fixture = await setupFixture();
    const result = await runLandLoop(baseOptions(fixture, neverResolvingSpawn));
    expect(result.stopReason).toBe('idle');
    expect(result.processed).toEqual([]);
  });

  it('stops before claiming when the stop switch is tripped (kill-file/pause, checked between tickets)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const result = await runLandLoop({
      ...baseOptions(fixture, neverResolvingSpawn),
      stopSwitch: () => true,
    });

    expect(result.stopReason).toBe('stopped');
    expect(result.processed).toEqual([]);
    expect(getTicket(log, 'W9-01')?.status).toBe('ready');
  });

  it('honors the real W2-07 breaker policy: hard_stop refuses new claims', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
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

    const result = await runLandLoop({
      ...baseOptions(fixture, neverResolvingSpawn),
      breakerLevel: () => tracker.levelFor('proj-1', 'run-1'),
    });

    expect(result.stopReason).toBe('budget');
    expect(result.processed).toEqual([]);
    expect(getTicket(log, 'W9-01')?.status).toBe('ready');
  });

  it('reclaims a parked, released ticket on a later run without crashing (worktree/branch already exist)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const options = {
      ...baseOptions(fixture, neverResolvingSpawn),
      maxLadderAttempts: 1,
    };
    const firstRun = await runLandLoop(options);
    expect(firstRun.processed[0]!.parked).toBe(true);
    expect(getTicket(log, 'W9-01')?.status).toBe('ready');

    const secondRun = await runLandLoop(options);
    expect(secondRun.stopReason).toBe('idle');
    expect(secondRun.processed).toHaveLength(1);
    expect(secondRun.processed[0]!.parked).toBe(true);
    expect(getTicket(log, 'W9-01')?.status).toBe('ready');
  });

  it('AC1 (dual-remote wiring): a successful land triggers a push to every remote configured on the repo by default, and one remote failing does not abort the other or the land loop (isolation)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    seedTicket(log, 'W9-01');
    seedTicket(log, 'W9-02');

    // Remotes are shared repo-wide (`git worktree add`), so configuring them
    // on repoRoot is visible from the ticket's own worktree too.
    const goodRemote = await fs.mkdtemp(
      path.join(os.tmpdir(), 'shipwright-land-remote-good-'),
    );
    extraTempDirs.push(goodRemote);
    await git(goodRemote, ['init', '--bare', '-b', 'main']);
    await git(repoRoot, ['remote', 'add', 'origin', goodRemote]);
    // Stands in for an unreachable/offline forge remote (e.g. Gitea off-LAN)
    // — no real network, still fully local-first.
    const badRemotePath = path.join(
      os.tmpdir(),
      'shipwright-land-remote-missing-so-invalid',
    );
    await git(repoRoot, ['remote', 'add', 'github', badRemotePath]);

    const calls: { cwd: string; remotes: readonly string[]; ref: string }[] = [];
    // Mirrors `@shipwright/forge`'s `pushToRemotes` per-remote isolation
    // (Promise.allSettled): one remote failing never throws or short-
    // circuits the others, and it always resolves with one result per
    // remote — never a single all-or-nothing rejection.
    const isolatingPushToRemotes: PushToRemotesFn = async (options) => {
      calls.push(options);
      const settled = await Promise.allSettled(
        options.remotes.map((remote) => git(options.cwd, ['push', remote, options.ref])),
      );
      return options.remotes.map((remote, index) => ({
        remote,
        ok: settled[index]!.status === 'fulfilled',
        detail: '',
      }));
    };

    // No `pushRemotes` passed — proves the wiring is live by default,
    // reading whatever remotes the repo actually has configured.
    const result = await runLandLoop({
      ...baseOptions(fixture, landingSpawn),
      pushToRemotes: isolatingPushToRemotes,
    });

    expect(result.stopReason).toBe('idle');
    expect(result.processed).toHaveLength(2);
    // The `github` remote is unreachable, yet both tickets still land —
    // proving the failing remote never aborted the loop.
    expect(result.processed[0]!.landed).toBe(true);
    expect(result.processed[1]!.landed).toBe(true);

    const branch1 = branchNameFor('W9-01', 'Ticket W9-01');
    const worktreePath1 = path.join(repoRoot, '.shipwright', 'worktrees', 'W9-01');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      cwd: worktreePath1,
      // `git remote` lists names alphabetically.
      remotes: ['github', 'origin'],
      ref: branch1,
    });

    const { stdout: localSha } = await git(repoRoot, ['rev-parse', branch1]);
    const { stdout: remoteSha } = await git(goodRemote, ['rev-parse', branch1]);
    expect(remoteSha.trim()).toBe(localSha.trim());

    // Per-remote status is on the outcome, not swallowed (review-caught HIGH).
    const pushResults = result.processed[0]!.pushResults;
    expect(pushResults).toEqual([
      { remote: 'github', ok: false, detail: '' },
      { remote: 'origin', ok: true, detail: '' },
    ]);

    // A failed remote leaves durable evidence on the ticket (Law 4: no
    // state change without a receipt/event) instead of vanishing silently.
    const comments = listEvents(log).filter(
      (event) => event.eventType === 'ticket.commented' && event.ticketId === 'W9-01',
    );
    expect(comments).toHaveLength(1);
    expect((comments[0]!.payload as { body: string }).body).toContain('github');
  });
});
