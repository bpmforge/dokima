/**
 * P6-13: the composition that finally starts the wave automations. The RED
 * these pin: before this chapter, startWaveAutomations had zero callers and
 * the advisory review was injected by nobody — server.ts now boots
 * startFleetWaveAutomations (asserted against the source, the same pinning
 * shape wave-automations.test.ts uses for its zero-Decide-verbs promise).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fleetAdvisoryTick,
  parseAdvisoryFindings,
  parseAuditFindings,
  runProjectDepsAudit,
  startFleetWaveAutomations,
} from './wave-automations-wiring.js';
import { createMemoryBranchCursor } from './wave-automations.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('parseAdvisoryFindings', () => {
  it('extracts a JSON array from prose, tolerates junk, refuses non-arrays', () => {
    expect(
      parseAdvisoryFindings(
        'Here you go:\n[{"severity":"HIGH","file":"a.ts","issue":"x"}] done',
      ),
    ).toEqual([{ severity: 'HIGH', file: 'a.ts', issue: 'x' }]);
    expect(parseAdvisoryFindings('no json at all')).toEqual([]);
    expect(parseAdvisoryFindings('{"file":"a.ts"}')).toEqual([]);
    expect(parseAdvisoryFindings('[{"nope":1}]')).toEqual([]);
  });
});

describe('fleetAdvisoryTick', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('an empty fleet registry ticks to a clean no-op — no throw, no notify', async () => {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-p613-fleet-'));
    dirs.push(fleetHome);
    const lines: string[] = [];
    const tick = fleetAdvisoryTick({
      fleetHome,
      notify: (l) => lines.push(l),
      cursor: createMemoryBranchCursor(),
    });
    await tick();
    expect(lines).toEqual([]);
  });
});

describe('the server actually BOOTS the automations (the missing caller)', () => {
  it('server.ts starts startFleetWaveAutomations and stops it onClose — pinned in source', async () => {
    const src = await fs.readFile(path.resolve(HERE, '../api/server.ts'), 'utf8');
    expect(src).toContain('startFleetWaveAutomations({ fleetHome');
    expect(src).toContain('waveAutomations.stop()');
  });

  it('startFleetWaveAutomations returns a working stop handle', () => {
    const h = startFleetWaveAutomations({
      fleetHome: undefined,
      intervalMs: 60 * 60_000, // never fires within the test
    });
    h.stop();
  });
});

describe('P6-14 — dependency sweep + post-merge smoke are STARTED', () => {
  it('parseAuditFindings reads npm-audit v2 and classic shapes, junk yields []', () => {
    expect(
      parseAuditFindings(
        JSON.stringify({
          vulnerabilities: {
            lodash: { severity: 'high', via: [{ title: 'Prototype pollution' }] },
          },
        }),
      ),
    ).toEqual([{ pkg: 'lodash', severity: 'high', advisory: 'Prototype pollution' }]);
    expect(
      parseAuditFindings(
        JSON.stringify({
          advisories: { '1': { module_name: 'x', severity: 'critical', title: 'RCE' } },
        }),
      ),
    ).toEqual([{ pkg: 'x', severity: 'critical', advisory: 'RCE' }]);
    expect(parseAuditFindings('not json')).toEqual([]);
  });

  it('runProjectDepsAudit with no lockfile SKIPS loudly and returns [] — never a silent all-clear', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-p614-nolock-'));
    try {
      const lines: string[] = [];
      const r = await runProjectDepsAudit(dir, (l) => lines.push(l));
      expect(r).toEqual([]);
      expect(lines[0]).toContain('no supported lockfile');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('the tick composes all three automations — pinned in source (the P6-13 lesson: a comment is not a caller)', async () => {
    const src = await fs.readFile(
      path.resolve(HERE, 'wave-automations-wiring.ts'),
      'utf8',
    );
    expect(src).toContain('await pollBranchAdvisoryReviews({');
    expect(src).toContain('await runDependencySweep({');
    expect(src).toContain('await postMergeSmoke({');
    // proposals + escalations go to the notifications surface, never a merge
    expect(src).toContain("tier: 'review'");
    expect(src).toContain("tier: 'decide'");
    expect(src).not.toMatch(/git\(.+\bmerge\b/);
  });
});
