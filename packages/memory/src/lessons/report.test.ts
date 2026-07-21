import { describe, expect, it } from 'vitest';
import { createInMemoryLessonsEventSink } from './events.js';
import {
  fileFieldReport,
  getFieldReport,
  IncompleteFieldReportError,
  listFieldReports,
} from './report.js';
import { createTestHandle } from './test-helpers.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('fileFieldReport', () => {
  it('stores an untriaged report and emits lessons.filed', () => {
    const handle = createTestHandle();
    const sink = createInMemoryLessonsEventSink();

    const report = fileFieldReport(
      handle,
      {
        ticketId: 'W1-01',
        source: 'trace',
        sourceRef: 'trace:run-1:5',
        whatHappened: 'The gate passed on a spoofed receipt.',
        expected: 'The gate should have refused the spoofed input.',
        evidenceLinks: ['run:run-1'],
        filedBy: 'human-brad',
      },
      NOW,
      { sink },
    );

    expect(report.status).toBe('pending');
    expect(report.filedBy).toBe('human-brad');
    expect(report.evidenceLinks).toEqual(['run:run-1']);
    expect(report.triagedBy).toBeNull();
    expect(report.resultingPlaybookEntryId).toBeNull();
    expect(report.resultingTicketId).toBeNull();
    expect(sink.events).toEqual([
      {
        type: 'lessons.filed',
        reportId: report.id,
        actorId: 'human-brad',
        occurredAt: NOW(),
      },
    ]);
    expect(getFieldReport(handle, report.id)).toEqual(report);
  });

  it('defaults evidenceLinks to an empty array when omitted', () => {
    const handle = createTestHandle();
    const report = fileFieldReport(
      handle,
      {
        source: 'manual',
        whatHappened: 'x',
        expected: 'y',
        filedBy: 'human-brad',
      },
      NOW,
    );
    expect(report.evidenceLinks).toEqual([]);
    expect(report.ticketId).toBeNull();
    expect(report.sourceRef).toBeNull();
  });

  it.each([
    [
      'whatHappened',
      { whatHappened: '  ', expected: 'y', filedBy: 'f', source: 'manual' as const },
    ],
    [
      'expected',
      { whatHappened: 'x', expected: '', filedBy: 'f', source: 'manual' as const },
    ],
    [
      'filedBy',
      { whatHappened: 'x', expected: 'y', filedBy: '', source: 'manual' as const },
    ],
  ])('rejects a blank %s', (_field, input) => {
    const handle = createTestHandle();
    expect(() => fileFieldReport(handle, input, NOW)).toThrow(IncompleteFieldReportError);
  });
});

describe('listFieldReports', () => {
  it('lists newest-first, optionally scoped to a status', () => {
    const handle = createTestHandle();
    const a = fileFieldReport(
      handle,
      { source: 'manual', whatHappened: 'a', expected: 'a', filedBy: 'f1' },
      () => '2026-07-20T10:00:00.000Z',
    );
    const b = fileFieldReport(
      handle,
      { source: 'manual', whatHappened: 'b', expected: 'b', filedBy: 'f1' },
      () => '2026-07-20T11:00:00.000Z',
    );

    expect(listFieldReports(handle).map((r) => r.id)).toEqual([b.id, a.id]);
    expect(listFieldReports(handle, { status: 'pending' }).map((r) => r.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(listFieldReports(handle, { status: 'rejected' })).toEqual([]);
  });
});
