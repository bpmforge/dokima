/**
 * W20-03: the diary is the receipts wearing a face — it filters and phrases,
 * it never summarises or infers. The fixtures pin the two ways a diary could
 * lie: attributing another member's work, and quietly dropping an event whose
 * kind nobody has humanised yet.
 */
import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../board/drawer/types.js';
import { buildWorkDiary } from './diary.js';

const ev = (over: Partial<TraceEvent> & { seq: number }): TraceEvent => ({
  event_type: 'ticket.claimed',
  actor_id: 'coding-agent',
  ticket_id: 'T-1',
  run_id: 'r1',
  payload: null,
  created_at: '2026-08-24T14:02:00.000Z',
  ...over,
});

describe('buildWorkDiary (W20-03)', () => {
  it("RED FIXTURE: only THIS member's events appear — a diary that borrowed a peer's work would credit the wrong person", () => {
    const { entries, total } = buildWorkDiary(
      [
        ev({ seq: 1 }),
        ev({ seq: 2, actor_id: 'challenger' }),
        ev({ seq: 3, actor_id: 'berth-2:coding-agent' }),
      ],
      'coding-agent',
    );
    expect(total).toBe(2);
    expect(entries.map((e) => e.seq)).toEqual([3, 1]); // newest first, scoped id matched
    expect(entries.every((e) => e.line.length > 0)).toBe(true);
  });

  it('an un-humanised event kind still renders — a diary that hid what it cannot phrase would lie by omission', () => {
    const { entries } = buildWorkDiary(
      [ev({ seq: 9, event_type: 'some.brand.new.kind' })],
      'coding-agent',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.line.length).toBeGreaterThan(0);
    // the raw type travels with the line so a reader can check the phrasing
    expect(entries[0]!.eventType).toBe('some.brand.new.kind');
  });

  it('surfaces a receipt id when the event minted one, and null when it did not', () => {
    const { entries } = buildWorkDiary(
      [
        ev({ seq: 5, event_type: 'phase.advanced', payload: { gate_receipt_id: 'r-8f2c' } }),
        ev({ seq: 4 }),
      ],
      'coding-agent',
    );
    expect(entries[0]!.receiptId).toBe('r-8f2c');
    expect(entries[1]!.receiptId).toBeNull();
  });

  it('limit caps what is RENDERED but never what is counted — a trimmed view must not read as the whole story', () => {
    const events = Array.from({ length: 30 }, (_, i) => ev({ seq: i + 1 }));
    const { entries, total } = buildWorkDiary(events, 'coding-agent', 5);
    expect(entries).toHaveLength(5);
    expect(total).toBe(30);
    expect(entries[0]!.seq).toBe(30);
  });

  it('a member with no events gets an empty diary, not a fabricated one', () => {
    const { entries, total } = buildWorkDiary([ev({ seq: 1 })], 'release-manager');
    expect(entries).toEqual([]);
    expect(total).toBe(0);
  });
});
