import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { ProviderTimeoutError } from '@dokima/gateway';
import { BudgetBreakerTracker, CostLedger } from '@dokima/gateway';
import { branchNameFor, git } from '@dokima/git';
import type { SpawnSession } from '@dokima/loop';
import { createTicket, getTicket, type Ticket } from '@dokima/tickets';
import type { PushToRemotesFn } from './land-push.js';
import type { CompletionManifest } from './loop-gates.js';
import { defaultHandoffBuilder } from './loop-handoff.js';
import { runLandLoop, type LandLoopOptions } from './loop-land.js';
import { MAX_FREE_INFRA_RETRIES } from './loop-land-infra.js';
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

async function setupFixture(trunkName = 'main'): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-land-repo-'));
  // W13-40: parameterised, and NOT because a second name is tidier. Every
  // fixture in this file was born on `main`, which is exactly why the loop's
  // hardcoded `'main'` base ref stayed green here for three phases while
  // being unable to run a single ticket on a repo called anything else.
  await git(repoRoot, ['init', '-b', trunkName]);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-land-db-'));
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

/**
 * W20-13: these suites drive a FULL land loop per case — claim, spawn, gates,
 * receipts, sometimes several attempts up a ladder — so they legitimately take
 * seconds, and they sat just under vitest's 5s default. When the W20 wave added
 * ~40 tests, the extra parallel load tipped them over consistently ("Test timed
 * out in 5000ms", never an assertion; green in isolation and within this
 * package alone).
 *
 * The timeout is raised rather than the work reduced or an assertion loosened:
 * these fixtures prove the ladder never climbs when it is locked, and the
 * escalation events are the point. A gate that is one busy machine away from
 * red is not a gate — but neither is one that got green by asserting less.
 */
const LAND_LOOP_TIMEOUT_MS = 30_000;

