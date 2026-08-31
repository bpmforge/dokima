// gate.test.ts — P3-05 AC4: the assembly gate's four conditions each
// independently block a release candidate. Fixture strategy: one all-green
// baseline, then four single-defect variants — each plants EXACTLY ONE
// defect so a pass would prove that condition alone was never checked.

import { describe, expect, it } from 'vitest';
import type { ExportSeam, SeamAssertion } from '../seams/index.js';
import { generateAssemblyTickets } from './assembly.js';
import { assemblyGate } from './gate.js';
import type { AssemblyGateInput } from './gate.js';
import type { RequirementLedger } from './ledger.js';
import { generateLongTailWave } from './longtail.js';

const seam: ExportSeam = {
  kind: 'export',
  id: '@dokima/tickets#mintReceipt',
  packageName: '@dokima/tickets',
  exportName: 'mintReceipt',
  provider_ticket: 'P1-01',
  consumer_ticket: 'P2-04',
  wiring_evidence: { file: 'packages/tickets/src/index.ts', exportName: 'mintReceipt' },
};

const ledger: RequirementLedger = {
  'FR-T1': {
    implementingTickets: ['P1-01'],
    provingTests: ['e2e/real/t1.test.ts'],
    status: 'done',
  },
  'US-203': {
    implementingTickets: ['P2-04'],
    provingTests: ['e2e/real/dag.test.ts'],
    status: 'done',
  },
};

const okResult: SeamAssertion = { seamId: seam.id, ok: true };

function greenInput(): AssemblyGateInput {
  const doneWave = generateLongTailWave('P9').map((t) => ({
    ...t,
    status: 'done' as const,
  }));
  return {
    ledger,
    requirementIds: ['FR-T1', 'US-203'],
    seams: [seam],
    tickets: [...generateAssemblyTickets([seam]), ...doneWave],
    seamResults: [okResult],
    testExists: (path) => path.startsWith('e2e/real/'),
  };
}

describe('assemblyGate', () => {
  it('FIXTURE all-green: passes with zero gaps', () => {
    expect(assemblyGate(greenInput())).toEqual({ pass: true, gaps: [] });
  });

  it('FIXTURE defect 1 — requirement closure: an SRS requirement no ticket covers blocks alone', () => {
    const input = { ...greenInput(), requirementIds: ['FR-T1', 'US-203', 'US-999'] };
    const { pass, gaps } = assemblyGate(input);
    expect(pass).toBe(false);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('US-999');
    expect(gaps[0]).toContain('uncovered');
  });

  it('FIXTURE defect 2 — missing assembly ticket: a cross-ticket seam with no assembly_for row blocks alone', () => {
    const green = greenInput();
    const input = {
      ...green,
      tickets: green.tickets.filter((t) => t.assembly_for === undefined),
    };
    const { pass, gaps } = assemblyGate(input);
    expect(pass).toBe(false);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('assembly_for');
    expect(gaps[0]).toContain(seam.id);
  });

  it('FIXTURE defect 3 — seam assertion failure: one not-ok seamResults entry blocks alone', () => {
    const input: AssemblyGateInput = {
      ...greenInput(),
      seamResults: [
        { seamId: seam.id, ok: false, reason: 'index.ts does not export mintReceipt' },
      ],
    };
    const { pass, gaps } = assemblyGate(input);
    expect(pass).toBe(false);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('does not export mintReceipt');
  });

  it('FIXTURE defect 4 — long-tail wave open: one long_tail ticket not done blocks alone (and a wave-less board blocks too)', () => {
    const green = greenInput();
    const reopened = green.tickets.map((t) =>
      t.id === 'P9-LT-03' ? { ...t, status: 'in-progress' as const } : t,
    );
    const open = assemblyGate({ ...green, tickets: reopened });
    expect(open.pass).toBe(false);
    expect(open.gaps).toHaveLength(1);
    expect(open.gaps[0]).toContain('P9-LT-03');

    const waveless = assemblyGate({
      ...green,
      tickets: green.tickets.filter((t) => t.long_tail !== true),
    });
    expect(waveless.pass).toBe(false);
    expect(waveless.gaps).toHaveLength(1);
    expect(waveless.gaps[0]).toContain('long_tail');
  });

  it('a coded-not-done requirement (test path listed but not on head) blocks', () => {
    const input = { ...greenInput(), testExists: () => false };
    const { pass, gaps } = assemblyGate(input);
    expect(pass).toBe(false);
    expect(gaps.some((g) => g.includes('coded-not-done'))).toBe(true);
  });

  it('multiple defects report every gap, not just the first', () => {
    const green = greenInput();
    const input: AssemblyGateInput = {
      ...green,
      requirementIds: [...green.requirementIds, 'US-999'],
      seamResults: [{ seamId: seam.id, ok: false, reason: 'missing' }],
    };
    expect(assemblyGate(input).gaps).toHaveLength(2);
  });
});
