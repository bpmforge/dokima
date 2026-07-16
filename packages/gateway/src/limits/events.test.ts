import { describe, expect, it } from 'vitest';
import { createInMemoryLimitEventSink, noopLimitEventSink } from './events.js';
import type { LimitPauseEvent, LimitResumeEvent } from './events.js';

describe('limit event sink', () => {
  it('noopLimitEventSink accepts events without recording them', () => {
    expect(() => noopLimitEventSink.emit(pauseEvent())).not.toThrow();
  });

  it('createInMemoryLimitEventSink records emitted events in order', () => {
    const sink = createInMemoryLimitEventSink();
    const pause = pauseEvent();
    const resume = resumeEvent();
    sink.emit(pause);
    sink.emit(resume);
    expect(sink.events).toEqual([pause, resume]);
  });

  it('every LimitEvent is tier "record" by construction — a limit pause never carries a Decide-tier card', () => {
    const pause = pauseEvent();
    const resume = resumeEvent();
    expect(pause.tier).toBe('record');
    expect(resume.tier).toBe('record');
  });

  it('event types are distinct from budget breaker event types', () => {
    const pause = pauseEvent();
    const resume = resumeEvent();
    expect(['limit.pause', 'limit.resume']).toContain(pause.type);
    expect(['limit.pause', 'limit.resume']).toContain(resume.type);
    expect(pause.type).not.toMatch(/^budget\./);
    expect(resume.type).not.toMatch(/^budget\./);
  });
});

function pauseEvent(): LimitPauseEvent {
  return {
    type: 'limit.pause',
    tier: 'record',
    projectId: 'proj-1',
    runId: 'run-1',
    berthId: 'berth-1',
    providerId: 'anthropic',
    pausedAt: '2026-07-12T12:00:00.000Z',
    resumeAt: '2026-07-12T22:12:00.000Z',
    resumeSource: 'stated',
    attempt: 1,
  };
}

function resumeEvent(): LimitResumeEvent {
  return {
    type: 'limit.resume',
    tier: 'record',
    projectId: 'proj-1',
    runId: 'run-1',
    berthId: 'berth-1',
    providerId: 'anthropic',
    pausedAt: '2026-07-12T12:00:00.000Z',
    resumedAt: '2026-07-12T22:12:00.000Z',
  };
}
