// assert.test.ts — P3-02 build-time assertion engine: each evidence kind red
// AND green against an injected in-memory fs (hermetic), headlined by the gap
// this ticket closes — an export DECLARED on the plan but never written to the
// built head fails HERE, where plan-time lint stays green.

import { describe, expect, it } from 'vitest';
import { assertSeams, containsExport } from './assert.js';
import type { Seam } from './types.js';

/** Hermetic SeamFs over a {path: content} map — deliberately sync callbacks
 * to pin that the engine accepts sync or async injections. */
const memFs = (files: Record<string, string>) => ({
  readFile: (f: string) => {
    const content = files[f];
    if (content === undefined) throw new Error(`readFile on missing ${f}`);
    return content;
  },
  fileExists: (f: string) => files[f] !== undefined,
});

const exportSeam = (file: string, exportName: string): Seam => ({
  kind: 'export',
  id: `@dokima/tickets#${exportName}`,
  packageName: '@dokima/tickets',
  exportName,
  consumer_ticket: 'W1-02',
  wiring_evidence: { file, exportName },
});

describe('the declared-but-unwritten export (the gap P3-02 closes)', () => {
  it('FAILS a seam whose export is absent from the built head, naming file + export', async () => {
    // Plan-time state: the ticket DECLARED providesInterfaces mintReceipt, so
    // findUnownedInterfaces is green. Built head: the barrel exists but the
    // export was never written.
    const fs = memFs({
      'packages/tickets/src/index.ts': "export { otherThing } from './other.js';\n",
    });
    const [r] = await assertSeams(
      [exportSeam('packages/tickets/src/index.ts', 'mintReceipt')],
      fs,
    );
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain('packages/tickets/src/index.ts');
    expect(r?.reason).toContain('does not export mintReceipt');
  });

  it('FAILS with a missing-file reason when the evidence file was never created', async () => {
    const [r] = await assertSeams(
      [exportSeam('packages/tickets/src/index.ts', 'mintReceipt')],
      memFs({}),
    );
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain('packages/tickets/src/index.ts does not exist');
    expect(r?.reason).toContain('mintReceipt');
  });

  it('PASSES when the export is really there (declaration or re-export)', async () => {
    const fs = memFs({
      'a.ts': 'export function mintReceipt(): void {}\n',
      'b.ts': "export { mint as mintReceipt } from './a.js';\n",
      'c.ts': "export type { mintReceipt } from './a.js';\n",
    });
    const results = await assertSeams(
      [
        exportSeam('a.ts', 'mintReceipt'),
        exportSeam('b.ts', 'mintReceipt'),
        exportSeam('c.ts', 'mintReceipt'),
      ],
      fs,
    );
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
  });
});

describe('containsExport', () => {
  it('does not match substrings, comments about exports, or as-renames AWAY', () => {
    expect(containsExport('export const mintReceipts = 1;', 'mintReceipt')).toBe(false);
    expect(containsExport('// export const x = 1;', 'y')).toBe(false);
    // `mintReceipt as other` exports `other`, not `mintReceipt`.
    expect(
      containsExport("export { mintReceipt as other } from './a.js';", 'mintReceipt'),
    ).toBe(false);
    expect(
      containsExport("export { mintReceipt as other } from './a.js';", 'other'),
    ).toBe(true);
  });
});

describe('route evidence (red + green)', () => {
  const route = (pattern: string): Seam => ({
    kind: 'route',
    id: 'route:POST /api/projects',
    method: 'POST',
    path: '/api/projects',
    wiring_evidence: { file: 'routes.ts', pattern },
  });

  it('green: file exists and the pattern matches', async () => {
    const fs = memFs({ 'routes.ts': "app.post('/api/projects', handler);\n" });
    const [r] = await assertSeams([route("post\\('/api/projects'")], fs);
    expect(r?.ok).toBe(true);
  });

  it('red: pattern misses — reason names file, pattern, and the route', async () => {
    const fs = memFs({ 'routes.ts': "app.get('/api/other', handler);\n" });
    const [r] = await assertSeams([route("post\\('/api/projects'")], fs);
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain('routes.ts exists but pattern');
    expect(r?.reason).toContain('POST /api/projects');
  });

  it('red: an invalid regex in the evidence is a failed assertion, not a crash', async () => {
    const fs = memFs({ 'routes.ts': 'anything' });
    const [r] = await assertSeams([route('([unclosed')], fs);
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain('not a valid regex');
  });
});

describe('generic evidence kinds (red + green each)', () => {
  const generic = (kind: string, extra: Record<string, string>, pattern?: string): Seam =>
    ({
      kind,
      id: `${kind}:probe`,
      ...extra,
      wiring_evidence: { file: 'target.txt', ...(pattern ? { pattern } : {}) },
    }) as unknown as Seam;

  const cases: Array<[string, Record<string, string>, string]> = [
    ['db-column', { table: 'events', column: 'hash' }, 'hash TEXT'],
    ['di-binding', { token: 'GatewayToken' }, 'bind\\(GatewayToken\\)'],
    ['event-topic', { topic: 'ticket.closed' }, "'ticket\\.closed'"],
    ['nav-entry', { label: 'Settings' }, '>Settings<'],
    ['config-key', { key: 'model.tier' }, '"model\\.tier"'],
    ['feature-flag', { flag: 'localOnly' }, 'localOnly:'],
  ];

  it.each(cases)('%s: green when the pattern matches', async (kind, extra, pattern) => {
    const fs = memFs({
      'target.txt':
        'hash TEXT bind(GatewayToken) \'ticket.closed\' >Settings< "model.tier" localOnly: true',
    });
    const [r] = await assertSeams([generic(kind, extra, pattern)], fs);
    expect(r?.ok).toBe(true);
  });

  it.each(cases)('%s: red when the file is missing', async (kind, extra, pattern) => {
    const [r] = await assertSeams([generic(kind, extra, pattern)], memFs({}));
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain('target.txt does not exist');
    expect(r?.reason).toContain(kind);
  });

  it('pattern-free generic evidence is an existence check only', async () => {
    const seam = generic('config-key', { key: 'model.tier' });
    expect((await assertSeams([seam], memFs({ 'target.txt': '' })))[0]?.ok).toBe(true);
    expect((await assertSeams([seam], memFs({})))[0]?.ok).toBe(false);
  });
});

describe('contract_test', () => {
  it('a wired seam still fails when its contract test path does not exist', async () => {
    const fs = memFs({ 'a.ts': 'export const x = 1;\n' });
    const seam: Seam = {
      ...exportSeam('a.ts', 'x'),
      contract_test: 'a.contract.test.ts',
    };
    const [r] = await assertSeams([seam], fs);
    expect(r?.ok).toBe(false);
    expect(r?.reason).toBe('contract test a.contract.test.ts does not exist');
  });

  it('and passes once the contract test exists', async () => {
    const fs = memFs({ 'a.ts': 'export const x = 1;\n', 'a.contract.test.ts': 'it()' });
    const seam: Seam = {
      ...exportSeam('a.ts', 'x'),
      contract_test: 'a.contract.test.ts',
    };
    expect((await assertSeams([seam], fs))[0]?.ok).toBe(true);
  });
});

describe('async injected fs', () => {
  it('accepts Promise-returning callbacks', async () => {
    const fs = {
      readFile: async () => 'export const x = 1;\n',
      fileExists: async (f: string) => f === 'a.ts',
    };
    const [r] = await assertSeams([exportSeam('a.ts', 'x')], fs);
    expect(r?.ok).toBe(true);
  });
});
