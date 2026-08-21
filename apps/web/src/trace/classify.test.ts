import { describe, expect, it } from 'vitest';
import { classifyTraceEvent, describeTraceEvent, passNumber } from './classify.js';

describe('classifyTraceEvent', () => {
  it('classifies known real event-type prefixes', () => {
    expect(classifyTraceEvent('ticket.claimed')).toBe('lifecycle');
    expect(classifyTraceEvent('gate.receipt_minted')).toBe('gate');
    expect(classifyTraceEvent('gate.waived')).toBe('gate');
    expect(classifyTraceEvent('escalation.rung_advanced')).toBe('escalation');
  });

  it('classifies the fixture-only pass/tool-call event types', () => {
    expect(classifyTraceEvent('loop.pass')).toBe('pass');
    expect(classifyTraceEvent('gateway.call_completed')).toBe('tool_call');
  });

  it('falls back to "other" for anything unrecognized rather than guessing', () => {
    expect(classifyTraceEvent('decision.chosen')).toBe('other');
    expect(classifyTraceEvent('something.unheard_of')).toBe('other');
  });
});

describe('passNumber', () => {
  it('reads a numeric pass field from the payload', () => {
    expect(passNumber({ pass: 3 })).toBe(3);
  });

  it('returns null when absent or malformed', () => {
    expect(passNumber(null)).toBeNull();
    expect(passNumber(undefined)).toBeNull();
    expect(passNumber('not an object')).toBeNull();
    expect(passNumber({ pass: 'three' })).toBeNull();
  });
});

/**
 * W16-08: every event kind the W16 loops emit carries a plain-language
 * sentence — before this they fell into the generic "Event" bucket.
 */
describe('W16 event kinds speak human (W16-08)', () => {
  const W16_EVENT_KINDS = [
    'playbook.r0_hit',
    'playbook.r0_miss',
    'forge.issue_mapped',
    'forge.mirror_written',
    'forge.mirror_queued',
    'forge.mirror_flushed',
    'berths.ticket_admitted',
    'memory.consolidated',
    'memory.hook_failed',
    'session.infra_retry',
    'sandbox.waived',
  ];

  it('RED FIXTURE: none of the W16 kinds falls through to a generic bucket label', () => {
    const genericLabels = new Set(['Event', 'Gate', 'Escalation', 'Model call', 'Ticket']);
    for (const kind of W16_EVENT_KINDS) {
      const sentence = describeTraceEvent(kind);
      expect(genericLabels.has(sentence), `${kind} -> "${sentence}"`).toBe(false);
      expect(sentence.split(' ').length).toBeGreaterThan(2);
    }
  });

  it('pins the copy that defines what a queued forge write means for the person', () => {
    expect(describeTraceEvent('forge.mirror_queued')).toContain('queued to send later');
    expect(describeTraceEvent('playbook.r0_hit')).toContain('verified answer');
  });
});
