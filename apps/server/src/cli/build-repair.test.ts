/**
 * W23-11, the caller. The module-level loop drives canned seams; this asserts
 * the thing only the caller can get wrong — what it says about a ticket THIS
 * run landed that no reviewer ever looked at. A run parks tickets more often
 * than not, and `run-build.ts` hands every processed id to the loop.
 */

import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog } from '@dokima/events';
import { claimTicket, createTicket } from '@dokima/tickets';
import { REPAIR_STOPPED_EVENT, type LandLoopOptions } from '@dokima/harbormaster';
import { executeRepairRounds } from './build-repair.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

describe('a ticket this run landed but nobody reviewed', () => {
  it('RED FIXTURE: is reported as not reviewed, and claims no confirmation in the log', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-build-repair-'));
    dirs.push(dir);
    const log = openEventLog(path.join(dir, 'state.db'));
    try {
      createIdentity(log, { id: 'maker', name: 'Maker', kind: 'machine' });
      createIdentity(log, { id: 'founder', name: 'Founder', kind: 'human' });
      createTicket(log, 'founder', {
        id: 'T-1',
        type: 'task',
        title: 'Parked work',
        lane: 'core',
        writeScope: ['src/**'],
      });
      // Claimed, never closed — the shape a parked ticket leaves behind.
      claimTicket(log, { ticketId: 'T-1', actorId: 'maker' });

      const lines: string[] = [];
      const outcomes = await executeRepairRounds({
        log,
        runId: 'run-1',
        ticketIds: ['T-1'],
        // Neither is reached: the loop returns before it needs a maker or a
        // reviewer, which is exactly what makes this safe to assert here.
        landOptions: {} as unknown as LandLoopOptions,
        review: {} as never,
        stderr: (line) => lines.push(line),
      });

      expect(outcomes[0]?.stop).toBe('not-reviewed');
      expect(listEvents(log).filter((e) => e.eventType === REPAIR_STOPPED_EVENT)).toEqual(
        [],
      );
      expect(lines).toEqual([]);
    } finally {
      log.close();
    }
  });
});
