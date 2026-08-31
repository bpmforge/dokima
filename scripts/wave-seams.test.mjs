// wave-seams.test.mjs — P3-02 bridge tests. Available path: the REAL TS
// engine loads via Node type-stripping (same wiring heal.mjs pins for
// packages/loop) and real fs is bound to a temp worktree. Unavailable path:
// the loader injection points the import at a bogus path — the vendored-
// without-packages/ shape — and must yield ONE loud Tier-D gap, no crash.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { seamGapsForWave } from './conductor/wave-seams.mjs';

const wtPath = mkdtempSync(join(tmpdir(), 'dokima-wave-seams-'));
afterAll(() => rmSync(wtPath, { recursive: true, force: true }));

mkdirSync(join(wtPath, 'packages/tickets/src'), { recursive: true });
writeFileSync(
  join(wtPath, 'packages/tickets/src/index.ts'),
  "export { wiredThing } from './wired.js';\n",
);

const exportSeam = (exportName, extra = {}) => ({
  kind: 'export',
  id: `@dokima/tickets#${exportName}`,
  packageName: '@dokima/tickets',
  exportName,
  wiring_evidence: { file: 'packages/tickets/src/index.ts', exportName },
  ...extra,
});

describe('seamGapsForWave — available path (real engine, real fs)', () => {
  it('returns no gaps for a wired seam and an empty/absent seam list', async () => {
    expect(await seamGapsForWave({ seams: [exportSeam('wiredThing')], wtPath })).toEqual(
      [],
    );
    expect(await seamGapsForWave({ seams: [], wtPath })).toEqual([]);
    expect(await seamGapsForWave({ seams: undefined, wtPath })).toEqual([]);
  });

  it('turns a declared-but-unwritten export into a blocking gap attributed to its consumer ticket', async () => {
    const gaps = await seamGapsForWave({
      seams: [exportSeam('mintReceipt', { consumer_ticket: 'W1-02' })],
      wtPath,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('Tier-D seam gap [@dokima/tickets#mintReceipt]');
    expect(gaps[0]).toContain('(consumer W1-02)');
    expect(gaps[0]).toContain('packages/tickets/src/index.ts');
    expect(gaps[0]).toContain('does not export mintReceipt');
  });

  it('omits the consumer attribution when the seam does not carry one', async () => {
    const gaps = await seamGapsForWave({ seams: [exportSeam('ghost')], wtPath });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).not.toContain('(consumer');
  });

  it('lifts legacy decompose InterfaceRef rows into export seams (back-compat)', async () => {
    const legacy = (exportName, extra = {}) => ({
      interface_ref: { packageName: '@dokima/tickets', exportName },
      owner_pkg: 'packages/tickets',
      ...extra,
    });
    expect(await seamGapsForWave({ seams: [legacy('wiredThing')], wtPath })).toEqual([]);
    const gaps = await seamGapsForWave({
      seams: [legacy('mintReceipt', { consumer_ticket: 'W1-02' })],
      wtPath,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('Tier-D seam gap [@dokima/tickets#mintReceipt]');
    expect(gaps[0]).toContain('(consumer W1-02)');
    expect(gaps[0]).toContain('does not export mintReceipt');
  });

  it('reports malformed seam rows as spec-invalid gaps while asserting the valid ones', async () => {
    const gaps = await seamGapsForWave({
      seams: [{ id: 'bad', kind: 'telepathy' }, exportSeam('wiredThing')],
      wtPath,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('Tier-D seam spec invalid');
    expect(gaps[0]).toContain('unknown kind');
  });
});

describe('seamGapsForWave — unavailable path (vendored install without packages/)', () => {
  const bogusLoader = () => import('/nonexistent/dokima-p3-02/seams/index.ts');

  it('yields exactly one loud unavailable gap, never a crash', async () => {
    const gaps = await seamGapsForWave({
      seams: [exportSeam('mintReceipt')],
      wtPath,
      loader: bogusLoader,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('assertion engine unavailable');
    expect(gaps[0]).toContain('NO seam was checked');
  });

  it('an empty seam list needs no engine — no gap even when the engine is gone', async () => {
    expect(await seamGapsForWave({ seams: [], wtPath, loader: bogusLoader })).toEqual([]);
  });
});
