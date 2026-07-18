import { describe, expect, it } from 'vitest';
import { GlobalBerthGovernor, resolveGovernorCap } from './governor.js';

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('resolveGovernorCap', () => {
  it('is ungoverned (Infinity) when no scope sets a cap', () => {
    expect(resolveGovernorCap()).toEqual({
      cap: Number.POSITIVE_INFINITY,
      scope: undefined,
    });
    expect(resolveGovernorCap({})).toEqual({
      cap: Number.POSITIVE_INFINITY,
      scope: undefined,
    });
  });

  it('resolves run > project > global precedence (FR-S1, D-012)', () => {
    expect(resolveGovernorCap({ global: 6 })).toEqual({ cap: 6, scope: 'global' });
    expect(resolveGovernorCap({ global: 6, project: 3 })).toEqual({
      cap: 3,
      scope: 'project',
    });
    expect(resolveGovernorCap({ global: 6, project: 3, run: 1 })).toEqual({
      cap: 1,
      scope: 'run',
    });
    // project overrides global even with no run value set.
    expect(resolveGovernorCap({ project: 3 })).toEqual({ cap: 3, scope: 'project' });
  });

  it('clamps to a minimum of 1', () => {
    expect(resolveGovernorCap({ global: 0 })).toEqual({ cap: 1, scope: 'global' });
    expect(resolveGovernorCap({ global: -5 })).toEqual({ cap: 1, scope: 'global' });
    expect(resolveGovernorCap({ global: 2.9 })).toEqual({ cap: 2, scope: 'global' });
  });
});

describe('GlobalBerthGovernor', () => {
  it('caps summed active berths across projects at N; per-project dials allocate within the cap (ARCHITECTURE §6)', async () => {
    // Project X's berths dial wants 3, project Y's wants 2 -> 5 > cap of 4.
    const governor = new GlobalBerthGovernor({ global: 4 });
    const ran: string[] = [];
    let peakActive = 0;
    const pendingResolvers: Array<() => void> = [];

    const submit = (project: string, id: string) =>
      governor.runBerth(project, async () => {
        ran.push(id);
        peakActive = Math.max(peakActive, governor.activeCount);
        await new Promise<void>((resolve) => pendingResolvers.push(resolve));
      });

    const results = [
      submit('X', 'X0'),
      submit('X', 'X1'),
      submit('X', 'X2'),
      submit('Y', 'Y0'),
      submit('Y', 'Y1'),
    ];

    await flush();

    // Cap holds: never more than 4 active at once, even with 5 requested.
    expect(governor.activeCount).toBe(4);
    expect(peakActive).toBe(4);
    // Neither project is fully starved: X got its full 3, Y got 1 of 2 immediately.
    expect(ran.slice().sort()).toEqual(['X0', 'X1', 'X2', 'Y0']);
    expect(governor.queuedCountForProject('Y')).toBe(1);
    expect(governor.queuedCountForProject('X')).toBe(0);

    // Freeing one active berth admits Y's queued request — still never over cap.
    pendingResolvers.shift()!();
    await flush();
    expect(governor.activeCount).toBe(4);
    expect(ran).toContain('Y1');
    expect(peakActive).toBe(4);

    while (pendingResolvers.length > 0) pendingResolvers.shift()!();
    await Promise.all(results);
    expect(governor.activeCount).toBe(0);
  });

  it('is ungoverned by default, admitting unbounded concurrent berths', async () => {
    const governor = new GlobalBerthGovernor();
    expect(governor.cap).toBe(Number.POSITIVE_INFINITY);

    let peakActive = 0;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        governor.runBerth(`project-${i}`, async () => {
          peakActive = Math.max(peakActive, governor.activeCount);
        }),
      ),
    );
    expect(peakActive).toBeGreaterThan(1);
  });
});