describe('runLandLoop', () => {
  vi.setConfig({ testTimeout: LAND_LOOP_TIMEOUT_MS });
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

  /**
   * W13-40 RED FIXTURE. Measured on a customer project, not imagined: a plain
   * `git init` produced a `master` trunk, the board built fine, and then every
   * ticket refused with `fatal: invalid reference: main`. Nothing on the
   * server path supplies `baseRef`, so the loop's default WAS the product's
   * behaviour.
   */
  /**
   * W13-46. Found while establishing whether the forge path is reachable at
   * all — the answer turned out to matter far more than the question.
   *
   * `run-build.ts` injects `localFirstPushToRemotes`, which THROWS: dual-remote
   * push is not wired into the CLI. Its own comment says refusing loudly is
   * correct, and it is — but the call site here is not wrapped, and the throw
   * lands AFTER `landed = true` and after the close gate minted its receipt.
   * So a project with any git remote configured — which is most real ones —
   * gets a crashed run for a ticket that actually succeeded.
   */
  it('a push failure does not destroy a land that already succeeded (W13-46)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    // A remote the fixture repos never have — which is exactly why this went
    // unnoticed: every existing test runs with zero remotes, so the push is
    // skipped entirely and `unusedPushToRemotes` is never called.
    await git(repoRoot, ['remote', 'add', 'origin', 'https://example.invalid/x.git']);
    seedTicket(log, 'W9-01');

    const throwingPush: PushToRemotesFn = () => {
      throw new Error(
        'dual-remote push is not wired into the CLI yet (@dokima/forge is not an ' +
          'apps/server dependency) — the ticket landed locally and was NOT pushed',
      );
    };

    const result = await runLandLoop({
      ...baseOptions(fixture, landingSpawn),
      pushToRemotes: throwingPush,
    });

    // The run completes rather than throwing out of the loop.
    expect(result.stopReason).toBe('idle');
    // And the land is still a land: the ticket reached in_review with its
    // manifest. Reporting it as failed would be reporting a lie about durable
    // state that was already written.
    expect(result.processed[0]!.landed).toBe(true);
    expect((getTicket(log, 'W9-01') as Ticket).status).toBe('in_review');

    // And the operator is TOLD. A push that silently vanished would be the
    // same defect one layer down: durable state changed, nobody informed.
    const comments = listEvents(log)
      .filter((e) => e.eventType === 'ticket.commented')
      .map((e) => JSON.stringify(e.payload));
    expect(comments.some((c) => c.includes('not wired into the CLI'))).toBe(true);
  });

  it('lands a ticket in a repo whose trunk is not called main (W13-40)', async () => {
    fixture = await setupFixture('master');
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const options = baseOptions(fixture, landingSpawn);
    // No `baseRef`: the whole defect is what happens when nobody passes one.
    const result = await runLandLoop(options);

    expect(result.stopReason).toBe('idle');
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]!.landed).toBe(true);
    expect(result.processed[0]!.attempts[0]!.closeGate?.ok).toBe(true);
    expect((getTicket(log, 'W9-01') as Ticket).status).toBe('in_review');
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
    expect(comment?.body).toContain('Parked with evidence');
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
      path.join(os.tmpdir(), 'dokima-land-remote-good-'),
    );
    extraTempDirs.push(goodRemote);
    await git(goodRemote, ['init', '--bare', '-b', 'main']);
    await git(repoRoot, ['remote', 'add', 'origin', goodRemote]);
    // Stands in for an unreachable/offline forge remote (e.g. Gitea off-LAN)
    // — no real network, still fully local-first.
    const badRemotePath = path.join(os.tmpdir(), 'dokima-land-remote-missing-so-invalid');
    await git(repoRoot, ['remote', 'add', 'github', badRemotePath]);

    const calls: { cwd: string; remotes: readonly string[]; ref: string }[] = [];
    // Mirrors `@dokima/forge`'s `pushToRemotes` per-remote isolation
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
    const worktreePath1 = path.join(repoRoot, '.dokima', 'worktrees', 'W9-01');
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

  it(
    '(W11-16, FR-S2/SC-06 red fixture) a `secretValues` supplied to `LandLoopOptions` ' +
      'reaches the spawn boundary: an exact value with no known credential shape, ' +
      'embedded in the ticket context that ends up in the rendered HANDOFF prompt, ' +
      'does not appear in the prompt `spawn` actually receives',
    async () => {
      fixture = await setupFixture();
      const { log } = fixture;
      const secret = 'correcthorsebatterystaple';
      seedTicket(log, 'W9-01', { interface: `token=${secret}` });

      const prompts: string[] = [];
      const capturingSpawn: SpawnSession = async (input) => {
        prompts.push(input.prompt);
        return landingSpawn(input);
      };

      const result = await runLandLoop({
        ...baseOptions(fixture, capturingSpawn),
        secretValues: [secret],
      });

      expect(result.processed[0]!.landed).toBe(true);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('CONTEXT: token=');
      expect(prompts[0]).not.toContain(secret);
      expect(prompts[0]).toContain('[REDACTED:secret]');
    },
  );

  it(
    '(W12-08 red fixture) an ASYNC HandoffBuilder reaches the session with its context ' +
      "intact — FR-L5's Context Packer is async, so a synchronous-only seam could " +
      'never accept one, which is why it never had a caller',
    async () => {
      fixture = await setupFixture();
      const { log } = fixture;
      seedTicket(log, 'W9-01', { interface: 'ignored-by-the-custom-builder' });

      const prompts: string[] = [];
      const capturingSpawn: SpawnSession = async (input) => {
        prompts.push(input.prompt);
        return landingSpawn(input);
      };

      // Resolves after a real microtask turn, the way `assemblePacket` does
      // once it has queried a code index / facts store. Against the
      // pre-W12-08 synchronous `HandoffBuilder` this does not type-check,
      // and a forced call hands `runSession` a Promise instead of a Handoff.
      const packedContext = 'PACKED CONTEXT BLOCK: core + repo map + ticket';
      const asyncBuilder = async (ticket: Ticket) => {
        await Promise.resolve();
        return { ...defaultHandoffBuilder()(ticket), context: packedContext };
      };

      const result = await runLandLoop({
        ...baseOptions(fixture, capturingSpawn),
        buildHandoff: asyncBuilder,
      });

      expect(result.processed[0]!.landed).toBe(true);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain(packedContext);
      expect(prompts[0]).not.toContain('[object Promise]');
    },
  );

  describe('infrastructure failures retry for free (W13-27)', () => {
    /**
     * Fails the first N sessions the way an unreachable endpoint does, then
     * behaves. `ProviderTimeoutError` is what `runSessionAbsorbingProviderFailure`
     * absorbs, so this is the real path rather than a simulated flag.
     */
    function flakyEndpointSpawn(failures: number): SpawnSession {
      let seen = 0;
      return async (input) => {
        if (seen++ < failures) throw new ProviderTimeoutError('studio', 1000);
        return landingSpawn(input);
      };
    }

    it(
      'RED FIXTURE: two endpoint failures then a success LANDS. Before this ' +
        'every failure cost an attempt equally, so with the default ceiling of ' +
        '2 a ticket whose work was never judged parked — and a park needs a ' +
        'person to restart it, which is the whole complaint',
      async () => {
        fixture = await setupFixture();
        const { log } = fixture;
        seedTicket(log, 'W9-01');

        const options = baseOptions(fixture, flakyEndpointSpawn(2));
        const result = await runLandLoop({ ...options, maxLadderAttempts: 2 });

        const outcome = result.processed[0]!;
        expect(outcome.landed).toBe(true);
        expect(outcome.parked).toBe(false);
        // The two infra failures cost nothing: one real attempt is recorded.
        expect(outcome.attempts).toHaveLength(1);

        // And the run explains itself rather than looking like a model that
        // needed three tries.
        const retries = listEvents(log).filter(
          (e) => e.eventType === 'session.infra_retry',
        );
        expect(retries).toHaveLength(2);
        expect((retries[0]?.payload as { kind: string }).kind).toBe('endpoint_failure');
      },
    );

    it(
      'but the free retry is BOUNDED — an endpoint that is genuinely down still ' +
        'parks with evidence rather than spinning forever',
      async () => {
        fixture = await setupFixture();
        const { log } = fixture;
        seedTicket(log, 'W9-01');

        const options = baseOptions(fixture, flakyEndpointSpawn(Number.MAX_SAFE_INTEGER));
        const result = await runLandLoop({ ...options, maxLadderAttempts: 2 });

        const outcome = result.processed[0]!;
        expect(outcome.landed).toBe(false);
        expect(outcome.parked).toBe(true);
        expect(outcome.parkedReason).toBe('ladder_exhausted');
        expect(
          listEvents(log).filter((e) => e.eventType === 'session.infra_retry'),
        ).toHaveLength(MAX_FREE_INFRA_RETRIES);
      },
    );

    it(
      'a session that answers WITHOUT a manifest is not infrastructure and keeps ' +
        'costing an attempt — a real defect must not retry forever',
      async () => {
        fixture = await setupFixture();
        const { log } = fixture;
        seedTicket(log, 'W9-01');

        const options = baseOptions(fixture, neverResolvingSpawn);
        const result = await runLandLoop({ ...options, maxLadderAttempts: 2 });

        const outcome = result.processed[0]!;
        expect(outcome.parked).toBe(true);
        expect(outcome.attempts).toHaveLength(2);
        expect(
          listEvents(log).filter((e) => e.eventType === 'session.infra_retry'),
        ).toHaveLength(0);
      },
    );
  });

  describe('the gaps are fed back (W13-29)', () => {
    /** Fails the close gate on the first attempt, then writes real work. */
    function failThenFixSpawn(seen: { prompts: string[] }): SpawnSession {
      let n = 0;
      return async (input) => {
        seen.prompts.push(input.prompt);
        if (n++ === 0) {
          // A manifest claiming a file it never wrote: the close gate refuses
          // with a NAMED reason, which is the thing that must reach attempt 2.
          const manifest = buildManifest({
            files: ['packages/example/never-written.ts'],
          });
          return { stdout: JSON.stringify(manifest), stderr: '', exitCode: 0 };
        }
        return landingSpawn(input);
      };
    }

    it(
      'RED FIXTURE: attempt 2 is told what attempt 1 got wrong. Every attempt ' +
        'used to render a byte-identical prompt, so a retry was a re-roll of ' +
        'the same dice — BLUEPRINT section 3.5 step 5 asks for the specific ' +
        'gaps fed back',
      async () => {
        fixture = await setupFixture();
        const { log } = fixture;
        seedTicket(log, 'W9-01');

        const seen = { prompts: [] as string[] };
        const options = baseOptions(fixture, failThenFixSpawn(seen));
        await runLandLoop({ ...options, maxLadderAttempts: 2 });

        expect(seen.prompts).toHaveLength(2);
        // The heart of it: the prompts DIFFER, and the second names the failure.
        expect(seen.prompts[1]).not.toBe(seen.prompts[0]);
        expect(seen.prompts[1]).toContain('PREVIOUS ATTEMPT (1) DID NOT CLOSE');
        expect(seen.prompts[0]).not.toContain('PREVIOUS ATTEMPT');
      },
    );

    it(
      'REDACTS the fed-back gaps. Gate reasons quote verify output, which can ' +
        'carry a secret — feeding them forward must not reintroduce one to the ' +
        'model (SC-06/FR-S2)',
      async () => {
        fixture = await setupFixture();
        const { log } = fixture;
        seedTicket(log, 'W9-01');

        const seen = { prompts: [] as string[] };
        const options = baseOptions(fixture, failThenFixSpawn(seen));
        await runLandLoop({
          ...options,
          maxLadderAttempts: 2,
          // The manifest names this path, so it appears in the gate's reason.
          secretValues: ['never-written'],
        });

        expect(seen.prompts).toHaveLength(2);
        expect(seen.prompts[1]).toContain('PREVIOUS ATTEMPT (1) DID NOT CLOSE');
        expect(seen.prompts[1]).not.toContain('never-written');
      },
    );

    it(
      'a ladder that is not converging stops early rather than spending the ' +
        'rest of its attempts — BLUEPRINT section 3.5 no-progress kill',
      async () => {
        fixture = await setupFixture();
        const { log } = fixture;
        seedTicket(log, 'W9-01');

        // Identical failure every time, with room in the ladder to notice.
        const options = baseOptions(fixture, neverResolvingSpawn);
        const result = await runLandLoop({ ...options, maxLadderAttempts: 4 });

        const outcome = result.processed[0]!;
        expect(outcome.parked).toBe(true);
        expect(outcome.parkedReason).toBe('no_progress');
        // Stopped at 2 of 4: the second attempt proved the first taught nothing.
        expect(outcome.attempts).toHaveLength(2);
      },
    );
  });

  describe('the maker is told HOW it failed (W13-30)', () => {
    it(
      'RED FIXTURE: a failing verify puts its OUTPUT in the next prompt, not ' +
        'just its exit code. The gate captured stdout/stderr and discarded ' +
        'them, so once W13-29 fed reasons forward the maker learned THAT it ' +
        'failed and never HOW — the position a person is in when an agent keeps ' +
        'reporting done against an unchanged symptom',
      async () => {
        fixture = await setupFixture();
        const { log } = fixture;
        // A verify that fails with something only its output reveals.
        seedTicket(log, 'W9-01', {
          verify: 'echo "GHOST-EDGE-4713: expected 2 received 3" >&2; exit 1',
        });

        const prompts: string[] = [];
        // A distinct file per attempt: `landingSpawn` commits the same path
        // every time, and attempt 2 would fail on "nothing to commit" for a
        // reason that has nothing to do with what is being tested.
        const spawn: SpawnSession = async (input) => {
          prompts.push(input.prompt);
          const rel = `packages/example/attempt-${prompts.length}.ts`;
          const filePath = path.join(input.cwd, rel);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, `export const n = ${prompts.length};\n`);
          await git(input.cwd, ['add', '--', rel]);
          await git(input.cwd, ['commit', '-m', `feat: attempt ${prompts.length}`]);
          return {
            stdout: JSON.stringify(buildManifest({ files: [rel] })),
            stderr: '',
            exitCode: 0,
          };
        };
        const options = baseOptions(fixture, spawn);
        await runLandLoop({ ...options, maxLadderAttempts: 2 });

        expect(prompts.length).toBeGreaterThan(1);
        expect(prompts[1]).toContain('GHOST-EDGE-4713: expected 2 received 3');
        // The exit code alone was never the useful part.
        expect(prompts[1]).toContain('verify output');
      },
    );
  });
});

