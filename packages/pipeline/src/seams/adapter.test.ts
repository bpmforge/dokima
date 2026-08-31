// adapter.test.ts — P3-02 back-compat lift: the EXISTING decompose
// InterfaceRef becomes an export-kind Seam with no edits to decompose (Law
// L4). Decompose's own tests are untouched by this ticket and keep passing.

import { describe, expect, it } from 'vitest';
import type { InterfaceRef } from '../decompose/types.js';
import { fromInterfaceRef } from './adapter.js';
import { assertSeams } from './assert.js';

const ref: InterfaceRef = { packageName: '@dokima/tickets', exportName: 'mintReceipt' };

describe('fromInterfaceRef (P3-02 back-compat lift)', () => {
  it('lifts an InterfaceRef into an export-kind Seam pointed at the owner barrel', () => {
    const seam = fromInterfaceRef(ref, 'packages/tickets');
    expect(seam).toEqual({
      kind: 'export',
      id: '@dokima/tickets#mintReceipt',
      packageName: '@dokima/tickets',
      exportName: 'mintReceipt',
      wiring_evidence: {
        file: 'packages/tickets/src/index.ts',
        exportName: 'mintReceipt',
      },
    });
  });

  it('carries provider/consumer tickets when given, for gap attribution', () => {
    const seam = fromInterfaceRef(ref, 'packages/tickets/', {
      providerTicket: 'W0-05',
      consumerTicket: 'W1-02',
    });
    expect(seam.provider_ticket).toBe('W0-05');
    expect(seam.consumer_ticket).toBe('W1-02');
    expect(seam.wiring_evidence.file).toBe('packages/tickets/src/index.ts');
  });

  it('lifted seams flow straight into assertSeams: the W1-02 class (built, never re-exported) goes RED', async () => {
    const seam = fromInterfaceRef(ref, 'packages/tickets', { consumerTicket: 'W1-02' });
    const fs = {
      // The function EXISTS in its module; the public barrel never re-exports it.
      readFile: () => "export { somethingElse } from './other.js';\n",
      fileExists: (f: string) => f === 'packages/tickets/src/index.ts',
    };
    const [r] = await assertSeams([seam], fs);
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain('packages/tickets/src/index.ts');
    expect(r?.reason).toContain('mintReceipt');
  });

  it('and goes GREEN once the barrel re-export is written', async () => {
    const seam = fromInterfaceRef(ref, 'packages/tickets');
    const fs = {
      readFile: () => "export { mintReceipt } from './receipts.js';\n",
      fileExists: () => true,
    };
    expect((await assertSeams([seam], fs))[0]?.ok).toBe(true);
  });
});
