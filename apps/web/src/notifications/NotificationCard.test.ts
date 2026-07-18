import { describe, expect, it } from 'vitest';
import { summaryLine } from './NotificationCard.js';
import type { NotificationItem } from './types.js';

function item(overrides: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'n-1',
    tier: 'decide',
    kind: 'approval',
    refType: null,
    refId: null,
    title: 'x',
    body: null,
    leverage: 30,
    status: 'open',
    pushedAt: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    resolvedAt: null,
    projectId: 'p-1',
    projectName: 'Proj',
    ...overrides,
  };
}

describe('summaryLine', () => {
  it('counts batched items for a digest', () => {
    expect(
      summaryLine(
        item({ kind: 'digest', body: { items: [{ title: 'a' }, { title: 'b' }] } }),
      ),
    ).toBe('2 items batched');
  });

  it('singularizes a one-item digest', () => {
    expect(summaryLine(item({ kind: 'digest', body: { items: [{ title: 'a' }] } }))).toBe(
      '1 item batched',
    );
  });

  it('renders the trust-graduation message for a suggestion card', () => {
    expect(
      summaryLine(item({ kind: 'suggestion', body: { message: 'Berths 2 is earned.' } })),
    ).toBe('Berths 2 is earned.');
  });

  it('renders diffStat for a freeform-body card', () => {
    expect(summaryLine(item({ kind: 'pr_ready', body: { diffStat: '+10 -2' } }))).toBe(
      '+10 -2',
    );
  });

  it('is empty for a card with no recognizable body shape', () => {
    expect(summaryLine(item({ kind: 'clarification', body: null }))).toBe('');
  });
});