/**
 * W16-01: the ladder actually escalates. Until this ticket every attempt ran
 * `options.spawn` — the same model, three times — while BLUEPRINT §3.3
 * promised cheapest-first, then one rung up, then frontier.
 */
describe('the rung->session seam (W16-01)', () => {
  vi.setConfig({ testTimeout: LAND_LOOP_TIMEOUT_MS });
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  /** A labeled always-fails spawn per rung, and a record of which rungs were asked for. */
  function labeledRungSessions() {
    const asked: string[] = [];
    const ran: string[] = [];
    const advances: { fromRung: string; toRung: string; label: string }[] = [];
    const forLabel =
      (label: string): SpawnSession =>
      async () => {
        ran.push(label);
        return spoofedSpawn({ prompt: '', cwd: '' });
      };
    return {
      asked,
      ran,
      advances,
      seam: {
        sessionForRung(rung: 'R1' | 'R2' | 'R3') {
          asked.push(rung);
          const label = `model-${rung}`;
          return { spawn: forLabel(label), label };
        },
        onRungAdvance(advance: {
          fromRung: string;
          toRung: string;
          sessionLabel: string;
        }) {
          advances.push({
            fromRung: advance.fromRung,
            toRung: advance.toRung,
            label: advance.sessionLabel,
          });
        },
      },
    };
  }

  it(
    'RED FIXTURE: a planted always-fails ticket under the ladder CLIMBS — a ' +
      "rung advance is ledgered with the failed attempt's evidence. The " +
      'fixture fails if every attempt ran the same session with no ' +
      'escalation event (which was the shipped behavior before W16-01)',
    async () => {
      fixture = await setupFixture();
      const { log } = fixture;
      seedTicket(log, 'W9-01');

      const rungs = labeledRungSessions();
      const options = baseOptions(fixture, spoofedSpawn);
      const result = await runLandLoop({
        ...options,
        maxLadderAttempts: 3,
        rungSessions: rungs.seam,
      });

      const outcome = result.processed[0]!;
      expect(outcome.landed).toBe(false);
      expect(outcome.attempts).toHaveLength(3);
      // The climb is real: three attempts, three distinct rung sessions.
      expect(rungs.ran).toEqual(['model-R1', 'model-R2', 'model-R3']);
      // Each attempt records which session made its claim (calibration honesty).
      expect(outcome.attempts.map((a) => a.sessionLabel)).toEqual([
        'model-R1',
        'model-R2',
        'model-R3',
      ]);

      // The canonical FR-G3 event, evidence attached — same payload shape as
      // the gateway ladder's own emit (fromRung/toRung/receipts, no extras).
      const events = listEvents(log).filter(
        (e) => e.eventType === 'escalation.rung_advanced',
      );
      expect(events).toHaveLength(2);
      const payloads = events.map(
        (e) =>
          e.payload as {
            fromRung: string;
            toRung: string;
            receipts: { name: string; exitCode: number; gapCount: number }[];
          },
      );
      expect(payloads.map((p) => `${p.fromRung}->${p.toRung}`)).toEqual([
        'R1->R2',
        'R2->R3',
      ]);
      for (const payload of payloads) {
        expect(payload.receipts.length).toBeGreaterThan(0);
        expect(Object.keys(payload).sort()).toEqual(['fromRung', 'receipts', 'toRung']);
      }
      expect(rungs.advances.map((a) => a.label)).toEqual(['model-R2', 'model-R3']);
    },
  );

  it('a locked (pinned/local-only) policy never climbs: every attempt runs the pinned tier, no escalation event', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const rungs = labeledRungSessions();
    const options = baseOptions(fixture, spoofedSpawn);
    const result = await runLandLoop({
      ...options,
      maxLadderAttempts: 3,
      policyScope: {
        global: {
          'coding-agent': { mode: 'locked', pinnedTier: 'R1', tierKind: 'local' },
        },
      },
      rungSessions: rungs.seam,
    });

    const outcome = result.processed[0]!;
    expect(outcome.parkedReason).toBe('locked_ceiling_reached');
    expect(new Set(rungs.ran)).toEqual(new Set(['model-R1']));
    expect(
      listEvents(log).filter((e) => e.eventType === 'escalation.rung_advanced'),
    ).toHaveLength(0);
  });

  it('an infra failure retries on the SAME rung — a crashed endpoint is not evidence about the model (FR-G3)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    // First session throws like an unreachable endpoint; the free retry must
    // re-run R1, not climb to R2 on the strength of a network blip.
    let calls = 0;
    const asked: string[] = [];
    const seam = {
      sessionForRung(rung: 'R1' | 'R2' | 'R3') {
        asked.push(rung);
        return {
          label: `model-${rung}`,
          spawn: (async (input) => {
            if (calls++ === 0) throw new ProviderTimeoutError('studio', 1000);
            return landingSpawn(input);
          }) as SpawnSession,
        };
      },
    };
    const options = baseOptions(fixture, spoofedSpawn);
    const result = await runLandLoop({
      ...options,
      maxLadderAttempts: 2,
      rungSessions: seam,
    });

    const outcome = result.processed[0]!;
    expect(outcome.landed).toBe(true);
    expect(outcome.attempts).toHaveLength(1);
    expect(asked).toEqual(['R1', 'R1']);
    expect(
      listEvents(log).filter((e) => e.eventType === 'escalation.rung_advanced'),
    ).toHaveLength(0);
  });
});

