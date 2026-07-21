import { describe, expect, it } from 'vitest';
import { draftFromEscalationEvent, draftFromTraceEvent } from './prefill.js';

describe('draftFromTraceEvent', () => {
  it('prefills ticket/source/evidence from a session-trace event, leaving expected blank for the filer', () => {
    const draft = draftFromTraceEvent({
      seq: 5,
      eventType: 'gate.failed',
      actorId: 'agent-1',
      ticketId: 'W1-01',
      runId: 'run-42',
      createdAt: '2026-07-20T09:00:00.000Z',
    });

    expect(draft.ticketId).toBe('W1-01');
    expect(draft.source).toBe('trace');
    expect(draft.sourceRef).toBe('trace:run-42:5');
    expect(draft.whatHappened).toContain('gate.failed');
    expect(draft.whatHappened).toContain('agent-1');
    expect(draft.expected).toBe('');
    expect(draft.evidenceLinks).toEqual(['run:run-42']);
  });

  it('is honest about a missing runId — no fabricated evidence link', () => {
    const draft = draftFromTraceEvent({
      seq: 1,
      eventType: 'x',
      actorId: 'a',
      ticketId: null,
      runId: null,
      createdAt: '2026-07-20T09:00:00.000Z',
    });
    expect(draft.evidenceLinks).toEqual([]);
    expect(draft.sourceRef).toBe('trace:unknown:1');
  });
});

describe('draftFromEscalationEvent', () => {
  it('prefills from an escalation event including the rung transition and receipt', () => {
    const draft = draftFromEscalationEvent({
      type: 'escalation.rung_advanced',
      ticketId: 'W1-01',
      fromRung: 'R1',
      toRung: 'R2',
      actorId: 'harbormaster',
      receiptId: 'receipt-9',
      occurredAt: '2026-07-20T09:05:00.000Z',
    });

    expect(draft.ticketId).toBe('W1-01');
    expect(draft.source).toBe('escalation');
    expect(draft.sourceRef).toBe('escalation:W1-01:2026-07-20T09:05:00.000Z');
    expect(draft.whatHappened).toContain('R1 -> R2');
    expect(draft.evidenceLinks).toEqual(['receipt:receipt-9']);
  });

  it('omits the rung note and evidence link when absent', () => {
    const draft = draftFromEscalationEvent({
      type: 'escalation.blocked',
      ticketId: 'W1-01',
      actorId: 'harbormaster',
      occurredAt: '2026-07-20T09:05:00.000Z',
    });
    expect(draft.whatHappened).not.toContain('->');
    expect(draft.evidenceLinks).toEqual([]);
  });
});
