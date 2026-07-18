import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog, type EventLog } from '@shipwright/events';
import {
  completeRun,
  createRun,
  getRun,
  InvalidRunTransitionError,
  listRuns,
  markRunResumed,
  pauseRun,
  RunNotFoundError,
  stopRun,
  suspendRun,
} from './breakpoints-runs.js';

const NOW = () => '2026-07-18T00:00:00.000Z';

async function setup(): Promise<{ log: EventLog; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-runs-test-'));
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'human-1', name: 'Brad', kind: 'human' }, { now: NOW });
  return { log, dir };
}

describe('run lifecycle (DATABASE.md §3 `runs`, FR-H3/FR-C7)', () => {
  let log: EventLog | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    log?.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    log = undefined;
    dir = undefined;
  });

  it('creates a run, running by default, defaults berths to 1', async () => {
    ({ log, dir } = await setup());
    const run = createRun(
      log,
      {
        id: 'run-1',
        projectId: 'proj-1',
        mode: 'feature',
        breakpoint: 'ticket',
        actorId: 'human-1',
      },
      { now: NOW },
    );
    expect(run).toEqual({
      id: 'run-1',
      projectId: 'proj-1',
      mode: 'feature',
      phase: null,
      status: 'running',
      breakpoint: 'ticket',
      berths: 1,
      budgetUsd: null,
      budgetTokens: null,
      startedAt: NOW(),
      endedAt: null,
    });
    expect(getRun(log, 'run-1')).toEqual(run);
  });

  it('refuses a duplicate id', async () => {
    ({ log, dir } = await setup());
    createRun(
      log,
      {
        id: 'run-1',
        projectId: 'proj-1',
        mode: 'feature',
        breakpoint: 'never',
        actorId: 'human-1',
      },
      { now: NOW },
    );
    expect(() =>
      createRun(
        log!,
        {
          id: 'run-1',
          projectId: 'proj-1',
          mode: 'feature',
          breakpoint: 'never',
          actorId: 'human-1',
        },
        { now: NOW },
      ),
    ).toThrow(/already exists/);
  });

  it('pause -> resume -> stop transitions, each anchored by its own event', async () => {
    ({ log, dir } = await setup());
    createRun(
      log,
      {
        id: 'run-1',
        projectId: 'proj-1',
        mode: 'feature',
        breakpoint: 'wave',
        berths: 3,
        actorId: 'human-1',
      },
      { now: NOW },
    );

    const paused = pauseRun(log, 'run-1', 'human-1', { now: NOW });
    expect(paused.status).toBe('paused');

    const resumed = markRunResumed(log, 'run-1', 'human-1', { now: NOW });
    expect(resumed.status).toBe('running');

    const stopped = stopRun(log, 'run-1', 'human-1', { now: NOW });
    expect(stopped.status).toBe('stopped');
    expect(stopped.endedAt).toBe(NOW());
  });

  it('suspend records a distinct terminal-ish state from an ordinary pause (drift refusal path)', async () => {
    ({ log, dir } = await setup());
    createRun(
      log,
      {
        id: 'run-1',
        projectId: 'proj-1',
        mode: 'feature',
        breakpoint: 'never',
        actorId: 'human-1',
      },
      { now: NOW },
    );
    const suspended = suspendRun(log, 'run-1', 'human-1', { now: NOW });
    expect(suspended.status).toBe('suspended');
  });

  it('completeRun sets status done + endedAt', async () => {
    ({ log, dir } = await setup());
    createRun(
      log,
      {
        id: 'run-1',
        projectId: 'proj-1',
        mode: 'feature',
        breakpoint: 'never',
        actorId: 'human-1',
      },
      { now: NOW },
    );
    const done = completeRun(log, 'run-1', 'human-1', { now: NOW });
    expect(done.status).toBe('done');
    expect(done.endedAt).toBe(NOW());
  });

  it('refuses an invalid transition (e.g. resuming a stopped run)', async () => {
    ({ log, dir } = await setup());
    createRun(
      log,
      {
        id: 'run-1',
        projectId: 'proj-1',
        mode: 'feature',
        breakpoint: 'never',
        actorId: 'human-1',
      },
      { now: NOW },
    );
    stopRun(log, 'run-1', 'human-1', { now: NOW });
    expect(() => markRunResumed(log!, 'run-1', 'human-1', { now: NOW })).toThrow(
      InvalidRunTransitionError,
    );
  });

  it('getRun/listRuns on an unknown id/empty project', async () => {
    ({ log, dir } = await setup());
    expect(getRun(log, 'nope')).toBeUndefined();
    expect(() => stopRun(log!, 'nope', 'human-1')).toThrow(RunNotFoundError);
    expect(listRuns(log)).toEqual([]);
  });

  it('listRuns filters by projectId and orders by startedAt', async () => {
    ({ log, dir } = await setup());
    createRun(
      log,
      {
        id: 'run-a',
        projectId: 'proj-a',
        mode: 'feature',
        breakpoint: 'never',
        actorId: 'human-1',
      },
      { now: () => '2026-07-18T00:00:00.000Z' },
    );
    createRun(
      log,
      {
        id: 'run-b',
        projectId: 'proj-b',
        mode: 'feature',
        breakpoint: 'never',
        actorId: 'human-1',
      },
      { now: () => '2026-07-18T00:00:01.000Z' },
    );
    expect(listRuns(log, 'proj-a').map((r) => r.id)).toEqual(['run-a']);
    expect(listRuns(log).map((r) => r.id)).toEqual(['run-a', 'run-b']);
  });
});