/**
 * W16-03: the rung-ZERO consult — "have we solved this before?" asked before
 * any model spend, with the verified answer leading the first handoff. NOT
 * gateway's resolve-without-a-gate R0: the close gate still decides (C-2).
 */
describe('the rung-zero playbook consult (W16-03)', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it(
    'RED FIXTURE: a planted playbook answer reaches the maker BEFORE the first ' +
      'session runs — the consult is ordered ahead of the model, and the ' +
      'fixture fails if the session ran without the prior solution in its prompt',
    async () => {
      fixture = await setupFixture();
      const { log } = fixture;
      seedTicket(log, 'W9-01');

      const order: string[] = [];
      const prompts: string[] = [];
      const spawn: SpawnSession = async (input) => {
        order.push('spawn');
        prompts.push(input.prompt);
        return spoofedSpawn(input);
      };
      const options = baseOptions(fixture, spawn);
      const result = await runLandLoop({
        ...options,
        maxLadderAttempts: 1,
        r0Consult: {
          consult({ ticketId, criterion }) {
            order.push('consult');
            expect(ticketId).toBe('W9-01');
            expect(criterion).toBeTruthy();
            return {
              answered: true,
              findingId: 'fact:42',
              summary: 'Pin Node to 22 — the native addon ABI breaks on 24.',
            };
          },
        },
      });

      expect(order[0]).toBe('consult');
      expect(order).toContain('spawn');
      expect(prompts[0]).toContain(
        'A PRIOR VERIFIED SOLUTION exists for this task (fact:42)',
      );
      expect(prompts[0]).toContain('Pin Node to 22');
      expect(prompts[0]).toContain('the close gate still decides');
      // The gate was NOT skipped: the spoofed session fails it, and the hit
      // does not manufacture a landing (C-2 — the gate, not the playbook,
      // decides).
      expect(result.processed[0]!.landed).toBe(false);
      expect(result.processed[0]!.parked).toBe(true);
    },
  );

  it('a miss leaves the first handoff untouched, and the consult never repeats within a ticket', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    let consults = 0;
    const prompts: string[] = [];
    const spawn: SpawnSession = async (input) => {
      prompts.push(input.prompt);
      return spoofedSpawn(input);
    };
    const result = await runLandLoop({
      ...baseOptions(fixture, spawn),
      maxLadderAttempts: 2,
      r0Consult: {
        consult() {
          consults += 1;
          return { answered: false };
        },
      },
    });

    expect(consults).toBe(1);
    expect(result.processed[0]!.attempts.length).toBeGreaterThan(1);
    expect(prompts[0]).not.toContain('A PRIOR VERIFIED SOLUTION');
  });

  it('a consult that throws is ledgered and swallowed — a memory store having a bad day never parks the ticket for that reason', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const result = await runLandLoop({
      ...baseOptions(fixture, landingSpawn),
      maxLadderAttempts: 1,
      r0Consult: {
        consult() {
          throw new Error('memory store offline');
        },
      },
    });

    expect(result.processed[0]!.landed).toBe(true);
    const hookFailures = listEvents(log).filter(
      (e) => e.eventType === 'memory.hook_failed',
    );
    expect(hookFailures).toHaveLength(1);
  });
});

