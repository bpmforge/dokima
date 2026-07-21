import { describe, expect, it } from 'vitest';
import { classifyTraceEvent, passNumber } from './classify.js';

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
