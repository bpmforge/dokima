import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdentity, openEventLog } from '@shipwright/events';
import { completeRun, createRun } from '@shipwright/harbormaster';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isImproveModeEntry,
  isRunCompletion,
  listRunTriggerEvents,
} from './run-events.js';

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-run-events-'));
}

async function openProjectLog(dir: string) {
  const dbPath = path.join(dir, '.shipwright', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const log = openEventLog(dbPath);
  createIdentity(log, { id: 'human-1', name: 'Test Human', kind: 'human' });
  return log;
}

describe('listRunTriggerEvents', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('reports empty + unchanged cursor for a project with no state.db yet', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const result = await listRunTriggerEvents(dir, 0);
    expect(result).toEqual({ events: [], maxSeq: 0 });
  });

  it('surfaces run.created and run.completed, advances maxSeq past unrelated events too', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const log = await openProjectLog(dir);
    createRun(log, {
      id: 'run-1',
      projectId: 'proj-1',
      mode: 'improve',
      breakpoint: 'ticket',
      actorId: 'human-1',
    });
    completeRun(log, 'run-1', 'human-1');
    log.close();

    const { events, maxSeq } = await listRunTriggerEvents(dir, 0);
    expect(events.map((e) => e.eventType)).toEqual(['run.created', 'run.completed']);
    expect(events.some(isImproveModeEntry)).toBe(true);
    expect(events.some(isRunCompletion)).toBe(true);
    expect(maxSeq).toBe(events[events.length - 1]!.seq);

    const second = await listRunTriggerEvents(dir, maxSeq);
    expect(second.events).toEqual([]);
    expect(second.maxSeq).toBe(maxSeq);
  });

  it('does not treat a non-improve run.created as an Improve-mode entry', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const log = await openProjectLog(dir);
    createRun(log, {
      id: 'run-1',
      projectId: 'proj-1',
      mode: 'feature',
      breakpoint: 'ticket',
      actorId: 'human-1',
    });
    log.close();

    const { events } = await listRunTriggerEvents(dir, 0);
    expect(events).toHaveLength(1);
    expect(isImproveModeEntry(events[0]!)).toBe(false);
  });
});