/**
 * W16-04: the lifecycle-verb mirror seam. The loop fires claim / the park's
 * evidence / close into an injected mirror (forge-free — apps/server
 * composes the forge side), and a failing mirror never blocks the loop.
 */
describe('the verb mirror seam (W16-04)', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('a landing ticket fires claim then close, with the receipt id and commits attached', async () => {
    fixture = await setupFixture();
    seedTicket(fixture.log, 'W9-01');
    const events: { kind: string; receiptId?: string; commits?: readonly string[] }[] =
      [];
    const result = await runLandLoop({
      ...baseOptions(fixture, landingSpawn),
      maxLadderAttempts: 1,
      verbMirror: {
        onVerb(event) {
          events.push({
            kind: event.kind,
            ...(event.receiptId ? { receiptId: event.receiptId } : {}),
            ...(event.commits ? { commits: event.commits } : {}),
          });
        },
      },
    });
    expect(result.processed[0]!.landed).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(['claim', 'close']);
    expect(events[1]!.receiptId).toBeTruthy();
    // landingSpawn's manifest declares no commits — the seam passes the
    // manifest's own list through verbatim, empty included.
    expect(events[1]!.commits).toEqual([]);
  });

  it('a parked ticket fires claim then evidence carrying the park comment body', async () => {
    fixture = await setupFixture();
    seedTicket(fixture.log, 'W9-01');
    const events: { kind: string; body?: string }[] = [];
    const result = await runLandLoop({
      ...baseOptions(fixture, spoofedSpawn),
      maxLadderAttempts: 1,
      verbMirror: {
        onVerb(event) {
          events.push({ kind: event.kind, ...(event.body ? { body: event.body } : {}) });
        },
      },
    });
    expect(result.processed[0]!.parked).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(['claim', 'evidence']);
    expect(events[1]!.body).toBeTruthy();
  });

  it('RED FIXTURE (FR-G5): a mirror that throws on every verb is ledgered and the ticket still LANDS — an unreachable forge never blocks a land', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');
    const result = await runLandLoop({
      ...baseOptions(fixture, landingSpawn),
      maxLadderAttempts: 1,
      verbMirror: {
        onVerb() {
          throw new Error('forge exploded');
        },
      },
    });
    expect(result.processed[0]!.landed).toBe(true);
    expect(
      listEvents(log).filter((e) => e.eventType === 'memory.hook_failed').length,
    ).toBeGreaterThan(0);
  });
});

