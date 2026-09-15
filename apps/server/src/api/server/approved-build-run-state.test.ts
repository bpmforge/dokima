/**
 * W23-13. Every one of these is a question a Map cannot answer after the
 * process that held it is gone, so each test does the same thing: writes
 * state, throws the reader away, and asks again through a fresh read of the
 * log — which is what a restarted core actually is.
 */

import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  buildRunStopped,
  classifyRunOutcome,
  finishBuildRun,
  readBuildRunState,
  startBuildRun,
  sweepInterruptedRuns,
} from './approved-build-run-state.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

/** A project state.db plus the ability to CLOSE and REOPEN it — the restart. */
function project(): { dbPath: string; open: () => EventLog } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-run-state-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'state.db');
  const first = openEventLog(dbPath);
  createIdentity(first, { id: 'operator', name: 'Operator', kind: 'human' });
  first.close();
  return { dbPath, open: () => openEventLog(dbPath) };
}

const START = {
  runId: 'run-1',
  projectId: 'p1',
  actorId: 'operator',
  approvedBuild: true,
};

describe('a crash leaves a visible run, not a ghost', () => {
  it('a started run whose process died reads as interrupted after a restart', () => {
    const p = project();
    let log = p.open();
    try {
      expect(startBuildRun(log, START).kind).toBe('started');
      // Some work happened and was recorded before the process died.
      appendEvent(log, {
        eventType: 'build.repair.round',
        actorId: 'operator',
        ticketId: null,
        runId: 'run-1',
        payload: { round: 1 },
      });
      expect(readBuildRunState(log, 'run-1')?.outcome).toBeNull();
    } finally {
      log.close();
    }

    // THE RESTART: a new process, with empty Maps and no memory of anything.
    log = p.open();
    try {
      expect(
        sweepInterruptedRuns(log, {
          projectId: 'p1',
          actorId: 'operator',
          liveRunIds: new Set(),
        }),
      ).toEqual(['run-1']);
      const state = readBuildRunState(log, 'run-1');
      expect(state?.outcome).toBe('interrupted');
      // The counters the run had already spent survived with it.
      expect(state?.startedAt).toBeTruthy();
    } finally {
      log.close();
    }
  });

  it('a run this process IS executing is never swept', () => {
    const p = project();
    const log = p.open();
    try {
      startBuildRun(log, START);
      expect(
        sweepInterruptedRuns(log, {
          projectId: 'p1',
          actorId: 'operator',
          liveRunIds: new Set(['run-1']),
        }),
      ).toEqual([]);
      expect(readBuildRunState(log, 'run-1')?.outcome).toBeNull();
    } finally {
      log.close();
    }
  });

  it('a finished run is not re-marked interrupted by a later sweep', () => {
    const p = project();
    const log = p.open();
    try {
      startBuildRun(log, START);
      finishBuildRun(log, {
        runId: 'run-1',
        actorId: 'operator',
        kind: 'verified',
        detail: 'done',
        exitCode: 0,
      });
      expect(
        sweepInterruptedRuns(log, {
          projectId: 'p1',
          actorId: 'operator',
          liveRunIds: new Set(),
        }),
      ).toEqual([]);
      expect(readBuildRunState(log, 'run-1')?.outcome).toBe('verified');
    } finally {
      log.close();
    }
  });
});

describe('one run id, one project, one writer', () => {
  it('a repeated start for the same run is a duplicate, never a second acceptance', () => {
    const p = project();
    const log = p.open();
    try {
      expect(startBuildRun(log, START).kind).toBe('started');
      expect(startBuildRun(log, START).kind).toBe('duplicate');
      const starts = readBuildRunState(log, 'run-1');
      expect(starts?.projectId).toBe('p1');
    } finally {
      log.close();
    }
  });

  it('RED FIXTURE: a run id belonging to another project is refused, not answered', () => {
    const p = project();
    const log = p.open();
    try {
      startBuildRun(log, START);
      const other = startBuildRun(log, { ...START, projectId: 'p2' });
      expect(other.kind).toBe('refused');
      expect(other).toMatchObject({ reason: expect.stringContaining('another project') });
    } finally {
      log.close();
    }
  });

  it('RED FIXTURE: a FINISHED run id cannot be reused — a second run would overwrite its history', () => {
    const p = project();
    const log = p.open();
    try {
      startBuildRun(log, START);
      finishBuildRun(log, {
        runId: 'run-1',
        actorId: 'operator',
        kind: 'verified',
        detail: 'done',
        exitCode: 0,
      });
      expect(startBuildRun(log, START).kind).toBe('refused');
    } finally {
      log.close();
    }
  });
});

describe('a stop survives a restart', () => {
  it('the stop recorded before the crash still blocks new work after it', () => {
    const p = project();
    let log = p.open();
    try {
      startBuildRun(log, START);
      appendEvent(log, {
        eventType: 'run.stop_requested',
        actorId: 'operator',
        ticketId: null,
        runId: 'run-1',
        payload: { by: 'operator' },
      });
      expect(buildRunStopped(log, 'run-1')).toBe(true);
    } finally {
      log.close();
    }

    log = p.open();
    try {
      // The Map that used to hold this is gone; the answer is unchanged.
      expect(buildRunStopped(log, 'run-1')).toBe(true);
      expect(readBuildRunState(log, 'run-1')?.stopRequested).toBe(true);
    } finally {
      log.close();
    }
  });

  it('a run nobody stopped is not stopped, and an unknown run is not either', () => {
    const p = project();
    const log = p.open();
    try {
      startBuildRun(log, START);
      expect(buildRunStopped(log, 'run-1')).toBe(false);
      expect(buildRunStopped(log, 'run-nothing')).toBe(false);
    } finally {
      log.close();
    }
  });
});

describe('exit 0 is not build completion', () => {
  it.each([
    [
      'a clean run with tickets still in review',
      { exitCode: 0, stopRequested: false, ticketsAwaitingDecision: 2 },
      'awaiting_decision',
    ],
    [
      'a clean run with nothing left to decide',
      { exitCode: 0, stopRequested: false, ticketsAwaitingDecision: 0 },
      'verified',
    ],
    [
      'a refusal or a crash',
      { exitCode: 2, stopRequested: false, ticketsAwaitingDecision: 0 },
      'failed',
    ],
    [
      'a person who asked it to stop — even on a clean exit',
      { exitCode: 0, stopRequested: true, ticketsAwaitingDecision: 0 },
      'stopped',
    ],
  ])('%s → %s', (_what, input, expected) => {
    expect(classifyRunOutcome(input).kind).toBe(expected);
  });
});
