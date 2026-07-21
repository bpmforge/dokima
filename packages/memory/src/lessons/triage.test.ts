import { describe, expect, it } from 'vitest';
import { getPlaybookHead } from '../playbook/playbook.js';
import { createInMemoryLessonsEventSink } from './events.js';
import { fileFieldReport, getFieldReport } from './report.js';
import { createTestHandle } from './test-helpers.js';
import {
  FieldReportAlreadyTriagedError,
  FieldReportNotFoundError,
  prepareValidatorFixTicket,
  rejectFieldReport,
  SelfTriageError,
  triageToPlaybookEntry,
} from './triage.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

function fileReport(handle: ReturnType<typeof createTestHandle>, filedBy = 'human-brad') {
  return fileFieldReport(
    handle,
    {
      ticketId: 'W1-01',
      source: 'manual',
      whatHappened: 'The gate accepted a spoofed receipt.',
      expected: 'The gate should refuse spoofed receipts.',
      filedBy,
    },
    NOW,
  );
}

describe('triageToPlaybookEntry', () => {
  it('inserts a challenger-confirmed playbook entry and marks the report accepted_playbook', () => {
    const handle = createTestHandle();
    const sink = createInMemoryLessonsEventSink();
    const report = fileReport(handle);

    const { report: triaged, playbookEntry } = triageToPlaybookEntry(
      handle,
      {
        reportId: report.id,
        triagedBy: 'challenger-1',
        taskClass: 'spoofed receipt gate bypass',
        entry: 'Verify receipt signature before accepting a gate pass.',
        triageNote: 'Confirmed real gap, playbook-worthy.',
      },
      NOW,
      { sink },
    );

    expect(playbookEntry.verifiedBy).toBe('challenger');
    expect(getPlaybookHead(handle, 'spoofed receipt gate bypass')).toMatchObject({
      id: playbookEntry.id,
      verifiedBy: 'challenger',
    });
    expect(triaged.status).toBe('accepted_playbook');
    expect(triaged.triagedBy).toBe('challenger-1');
    expect(triaged.resultingPlaybookEntryId).toBe(playbookEntry.id);
    expect(sink.events).toEqual([
      {
        type: 'lessons.triaged',
        reportId: report.id,
        actorId: 'challenger-1',
        outcome: 'accepted_playbook',
        occurredAt: NOW(),
      },
    ]);
  });

  it('refuses to let the filer triage their own report — self-triage confirms nothing (Law 5)', () => {
    const handle = createTestHandle();
    const report = fileReport(handle, 'human-brad');

    expect(() =>
      triageToPlaybookEntry(
        handle,
        {
          reportId: report.id,
          triagedBy: 'human-brad',
          taskClass: 'x',
          entry: 'y',
        },
        NOW,
      ),
    ).toThrow(SelfTriageError);
  });

  it('refuses to triage a report a second time', () => {
    const handle = createTestHandle();
    const report = fileReport(handle);
    triageToPlaybookEntry(
      handle,
      { reportId: report.id, triagedBy: 'challenger-1', taskClass: 'x', entry: 'y' },
      NOW,
    );

    expect(() =>
      triageToPlaybookEntry(
        handle,
        { reportId: report.id, triagedBy: 'challenger-2', taskClass: 'x', entry: 'z' },
        NOW,
      ),
    ).toThrow(FieldReportAlreadyTriagedError);
  });

  it('refuses an unknown report id', () => {
    const handle = createTestHandle();
    expect(() =>
      triageToPlaybookEntry(
        handle,
        { reportId: 9999, triagedBy: 'challenger-1', taskClass: 'x', entry: 'y' },
        NOW,
      ),
    ).toThrow(FieldReportNotFoundError);
  });
});

describe('prepareValidatorFixTicket', () => {
  it('marks the report accepted_ticket and prepares a bug-ticket payload without creating a ticket', () => {
    const handle = createTestHandle();
    const sink = createInMemoryLessonsEventSink();
    const report = fileReport(handle);

    const { report: triaged, payload } = prepareValidatorFixTicket(
      handle,
      {
        reportId: report.id,
        triagedBy: 'challenger-1',
        ticketId: 'W9-01',
        title: 'Gate accepts spoofed receipt',
        lane: 'core',
        writeScope: ['packages/events/src/receipts.ts'],
      },
      NOW,
      { sink },
    );

    expect(triaged.status).toBe('accepted_ticket');
    expect(triaged.resultingTicketId).toBe('W9-01');
    expect(payload).toEqual({
      id: 'W9-01',
      type: 'bug',
      title: 'Gate accepts spoofed receipt',
      lane: 'core',
      writeScope: ['packages/events/src/receipts.ts'],
      dependsOn: [],
      acceptance: [
        `Fixes the defect reported in field report #${report.id}: The gate accepted a spoofed receipt.`,
      ],
      verify: null,
    });
    expect(sink.events[0]).toMatchObject({ outcome: 'accepted_ticket' });
  });

  it('refuses self-triage on the ticket path too', () => {
    const handle = createTestHandle();
    const report = fileReport(handle, 'human-brad');
    expect(() =>
      prepareValidatorFixTicket(
        handle,
        {
          reportId: report.id,
          triagedBy: 'human-brad',
          ticketId: 'W9-01',
          title: 't',
          lane: 'core',
          writeScope: [],
        },
        NOW,
      ),
    ).toThrow(SelfTriageError);
  });
});

describe('rejectFieldReport', () => {
  it('marks the report rejected with no playbook entry or ticket', () => {
    const handle = createTestHandle();
    const report = fileReport(handle);

    const rejected = rejectFieldReport(
      handle,
      { reportId: report.id, triagedBy: 'challenger-1', triageNote: 'not reproducible' },
      NOW,
    );

    expect(rejected.status).toBe('rejected');
    expect(rejected.resultingPlaybookEntryId).toBeNull();
    expect(rejected.resultingTicketId).toBeNull();
    expect(getFieldReport(handle, report.id)?.status).toBe('rejected');
  });

  it('refuses self-triage on reject too', () => {
    const handle = createTestHandle();
    const report = fileReport(handle, 'human-brad');
    expect(() =>
      rejectFieldReport(handle, { reportId: report.id, triagedBy: 'human-brad' }, NOW),
    ).toThrow(SelfTriageError);
  });
});
