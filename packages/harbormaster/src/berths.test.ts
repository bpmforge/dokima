/**
 * W16-02: `runBerths` composed with the real one-ticket engine
 * (`landClaimedTicket`) — the exact composition apps/server's berths path
 * runs. Until this ticket `runBerths` had zero callers and zero tests of
 * its production composition; the dial was stored and read by nothing.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import { git } from '@dokima/git';
import type { SpawnSession } from '@dokima/loop';
import { createTicket, getTicket } from '@dokima/tickets';
import { defaultHandoffBuilder } from './loop-handoff.js';
import { landClaimedTicket, type LandLoopOptions } from './loop-land.js';
import { runBerths } from './berths.js';
import type { PushToRemotesFn } from './land-push.js';
import type { CompletionManifest } from './loop-gates.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_VALIDATORS_DIR = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  'content',
  'validators',
);

interface Fixture {
  repoRoot: string;
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

async function setupFixture(): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-berths-repo-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-berths-db-'));
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

function seed(log: EventLog, id: string, lane: string, scope: string) {
  createTicket(log, 'worker-1', {
    id,
    type: 'task',
    title: `Ticket ${id}`,
    lane,
    writeScope: [scope],
    verify: 'true',
  });
}

const unusedPush: PushToRemotesFn = async () => {
  throw new Error('no remotes configured on the fixture repo');
};

function manifestFor(file: string): CompletionManifest {
  return {
    ticket: 'X',
    files: [file],
    verify: { command: 'true', exit: 0 },
    commits: [],
    evidence: [],
  };
}

/** Lands its ticket by committing the one file its write scope allows. */
function landingSpawnFor(dirByPrefix: Record<string, string>): SpawnSession {
  return async (input) => {
    // The handoff prompt names the ticket's write scope; find which fixture
    // file this session is supposed to produce.
    const prefix = Object.keys(dirByPrefix).find((key) => input.prompt.includes(key))!;
    const file = dirByPrefix[prefix]!;
    const abs = path.join(input.cwd, file);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, 'export const x = 1;\n');
    await git(input.cwd, ['add', '--', file]);
    await git(input.cwd, ['commit', '-m', 'feat: add file']);
    return { stdout: JSON.stringify(manifestFor(file)), stderr: '', exitCode: 0 };
  };
}

function landOptions(fx: Fixture, spawn: SpawnSession): LandLoopOptions {
  return {
    log: fx.log,
    actorId: 'worker-1',
    projectId: 'proj-berths',
    repoRoot: fx.repoRoot,
    contentDir: CONTENT_VALIDATORS_DIR,
    signingKey: 'test-berths-signing-key',
    spawn,
    pushToRemotes: unusedPush,
    buildHandoff: defaultHandoffBuilder(),
    now: () => '2026-08-21T00:00:00.000Z',
  };
}

/** The production composition, verbatim shape of run-build-berths.ts. */
async function runComposedBerths(
  fx: Fixture,
  spawn: SpawnSession,
  berths: number,
  onTicketStart?: (ticketId: string, lane: string) => void,
  onTicketEnd?: (ticketId: string) => void,
) {
  const base = landOptions(fx, spawn);
  return runBerths({
    log: fx.log,
    runId: 'run-berths-1',
    projectId: 'proj-berths',
    repoRoot: fx.repoRoot,
    berths,
    baseRef: 'main' as never,
    now: base.now,
    runTicket: async ({ ticket, worktree, actorId }) => {
      onTicketStart?.(ticket.id, ticket.lane);
      try {
        await landClaimedTicket({ ...base, actorId }, ticket, worktree, 'main');
      } finally {
        onTicketEnd?.(ticket.id);
      }
    },
  });
}

describe('runBerths + landClaimedTicket (W16-02)', () => {
  it('two INDEPENDENT-lane tickets land under 2 berths, each verb attributed to a per-berth identity (FR-H5)', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seed(log, 'T-A', 'core', 'packages/a/**');
    seed(log, 'T-B', 'ui', 'packages/b/**');

    const result = await runComposedBerths(
      fixture,
      landingSpawnFor({
        'packages/a/**': 'packages/a/file.ts',
        'packages/b/**': 'packages/b/file.ts',
      }),
      2,
    );

    expect(getTicket(log, 'T-A')!.status).toBe('in_review');
    expect(getTicket(log, 'T-B')!.status).toBe('in_review');
    // Both berths exist as distinct machine identities, and the claim events
    // carry per-berth actors — attribution is mechanical, not cosmetic.
    const claimActors = new Set(
      listEvents(log)
        .filter((e) => e.eventType === 'ticket.claimed')
        .map((e) => (e as { actorId: string }).actorId),
    );
    expect(claimActors.size).toBe(2);
    expect(result.berths).toHaveLength(2);
  });

  it(
    'RED FIXTURE (law 1): with 2 berths and two claimable SAME-lane tickets, ' +
      'the second never starts while the first is active — the fixture fails ' +
      'if both are ever in flight at once',
    async () => {
      fixture = await setupFixture();
      const { log } = fixture;
      seed(log, 'T-A', 'core', 'packages/a/**');
      seed(log, 'T-B', 'core', 'packages/b/**');

      const active = new Set<string>();
      let maxSameLaneActive = 0;
      await runComposedBerths(
        fixture,
        landingSpawnFor({
          'packages/a/**': 'packages/a/file.ts',
          'packages/b/**': 'packages/b/file.ts',
        }),
        2,
        (ticketId) => {
          active.add(ticketId);
          maxSameLaneActive = Math.max(maxSameLaneActive, active.size);
        },
        (ticketId) => {
          active.delete(ticketId);
        },
      );

      expect(maxSameLaneActive).toBe(1);
      expect(getTicket(log, 'T-A')!.status).toBe('in_review');
      // FR-T3: T-A's lane stays reserved THROUGH in_review — its diff is not
      // safe to build on until a human accepts — so T-B honestly waits at
      // `ready` rather than starting on top of unaccepted work. This mirrors
      // the sequential loop's own semantics; it is the invariant, not a gap.
      expect(getTicket(log, 'T-B')!.status).toBe('ready');
      expect(getTicket(log, 'T-B')!.history).toEqual([]);
    },
  );

  it('a berth runner error halts EVERY berth with the error preserved — an evidence-preserving halt, never a silent continue', async () => {
    fixture = await setupFixture();
    const { log } = fixture;
    seed(log, 'T-A', 'core', 'packages/a/**');
    seed(log, 'T-B', 'ui', 'packages/b/**');

    const result = await runBerths({
      log,
      runId: 'run-berths-err',
      projectId: 'proj-berths',
      repoRoot: fixture.repoRoot,
      berths: 2,
      baseRef: 'main' as never,
      runTicket: async () => {
        throw new Error('planted engine-escape error');
      },
    });
    expect(result.berths.some((b) => b.stopReason === 'error')).toBe(true);
    const withError = result.berths.find((b) => b.stopReason === 'error');
    expect(String((withError!.error as Error).message)).toContain('planted');
  });
});
