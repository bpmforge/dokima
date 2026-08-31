// assembly.test.ts — P3-05 AC2: every cross-ticket seam needs an
// assembly_for ticket citing its wiring evidence; generator emits
// board-shaped rows.

import { describe, expect, it } from 'vitest';
import type { ExportSeam, RouteSeam, Seam } from '../seams/index.js';
import {
  generateAssemblyTickets,
  missingAssemblyTickets,
  seamCrossesTickets,
  wiringEvidenceStatement,
} from './assembly.js';
import type { BoardTicketRow } from './types.js';

const crossSeam: ExportSeam = {
  kind: 'export',
  id: '@dokima/tickets#mintReceipt',
  packageName: '@dokima/tickets',
  exportName: 'mintReceipt',
  provider_ticket: 'P1-01',
  consumer_ticket: 'P2-04',
  wiring_evidence: { file: 'packages/tickets/src/index.ts', exportName: 'mintReceipt' },
};

const sameTicketSeam: RouteSeam = {
  kind: 'route',
  id: 'route:POST /api/projects',
  method: 'POST',
  path: '/api/projects',
  provider_ticket: 'P1-02',
  consumer_ticket: 'P1-02',
  wiring_evidence: { file: 'apps/server/src/routes.ts', pattern: 'POST.+/api/projects' },
};

const unownedSeam: Seam = {
  kind: 'config-key',
  id: 'config:PORT',
  key: 'PORT',
  wiring_evidence: { file: 'apps/server/src/config.ts' },
};

function ticket(overrides: Partial<BoardTicketRow>): BoardTicketRow {
  return {
    id: 'T-1',
    title: 't',
    lane: 'assembly',
    write_scope: [],
    acceptance: [],
    points: 1,
    status: 'todo',
    ...overrides,
  };
}

describe('seamCrossesTickets', () => {
  it('is true only when provider and consumer tickets are both known and differ', () => {
    expect(seamCrossesTickets(crossSeam)).toBe(true);
    expect(seamCrossesTickets(sameTicketSeam)).toBe(false);
    expect(seamCrossesTickets(unownedSeam)).toBe(false);
  });
});

describe('missingAssemblyTickets', () => {
  it('RED: a board with no assembly ticket for a cross-ticket seam reports that seam', () => {
    const missing = missingAssemblyTickets([crossSeam, sameTicketSeam], [ticket({})]);
    expect(missing.map((s) => s.id)).toEqual([crossSeam.id]);
  });

  it('an assembly_for ticket whose acceptance cites the wiring-evidence file satisfies the seam', () => {
    const asm = ticket({
      id: 'ASM-x',
      assembly_for: crossSeam.id,
      acceptance: [wiringEvidenceStatement(crossSeam)],
    });
    expect(missingAssemblyTickets([crossSeam], [asm])).toEqual([]);
  });

  it('an assembly_for label whose acceptance never mentions the evidence file does NOT satisfy the seam', () => {
    const label = ticket({
      id: 'ASM-x',
      assembly_for: crossSeam.id,
      acceptance: ['wired, trust me'],
    });
    expect(missingAssemblyTickets([crossSeam], [label]).map((s) => s.id)).toEqual([
      crossSeam.id,
    ]);
  });

  it('a ticket for a DIFFERENT seam does not satisfy this one', () => {
    const other = ticket({
      id: 'ASM-y',
      assembly_for: 'some-other-seam',
      acceptance: [wiringEvidenceStatement(crossSeam)],
    });
    expect(missingAssemblyTickets([crossSeam], [other])).toHaveLength(1);
  });
});

describe('generateAssemblyTickets', () => {
  it('emits a board-shaped row per cross-ticket seam only', () => {
    const rows = generateAssemblyTickets([crossSeam, sameTicketSeam, unownedSeam]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: `ASM-${crossSeam.id}`,
      lane: 'assembly',
      write_scope: ['packages/tickets/src/index.ts'],
      points: 1,
      status: 'todo',
      assembly_for: crossSeam.id,
    });
    expect(row?.acceptance).toEqual([wiringEvidenceStatement(crossSeam)]);
    expect(row?.title).toContain('P1-01');
    expect(row?.title).toContain('P2-04');
  });

  it('generated rows satisfy missingAssemblyTickets (generator and checker agree)', () => {
    const rows = generateAssemblyTickets([crossSeam]);
    expect(missingAssemblyTickets([crossSeam], rows)).toEqual([]);
  });

  it('a seam with a contract_test gets 2 points and the test in scope + acceptance', () => {
    const withTest: Seam = {
      ...crossSeam,
      contract_test: 'packages/tickets/src/mint.contract.test.ts',
    };
    const row = generateAssemblyTickets([withTest], { lane: 'wiring' })[0];
    expect(row).toMatchObject({ points: 2, lane: 'wiring' });
    expect(row?.write_scope).toContain('packages/tickets/src/mint.contract.test.ts');
    expect(row?.acceptance.some((a) => a.includes('mint.contract.test.ts'))).toBe(true);
  });
});

describe('wiringEvidenceStatement', () => {
  it('names the export for export seams, the pattern for pattern evidence, existence otherwise', () => {
    expect(wiringEvidenceStatement(crossSeam)).toContain('exports mintReceipt');
    expect(wiringEvidenceStatement(sameTicketSeam)).toContain('POST.+/api/projects');
    expect(wiringEvidenceStatement(unownedSeam)).toBe(
      'apps/server/src/config.ts exists (seam config:PORT)',
    );
  });
});
