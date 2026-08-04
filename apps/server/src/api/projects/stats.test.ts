import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEventLog, createIdentity } from '@dokima/events';
import { afterEach, describe, expect, it } from 'vitest';
import { createSlate, decideSlate } from '../decisions/store.js';
import { computeProjectStats } from './stats.js';

/**
 * W10-73. `pendingDecideCount` was a literal `0` in `EMPTY_STATS` and computed
 * nowhere, so a project with a creation run paused on two founder decisions
 * reported that nothing needed the founder. The Fleet card shows this number
 * as an "N needs you" badge AND `fleet/sort.ts` orders the whole Fleet by it —
 * so the project that most needed attention sank to the bottom of the list
 * instead of rising to the top.
 *
 * `apps/server/src/api/projects/` had no test file at all before this ticket.
 */
describe('computeProjectStats counts what needs a human (W10-73)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  async function project(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1073-'));
    dirs.push(dir);
    await fs.mkdir(path.join(dir, '.dokima'), { recursive: true });
    return dir;
  }

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

  it('RED FIXTURE: open founder slates are counted, not reported as zero', async () => {
    const dir = await project();
    const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    createSlate(log, founderInput('How does data sync'), { actorId: 'operator' });
    createSlate(log, founderInput('Which platforms in v1'), { actorId: 'operator' });
    log.close();

    const stats = await computeProjectStats(dir);

    expect(stats.pendingDecideCount).toBe(2);
  });

  it('drops back to zero as the founder answers — the badge must not outlive the question', async () => {
    const dir = await project();
    const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    const record = createSlate(log, founderInput('How does data sync'), {
      actorId: 'operator',
    });
    log.close();

    expect((await computeProjectStats(dir)).pendingDecideCount).toBe(1);

    const write = openEventLog(path.join(dir, '.dokima', 'state.db'));
    decideSlate(
      write,
      { slateId: record.id, chosen: 'a' },
      { projectPath: dir, actorId: 'operator' },
    );
    write.close();

    expect((await computeProjectStats(dir)).pendingDecideCount).toBe(0);
  });

  it('a project with no decisions table at all still renders — a Fleet card never fails over a count', async () => {
    const dir = await project();
    const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
    log.close();

    const stats = await computeProjectStats(dir);

    expect(stats.pendingDecideCount).toBe(0);
    expect(stats.board).toEqual({ ready: 0, blocked: 0, done: 0 });
  });

  it('the three fields this ticket did NOT compute are still constants, on purpose', async () => {
    const dir = await project();
    const log = openEventLog(path.join(dir, '.dokima', 'state.db'));
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    createSlate(log, founderInput('How does data sync'), { actorId: 'operator' });
    log.close();

    const stats = await computeProjectStats(dir);

    // Pinned so the next reader knows these are unimplemented rather than
    // merely zero right now — the ticket asked for exactly this distinction.
    expect(stats.berthsRunning).toBe(0);
    expect(stats.heartbeatAgeMs).toBeNull();
    expect(stats.spendTodayUsd).toBe(0);
  });
});