/**
 * W16-10 (FR-T6): the conflict watch runs — one detection pass per loop
 * iteration. Detection only; resolution is the recorded follow-up.
 */
describe('the conflict watch (W16-10)', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('RED FIXTURE: a human edit inside the in-progress ticket\'s lease is detected at the next ATTEMPT boundary; an edit outside every lease is an ordinary human.file_edited with no conflict', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    createIdentity(log, { id: 'brad', name: 'Brad', kind: 'human' });
    seedTicket(log, 'W9-01');

    // The human edits during attempt 1 (inside W9-01's leased scope, plus an
    // unrelated file); the watch pass at attempt 2's boundary — the ticket
    // still in_progress, its lease live — must flag exactly the collision.
    const spawn: SpawnSession = async (input) => {
      await fs.mkdir(path.join(repoRoot, 'packages/example'), { recursive: true });
      await fs.writeFile(path.join(repoRoot, 'packages/example/human-edit.ts'), 'human\n');
      await fs.writeFile(path.join(repoRoot, 'NOTES.md'), 'unrelated\n');
      return spoofedSpawn(input);
    };
    await runLandLoop({
      ...baseOptions(fixture, spawn),
      maxLadderAttempts: 2,
      conflictWatch: { humanActorId: 'brad' },
    });

    const edits = listEvents(log).filter((e) => e.eventType === 'human.file_edited');
    const conflicts = listEvents(log).filter((e) => e.eventType === 'conflict.detected');
    expect(edits.length).toBeGreaterThanOrEqual(2);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(
      conflicts.some(
        (e) => (e.payload as { path?: string }).path === 'packages/example/human-edit.ts',
      ),
    ).toBe(true);
    expect(
      conflicts.some((e) => (e.payload as { path?: string }).path === 'NOTES.md'),
    ).toBe(false);
  });

  it('no conflictWatch option = no watcher events — byte-identical pre-W16-10 loop', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');
    await runLandLoop({ ...baseOptions(fixture, landingSpawn), maxLadderAttempts: 1 });
    expect(listEvents(log).filter((e) => e.eventType === 'human.file_edited')).toHaveLength(0);
  });
});

