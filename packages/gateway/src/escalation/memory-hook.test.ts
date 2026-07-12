import { describe, expect, it } from 'vitest';
import { noopMemoryConsultHook } from './memory-hook.js';

describe('noopMemoryConsultHook', () => {
  it('always honestly reports no answer rather than fabricating one', async () => {
    const result = await noopMemoryConsultHook.consult({
      ticketId: 't-1',
      criterion: 'anything',
    });
    expect(result).toEqual({ answered: false });
  });
});
