import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '@shipwright/git';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import { claimTicket, createTicket } from '@shipwright/tickets';
import {
  detectConflicts,
  parsePorcelainStatus,
  runConflictWatch,
  scanHumanCheckout,
} from './conflict-watcher.js';

describe('parsePorcelainStatus', () => {
  it('parses modified, untracked, and staged-add lines', () => {
    const porcelain = [
      ' M src/auth/session.ts',
      '?? src/new-file.ts',
      'A  src/added.ts',
    ].join('\n');
    expect(parsePorcelainStatus(porcelain)).toEqual([
      'src/auth/session.ts',
      'src/new-file.ts',
      'src/added.ts',
    ]);
  });

  it('resolves a rename line to its new path', () => {
    expect(parsePorcelainStatus('R  src/old.ts -> src/new.ts')).toEqual(['src/new.ts']);
  });

  it('returns empty for an empty status', () => {
    expect(parsePorcelainStatus('')).toEqual([]);
  });
});

describe('detectConflicts', () => {
  it('flags an edit whose path falls inside a lease write_scope', () => {
    const detections = detectConflicts(
      [{ path: 'src/auth/session.ts', detectedAt: '2026-01-01T00:00:00.000Z' }],
      [{ ticketId: 'T-1', ownerId: 'worker-1', writeScope: ['src/auth/**'] }],
    );
    expect(detections).toEqual([
      {
        ticketId: 'T-1',
        ownerId: 'worker-1',
        path: 'src/auth/session.ts',
        matchedGlob: 'src/auth/**',
      },
    ]);
  });

  it('does not flag an edit outside every lease (UC-04 A2: ordinary event, no interruption)', () => {
    const detections = detectConflicts(
      [{ path: 'docs/README.md', detectedAt: '2026-01-01T00:00:00.000Z' }],
      [{ ticketId: 'T-1', ownerId: 'worker-1', writeScope: ['src/auth/**'] }],
    );
    expect(detections).toEqual([]);
  });
});

interface RepoFixture {
  repoRoot: string;
  cleanup: () => Promise<void>;
}

async function createTempRepo(): Promise<RepoFixture> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-conflict-watch-'));
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.mkdir(path.join(repoRoot, 'src', 'auth'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'src', 'auth', 'session.ts'), 'export {};\n');
  await git(repoRoot, ['add', '--', 'src/auth/session.ts']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return {
    repoRoot,
    cleanup: () => fs.rm(repoRoot, { recursive: true, force: true }),
  };
}

describe('scanHumanCheckout', () => {
  let repo: RepoFixture | undefined;

  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  it('reports an uncommitted edit as a human edit', async () => {
    repo = await createTempRepo();
    await fs.writeFile(
      path.join(repo.repoRoot, 'src', 'auth', 'session.ts'),
      'export const x = 1;\n',
    );
    const edits = await scanHumanCheckout(
      repo.repoRoot,
      () => '2026-01-01T00:00:00.000Z',
    );
    expect(edits).toEqual([
      { path: 'src/auth/session.ts', detectedAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});

interface Fixture extends RepoFixture {
  log: EventLog;
}

async function setupFixture(): Promise<Fixture> {
  const repo = await createTempRepo();
  // state.db lives outside repoRoot — inside it, `git status --porcelain`
  // would report the db file itself as an untracked "human edit".
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-conflict-watch-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  createIdentity(log, { id: 'human-1', name: 'P2 Dev', kind: 'human' });
  return {
    ...repo,
    log,
    cleanup: async () => {
      log.close();
      await fs.rm(dbDir, { recursive: true, force: true });
      await repo.cleanup();
    },
  };
}

describe('runConflictWatch', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('mints conflict.detected only for edits inside a leased scope, and human.file_edited for every edit', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-1',
      type: 'task',
      title: 'Auth ticket',
      lane: 'core',
      writeScope: ['src/auth/**'],
      verify: 'true',
    });
    const claimed = claimTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });

    await fs.writeFile(
      path.join(repoRoot, 'src', 'auth', 'session.ts'),
      'export const x = 1;\n',
    );
    await fs.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'docs', 'README.md'), '# hi\n');

    const detections = await runConflictWatch({
      log,
      actorId: 'worker-1',
      humanActorId: 'human-1',
      repoRoot,
      leases: [
        {
          ticketId: claimed.id,
          ownerId: claimed.ownerId!,
          writeScope: claimed.writeScope,
        },
      ],
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(detections).toEqual([
      {
        ticketId: 'T-1',
        ownerId: 'worker-1',
        path: 'src/auth/session.ts',
        matchedGlob: 'src/auth/**',
      },
    ]);

    const conflictEvents = listEvents(log).filter(
      (e) => e.eventType === 'conflict.detected',
    );
    expect(conflictEvents).toHaveLength(1);
    expect(conflictEvents[0]).toMatchObject({ ticketId: 'T-1', actorId: 'worker-1' });

    const editedEvents = listEvents(log).filter(
      (e) => e.eventType === 'human.file_edited',
    );
    expect(editedEvents).toHaveLength(2);
    expect(editedEvents.every((e) => e.actorId === 'human-1')).toBe(true);
    const leasedEditEvent = editedEvents.find(
      (e) => (e.payload as { path: string }).path === 'src/auth/session.ts',
    );
    expect(leasedEditEvent?.ticketId).toBe('T-1');
    const outsideEditEvent = editedEvents.find(
      (e) => (e.payload as { path: string }).path === 'docs/README.md',
    );
    expect(outsideEditEvent?.ticketId).toBeNull();
  });
});