/**
 * W17-04: a tier advance on a one-model chain is a retry, not an escalation —
 * the climb event fires only when the session actually changes.
 */
describe('same-model climbs are not escalations (W17-04)', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('RED FIXTURE: a one-model chain climbing R1->R2->R3 produces ZERO escalation.rung_advanced events — the trace must never say "stronger model" about the same model', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seedTicket(log, 'W9-01');

    const ran: string[] = [];
    const advances: string[] = [];
    const result = await runLandLoop({
      ...baseOptions(fixture, spoofedSpawn),
      maxLadderAttempts: 3,
      rungSessions: {
        sessionForRung() {
          // Every rung clamps to the same session — the one-model chain.
          return {
            label: 'only-model',
            spawn: async (input) => {
              ran.push('only-model');
              return spoofedSpawn(input);
            },
          };
        },
        onRungAdvance(advance) {
          advances.push(`${advance.fromRung}->${advance.toRung}`);
        },
      },
    });

    expect(result.processed[0]!.attempts).toHaveLength(3);
    expect(ran).toHaveLength(3);
    expect(
      listEvents(log).filter((e) => e.eventType === 'escalation.rung_advanced'),
    ).toHaveLength(0);
    expect(advances).toEqual([]);
  });
});

/**
 * W17-02: a budget-stopped attempt's checkpoint leads the NEXT attempt's
 * handoff — continue, don't restart — with the real diff as ground truth.
 */
