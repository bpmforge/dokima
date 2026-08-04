import { promises as fsp } from 'node:fs';
import os from 'node:os';
import pathMod from 'node:path';
import { openEventLog, createIdentity, type EventLog } from '@dokima/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSlate, decideSlate } from '../decisions/store.js';
import { listNotifications } from './emit.js';
import { syncDecideSlateNotifications } from './decide-slates.js';

/**
 * W10-73. Measured with a real creation run paused on two founder decisions,
 * both slates `status=open`: the morning queue said "Nothing needs you.", the
 * Decide filter was empty, and the header bell announced 0 awaiting a decision
 * to a screen reader. Nothing anywhere turned a slate into a notification.
 */
describe('an open decision slate is a Decide-tier notification (W10-73)', () => {
  let log: EventLog;
  let ledgerDir: string;
  let n = 0;
  const opts = () => ({
    actorId: 'operator',
    mintId: () => `decide-slate-${(n += 1)}`,
    now: () => '2026-08-04T00:00:00.000Z',
  });

  // `createSlate` takes the WRAPPER input and flattens it (buildFounderSlate);
  // the stored `Slate` carries `title` at the top level, which is what the
  // notification uses.
  const founderInput = (title: string) => ({
    kind: 'founder' as const,
    founder: {
      title,
      options: [
        { id: 'a', label: 'Option A', tradeoffs: 'fast' },
        { id: 'b', label: 'Option B', tradeoffs: 'slow' },
      ],
      recommendedId: 'a',
      recommendedReasoning: 'ships sooner',
    },
  });

  beforeEach(async () => {
    // A THROWAWAY LEDGER DIRECTORY. `decideSlate` writes a real D-row into
    // `<projectPath>/docs/DECISIONS.md`, so passing `process.cwd()` here — as
    // the first version of this file did — appended test rows to THIS REPO's
    // canonical founder decision ledger, the one CLAUDE.md marks do-not-
    // re-litigate. Fifteen of them, eleven pushed, before it was noticed.
    ledgerDir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'dokima-decide-ledger-'));
    log = openEventLog(':memory:');
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    n = 0;
  });

  afterEach(async () => {
    await fsp.rm(ledgerDir, { recursive: true, force: true });
  });

  it('RED FIXTURE: an open slate becomes a Decide card the morning queue can show', () => {
    createSlate(log, founderInput('How does data sync'), { actorId: 'operator' });

    const minted = syncDecideSlateNotifications(log, opts());

    expect(minted).toHaveLength(1);
    const decide = listNotifications(log, { tier: 'decide', status: 'open' });
    expect(decide).toHaveLength(1);
    expect(decide[0]?.kind).toBe('clarification');
    expect(decide[0]?.title).toBe('How does data sync');
    // The card must point AT the slate, or the queue can offer no way to answer it.
    expect(decide[0]?.refType).toBe('slate');
  });

  it('is idempotent — it runs on every notifications refresh and must not pile up duplicates', () => {
    createSlate(log, founderInput('How does data sync'), { actorId: 'operator' });

    syncDecideSlateNotifications(log, opts());
    syncDecideSlateNotifications(log, opts());
    syncDecideSlateNotifications(log, opts());

    expect(listNotifications(log, { tier: 'decide', status: 'open' })).toHaveLength(1);
  });

  it('resolves the card once the slate is answered, wherever it was answered', () => {
    const record = createSlate(log, founderInput('How does data sync'), {
      actorId: 'operator',
    });
    syncDecideSlateNotifications(log, opts());
    expect(listNotifications(log, { tier: 'decide', status: 'open' })).toHaveLength(1);

    // Answered through the decisions store — the Decisions board, the CLI and a
    // resumed run all land here. A card still demanding an answer that already
    // exists is the same dishonesty as the queue missing one.
    decideSlate(
      log,
      { slateId: record.id, chosen: 'a' },
      { projectPath: ledgerDir, actorId: 'operator' },
    );

    syncDecideSlateNotifications(log, opts());
    expect(listNotifications(log, { tier: 'decide', status: 'open' })).toHaveLength(0);
  });

  it('a project with nothing open gets no cards — the quiet state stays honestly quiet', () => {
    expect(syncDecideSlateNotifications(log, opts())).toEqual([]);
    expect(listNotifications(log, { tier: 'decide', status: 'open' })).toHaveLength(0);
  });

  /**
   * THE WIRING, not just the function. Removing the call from
   * `refreshAndListProjectNotifications` leaves every case above green — which
   * is exactly the gap that let W10-72, W10-74 and W10-78 ship unreachable
   * code. This one goes through the real refresh the route uses.
   */
  it('RED FIXTURE: the real notifications refresh emits the card, not just the function', async () => {
    const { promises: fsp } = await import('node:fs');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const { refreshAndListProjectNotifications } = await import(
      '../server/notifications-routes/shared.js'
    );

    const dir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'dokima-w1073-wire-'));
    try {
      await fsp.mkdir(pathMod.join(dir, '.dokima'), { recursive: true });
      const projectLog = openEventLog(pathMod.join(dir, '.dokima', 'state.db'));
      createIdentity(projectLog, { id: 'operator', name: 'operator', kind: 'human' });
      createSlate(projectLog, founderInput('How does data sync'), {
        actorId: 'operator',
      });
      projectLog.close();

      const wire = await refreshAndListProjectNotifications(
        { id: 'p1', name: 'Watched', path: dir },
        { tier: 'decide', status: 'open' },
      );

      expect(wire).toHaveLength(1);
      expect(wire[0]?.title).toBe('How does data sync');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
