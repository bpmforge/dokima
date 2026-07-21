import { describe, expect, it } from 'vitest';
import { insertFact, markFactVerified } from '../store/facts.js';
import { consultPlaybook } from './consult.js';
import { createInMemoryPlaybookConsultSink } from './events.js';
import { insertPlaybookEntry } from './playbook.js';
import { createTestHandle } from './test-helpers.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('consultPlaybook', () => {
  it('a playbook hit answers outright and emits exactly one r0_hit event', () => {
    const handle = createTestHandle();
    const entry = insertPlaybookEntry(
      handle,
      {
        taskClass: 'the thing works',
        entry: 'known fix: restart the daemon',
        verifiedBy: 'tool',
      },
      NOW,
    );
    const sink = createInMemoryPlaybookConsultSink();

    const result = consultPlaybook(
      handle,
      { ticketId: 't-1', criterion: 'The Thing Works' },
      { sink, now: NOW },
    );

    expect(result).toEqual({
      answered: true,
      findingId: `playbook:${entry.id}`,
      summary: 'known fix: restart the daemon',
    });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      type: 'playbook.r0_hit',
      source: 'playbook',
      ticketId: 't-1',
    });
  });

  it('falls back to a verified fact-bank hit scoped to the ticket when the playbook has no entry', () => {
    const handle = createTestHandle();
    const fact = insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'ENOENT on cold start -> mkdir -p the target dir first',
        confidence: 0.9,
        ticketId: 't-2',
      },
      NOW,
    );
    markFactVerified(handle, fact.id);
    const sink = createInMemoryPlaybookConsultSink();

    const result = consultPlaybook(
      handle,
      { ticketId: 't-2', criterion: 'ENOENT cold start' },
      { sink, now: NOW },
    );

    expect(result.answered).toBe(true);
    expect(result.findingId).toBe(`fact:${fact.id}`);
    expect(sink.events[0]).toMatchObject({ type: 'playbook.r0_hit', source: 'fact' });
  });

  it('is an honest miss when neither source has a confirmed answer, and emits exactly one r0_miss event', () => {
    const handle = createTestHandle();
    const sink = createInMemoryPlaybookConsultSink();

    const result = consultPlaybook(
      handle,
      { ticketId: 't-3', criterion: 'a task never seen before' },
      { sink, now: NOW },
    );

    expect(result).toEqual({ answered: false });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({ type: 'playbook.r0_miss', ticketId: 't-3' });
  });

  it('never treats an unverified fact as an answer', () => {
    const handle = createTestHandle();
    insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'unverified guess, never confirmed',
        confidence: 0.5,
        ticketId: 't-4',
      },
      NOW,
    );

    const result = consultPlaybook(handle, {
      ticketId: 't-4',
      criterion: 'unverified guess',
    });
    expect(result.answered).toBe(false);
  });

  it("a fact scoped to a different ticket never answers this ticket's consult", () => {
    const handle = createTestHandle();
    const fact = insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'shared-sounding fix text',
        confidence: 0.9,
        ticketId: 'other-ticket',
      },
      NOW,
    );
    markFactVerified(handle, fact.id);

    const result = consultPlaybook(handle, {
      ticketId: 'this-ticket',
      criterion: 'shared-sounding fix text',
    });
    expect(result.answered).toBe(false);
  });

  it('FR-F5: a promoted global entry answers when the local playbook has no entry for it', () => {
    const handle = createTestHandle(); // empty local playbook — this project never authored the lesson
    const sink = createInMemoryPlaybookConsultSink();

    const result = consultPlaybook(
      handle,
      { ticketId: 't-5', criterion: 'flaky timeout fix' },
      {
        sink,
        now: NOW,
        globalEntries: [
          { id: 42, taskClass: 'flaky timeout fix', entry: 'retry with backoff' },
        ],
      },
    );

    expect(result).toEqual({
      answered: true,
      findingId: 'global-playbook:42',
      summary: 'retry with backoff',
    });
    expect(sink.events[0]).toMatchObject({ type: 'playbook.r0_hit', source: 'global' });
  });

  it('FR-F5: an unpromoted lesson stays invisible — no globalEntries means a miss, not a fabricated hit', () => {
    const handle = createTestHandle();
    const result = consultPlaybook(handle, {
      ticketId: 't-6',
      criterion: 'a lesson from another project, never promoted here',
    });
    expect(result.answered).toBe(false);
  });

  it('FR-F5: a retired global entry never answers (superseded, not the live head)', () => {
    const handle = createTestHandle();
    const result = consultPlaybook(
      handle,
      { ticketId: 't-7', criterion: 'flaky timeout fix' },
      {
        globalEntries: [
          {
            id: 1,
            taskClass: 'flaky timeout fix',
            entry: 'stale v1',
            retiredAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
    );
    expect(result.answered).toBe(false);
  });
});
