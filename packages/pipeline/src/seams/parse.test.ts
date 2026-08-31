// parse.test.ts — P3-02 union parsing: every kind parses; malformed rows
// become named errors beside the good rows, never a throw (the W10-65 stance).

import { describe, expect, it } from 'vitest';
import { parseSeams, SEAM_KINDS } from './parse.js';

const base = { provider_ticket: 'P3-01', consumer_ticket: 'P3-05' };

const oneOfEach = [
  {
    ...base,
    kind: 'export',
    id: '@dokima/tickets#mintReceipt',
    packageName: '@dokima/tickets',
    exportName: 'mintReceipt',
    wiring_evidence: { file: 'packages/tickets/src/index.ts', exportName: 'mintReceipt' },
  },
  {
    ...base,
    kind: 'route',
    id: 'route:POST /api/projects',
    method: 'POST',
    path: '/api/projects',
    wiring_evidence: {
      file: 'apps/server/src/routes.ts',
      pattern: 'POST.+/api/projects',
    },
  },
  {
    ...base,
    kind: 'db-column',
    id: 'db:events.hash',
    table: 'events',
    column: 'hash',
    wiring_evidence: { file: 'apps/server/src/db/schema.sql', pattern: '\\bhash\\b' },
  },
  {
    ...base,
    kind: 'di-binding',
    id: 'di:GatewayToken',
    token: 'GatewayToken',
    wiring_evidence: { file: 'apps/server/src/container.ts', pattern: 'GatewayToken' },
  },
  {
    ...base,
    kind: 'event-topic',
    id: 'evt:ticket.closed',
    topic: 'ticket.closed',
    wiring_evidence: {
      file: 'packages/events/src/topics.ts',
      pattern: 'ticket\\.closed',
    },
  },
  {
    ...base,
    kind: 'nav-entry',
    id: 'nav:Settings',
    label: 'Settings',
    wiring_evidence: { file: 'apps/web/src/nav.tsx', pattern: 'Settings' },
  },
  {
    ...base,
    kind: 'config-key',
    id: 'cfg:model.tier',
    key: 'model.tier',
    wiring_evidence: { file: 'conductor.config.json' },
  },
  {
    ...base,
    kind: 'feature-flag',
    id: 'flag:localOnly',
    flag: 'localOnly',
    wiring_evidence: { file: 'packages/shared/src/flags.ts', pattern: 'localOnly' },
    contract_test: 'packages/shared/src/flags.test.ts',
  },
];

describe('parseSeams (P3-02 union parsing)', () => {
  it('parses one seam of every kind in the union', () => {
    const { seams, errors } = parseSeams(oneOfEach);
    expect(errors).toEqual([]);
    expect(seams.map((s) => s.kind)).toEqual([...SEAM_KINDS]);
    expect(seams.every((s) => s.consumer_ticket === 'P3-05')).toBe(true);
  });

  it('rejects an unknown kind with a named error, keeping the good rows', () => {
    const { seams, errors } = parseSeams([
      oneOfEach[0],
      { id: 'x', kind: 'telepathy', wiring_evidence: { file: 'a.ts' } },
    ]);
    expect(seams).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('seam[1] (id x)');
    expect(errors[0]).toContain('unknown kind "telepathy"');
  });

  it('rejects kind-specific identity gaps and evidence gaps', () => {
    const { errors } = parseSeams([
      {
        id: 'r1',
        kind: 'route',
        method: 'GET',
        wiring_evidence: { file: 'a', pattern: 'x' },
      },
      {
        id: 'r2',
        kind: 'route',
        method: 'GET',
        path: '/x',
        wiring_evidence: { file: 'a' },
      },
      { id: 'e1', kind: 'export', packageName: 'p', exportName: 'x' },
      {
        id: 'e2',
        kind: 'export',
        packageName: 'p',
        exportName: 'x',
        wiring_evidence: { file: 'f' },
      },
    ]);
    expect(errors).toEqual([
      'seam[0] (id r1): route seam missing path',
      'seam[1] (id r2): route wiring_evidence missing pattern',
      'seam[2] (id e1): missing wiring_evidence',
      'seam[3] (id e2): export wiring_evidence missing exportName',
    ]);
  });

  it('rejects non-array input and non-object rows without throwing', () => {
    expect(parseSeams('nope').errors).toEqual(['seams input is not an array']);
    expect(parseSeams([null]).errors).toEqual(['seam[0]: not an object']);
    expect(parseSeams([{ kind: 'export' }]).errors).toEqual(['seam[0]: missing id']);
  });
});
