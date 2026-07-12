import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, type EventLog } from '@shipwright/events';
import { checkChain, renderChainResult } from './verify-chain.js';
import { openWritableLog, resolveDbPath } from './db.js';
import { createTempProject, type TempProject } from './test-helpers.js';

describe('renderChainResult', () => {
  it('reports a valid chain', () => {
    expect(renderChainResult({ valid: true, brokenAtSeq: null, reason: null })).toBe(
      'chain OK: all events verified against the hash chain',
    );
  });

  it('reports a broken chain with the seq and reason', () => {
    expect(
      renderChainResult({
        valid: false,
        brokenAtSeq: 3,
        reason: 'hash does not match recomputed value',
      }),
    ).toBe('chain BROKEN at seq 3: hash does not match recomputed value');
  });
});

describe('checkChain', () => {
  let project: TempProject;
  let log: EventLog;

  afterEach(async () => {
    log?.close();
    await project?.cleanup();
  });

  it('verifies a log with real appended events as valid', async () => {
    project = await createTempProject();
    const dbPath = resolveDbPath(project.cwd);
    log = openWritableLog(dbPath);
    createIdentity(log, { id: 'maker-1', name: 'Maker One', kind: 'human' });
    appendEvent(log, {
      eventType: 'ticket.commented',
      actorId: 'maker-1',
      payload: { body: 'hi' },
    });
    appendEvent(log, {
      eventType: 'ticket.commented',
      actorId: 'maker-1',
      payload: { body: 'again' },
    });

    expect(checkChain(log)).toEqual({ valid: true, brokenAtSeq: null, reason: null });
  });
});