describe('checkpoint continuity across attempts (W17-02)', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('RED FIXTURE: attempt 2\'s prompt carries attempt 1\'s checkpoint (remaining work + next step) — fails if the handoff is a fresh start', async () => {
    fixture = await setupFixture();
    seedTicket(fixture.log, 'W9-01');

    const prompts: string[] = [];
    let first = true;
    const spawn: SpawnSession = async (input) => {
      prompts.push(input.prompt);
      if (first) {
        first = false;
        // A budget-stopped session: no manifest, but a checkpoint line.
        return {
          stdout: '',
          stderr:
            'agent session stopped: exceeded the per-session tool-iteration budget\n' +
            'SESSION_CHECKPOINT {"completed":["drafted the schema"],"remaining":["validation rules"],"next":"write validate.ts"}',
          exitCode: 1,
        };
      }
      return spoofedSpawn(input);
    };
    await runLandLoop({
      ...baseOptions(fixture, spawn),
      maxLadderAttempts: 2,
    });

    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts[1]).toContain('RAN OUT OF BUDGET MID-WORK. CONTINUE');
    expect(prompts[1]).toContain('validation rules');
    expect(prompts[1]).toContain('write validate.ts');
    // Attempt 1 changed nothing in the worktree, so the completed claim is
    // flagged, not believed.
    expect(prompts[1]).toContain('WARNING: its checkpoint claims completed work');
  });
});
