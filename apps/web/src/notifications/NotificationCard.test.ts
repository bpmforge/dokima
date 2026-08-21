import { describe, expect, it } from 'vitest';
import { formatTimestamp, reviewSkipExplainer, summaryLine } from './NotificationCard.js';
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

  it('renders diffStat for a freeform-body card, labeled so a bare count reads as a sentence (W10-28)', () => {
    expect(summaryLine(item({ kind: 'pr_ready', body: { diffStat: '+10 -2' } }))).toBe(
      'Diff: +10 -2',
    );
  });

  it('is empty for a card with no recognizable body shape', () => {
    expect(summaryLine(item({ kind: 'clarification', body: null }))).toBe('');
  });
});

describe('formatTimestamp (W10-28)', () => {
  const iso = '2026-08-03T04:44:07.000Z';

  it('is not the raw ISO string', () => {
    expect(formatTimestamp(iso)).not.toBe(iso);
    expect(formatTimestamp(iso)).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('drops seconds — a per-second-precision timestamp is noise no reader needs', () => {
    expect(formatTimestamp(iso)).not.toMatch(/:\d{2}:\d{2}\s/);
  });

  it('is deterministic for a given instant (no clock/random dependency)', () => {
    expect(formatTimestamp(iso)).toBe(formatTimestamp(iso));
  });
});

describe('the same-model review skip explains itself (W17-11)', () => {
  const base = {
    id: 'n1',
    tier: 'review',
    kind: 'digest',
    refType: null,
    refId: null,
    leverage: 1,
    status: 'pending',
    pushedAt: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    resolvedAt: null,
    projectId: 'p1',
    projectName: 'Recipe Keeper',
  } as const;

  it('RED FIXTURE: a card carrying the C-4 refusal marker explains the skip and the fix — detected from the refusal text, never a hardcoded ticket', () => {
    const item = {
      ...base,
      title: 'Review: PLAN-T-002',
      body: {
        items: [
          {
            title: 'PLAN-T-002',
            summary:
              "Machine review refused: the reviewer would be a model that made work this run (qwen), and a maker's model never reviews its own work (C-4).",
          },
        ],
      },
    } as never;
    const why = reviewSkipExplainer(item);
    expect(why).not.toBeNull();
    expect(why).toContain('reviewing its own work');
    expect(why).toContain('Settings → Models');
    expect(why).toContain('guarantee working, not a fault');
  });

  it('an ordinary review card gets NO explainer — the sentence only appears when the refusal did', () => {
    const item = {
      ...base,
      title: 'Review: PLAN-T-001',
      body: { items: [{ title: 'PLAN-T-001', summary: 'CONFIRMED, score 8.' }] },
    } as never;
    expect(reviewSkipExplainer(item)).toBeNull();
  });
});
