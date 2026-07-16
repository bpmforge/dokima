import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import { git } from '@shipwright/git';
import type { Handoff } from '@shipwright/loop';
import { claimTicket, createTicket, getTicket, startTicket } from '@shipwright/tickets';
import { runWatchdogSession } from './watchdog-session.js';

interface Fixture {
  repoRoot: string;
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'shipwright-watchdog-sess-repo-'),
  );
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-watchdog-sess-db-'));
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

const HANDOFF: Handoff = {
  role: 'coding-agent',
  mission: 'hang forever',
  ticket: { id: 'T-1', title: 'Hung ticket' },
  context: 'fixture',
  writeScope: ['packages/example/**'],
  produce: ['nothing'],
  verify: 'true',
};

describe('runWatchdogSession', () => {
  let fixture: Fixture | undefined;

  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('breach -> dead-letter event + ticket blocked-with-evidence, within seconds (acceptance 1)', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-1',
      type: 'task',
      title: 'Hung ticket',
      lane: 'core',
      writeScope: ['packages/example/**'],
      verify: 'true',
    });
    claimTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });
    startTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });

    const start = Date.now();
    const { session, breach } = await runWatchdogSession({
      log,
      actorId: 'worker-1',
      ticketId: 'T-1',
      runId: 'run-1',
      handoff: HANDOFF,
      cwd: repoRoot,
      command: 'bash',
      args: ['-c', 'sleep 30'],
      maxSessionSeconds: 0.05,
      heartbeatStallSeconds: 60,
      pollIntervalMs: 10,
      forceKillGraceMs: 100,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2_000);
    expect(breach?.reason).toBe('max_session_seconds');
    expect(session.exitCode).not.toBe(0);
    expect(session.manifest).toBeNull();

    const deadLetterEvents = listEvents(log).filter(
      (e) => e.eventType === 'session.dead_letter',
    );
    expect(deadLetterEvents).toHaveLength(1);
    expect(deadLetterEvents[0]).toMatchObject({ ticketId: 'T-1', runId: 'run-1' });

    const ticket = getTicket(log, 'T-1');
    expect(ticket?.status).toBe('ready');
    const evidenceComment = ticket?.history.findLast((entry) => entry.verb === 'comment');
    expect(evidenceComment?.body).toEqual(
      expect.stringContaining(
        'watchdog terminated the session tree (max_session_seconds',
      ),
    );
  });

  it('leaves the ticket in_progress and mints no dead-letter event when the session finishes cleanly', async () => {
    fixture = await setupFixture();
    const { log, repoRoot } = fixture;
    createTicket(log, 'worker-1', {
      id: 'T-2',
      type: 'task',
      title: 'Fast ticket',
      lane: 'core',
      writeScope: ['packages/example/**'],
      verify: 'true',
    });
    claimTicket(log, { ticketId: 'T-2', actorId: 'worker-1' });
    startTicket(log, { ticketId: 'T-2', actorId: 'worker-1' });

    const { breach } = await runWatchdogSession({
      log,
      actorId: 'worker-1',
      ticketId: 'T-2',
      handoff: { ...HANDOFF, ticket: { id: 'T-2', title: 'Fast ticket' } },
      cwd: repoRoot,
      command: 'bash',
      args: ['-c', 'echo done'],
      maxSessionSeconds: 60,
      heartbeatStallSeconds: 60,
      pollIntervalMs: 10,
    });

    expect(breach).toBeNull();
    expect(listEvents(log).some((e) => e.eventType === 'session.dead_letter')).toBe(
      false,
    );
    expect(getTicket(log, 'T-2')?.status).toBe('in_progress');
  });
});
