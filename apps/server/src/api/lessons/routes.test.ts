import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, createIdentity, openEventLog } from '@dokima/events';
import { fileFieldReport, type FieldReportRecord } from '@dokima/memory';
import { getTicket } from '@dokima/tickets';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProject } from '../projects.js';
import { stateDbPath } from '../server/board-project.js';
import { registerLessonsRoutes } from './routes.js';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Seeds a report filed by a non-operator actor directly (bypassing the REST
 * filing route), for tests that only care about the triage happy paths and
 * would otherwise need to first append a real trace event just to give
 * `resolveFiledBy` (`routes.ts`) something to attribute to. The REST route
 * itself resolves a real non-operator `filedBy` for `trace`/`escalation`
 * reports whose `sourceRef` points at a real logged event — see
 * "resolves filedBy from the real trace/escalation event" below — this
 * helper just skips straight to the same end state.
 */
function seedReportFiledBy(projectPath: string, filedBy: string): FieldReportRecord {
  const log = openEventLog(stateDbPath(projectPath));
  try {
    return fileFieldReport(
      log.db,
      {
        source: 'trace',
        whatHappened: 'agent produced an unverified receipt',
        expected: 'gate should have refused',
        filedBy,
      },
      () => new Date().toISOString(),
    );
  } finally {
    log.close();
  }
}

describe('lessons routes', () => {
  const dirs: string[] = [];
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{
    app: FastifyInstance;
    projectId: string;
    projectPath: string;
  }> {
    const fleetHome = await tmpDir('dokima-lessons-routes-');
    dirs.push(fleetHome);
    const projectDir = await tmpDir('dokima-lessons-project-');
    dirs.push(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, { path: projectDir, mode: 'new' });

    const app = Fastify({ logger: false });
    registerLessonsRoutes(app, { home: fleetHome });
    await app.ready();
    apps.push(app);

    return { app, projectId: record.id, projectPath: projectDir };
  }

  const REPORT_BODY = {
    ticketId: 'W1-01',
    source: 'trace',
    sourceRef: 'trace:run-1:5',
    whatHappened: 'gate passed on a spoofed receipt',
    expected: 'gate should have refused',
    evidenceLinks: ['run:run-1'],
  };

  it('404s file/list/triage for an unregistered project', async () => {
    const { app } = await boot();
    const file = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/nope/field-reports',
      payload: REPORT_BODY,
    });
    expect(file.statusCode).toBe(404);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/nope/field-reports',
    });
    expect(list.statusCode).toBe(404);

    const triage = await app.inject({
      method: 'POST',
      url: '/api/v1/field-reports/1/triage?project=nope',
      payload: { decision: 'reject' },
    });
    expect(triage.statusCode).toBe(404);
  });

  it('files a report with the server-resolved operator identity, not a client-supplied one', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: { ...REPORT_BODY, filedBy: 'someone-else' },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json() as { filedBy: string; status: string };
    expect(created.filedBy).toBe('operator');
    expect(created.status).toBe('pending');
  });

  it('resolves filedBy from the real trace event a report was filed from, unlocking triage', async () => {
    const { app, projectId, projectPath } = await boot();
    const log = openEventLog(stateDbPath(projectPath));
    let seq: number;
    try {
      createIdentity(log, { id: 'agent-w1-01', name: 'agent-w1-01', kind: 'machine' });
      const traceEvent = appendEvent(log, {
        eventType: 'ticket.claimed',
        actorId: 'agent-w1-01',
        ticketId: 'W1-01',
        runId: 'run-9',
        payload: null,
      });
      seq = traceEvent.seq;
    } finally {
      log.close();
    }

    const file = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: { ...REPORT_BODY, sourceRef: `trace:run-9:${seq}` },
    });
    expect(file.statusCode).toBe(201);
    const created = file.json() as { id: number; filedBy: string };
    expect(created.filedBy).toBe('agent-w1-01');

    const triage = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/${created.id}/triage?project=${projectId}`,
      payload: { decision: 'reject' },
    });
    expect(triage.statusCode).toBe(200);
    expect(triage.json().status).toBe('rejected');
  });

  it('resolves filedBy from the real escalation event a report was filed from, unlocking triage', async () => {
    const { app, projectId, projectPath } = await boot();
    const log = openEventLog(stateDbPath(projectPath));
    let occurredAt: string;
    try {
      createIdentity(log, { id: 'agent-w1-01', name: 'agent-w1-01', kind: 'machine' });
      const escalationEvent = appendEvent(log, {
        eventType: 'escalation.rung_advanced',
        actorId: 'agent-w1-01',
        ticketId: 'W1-01',
        payload: null,
      });
      occurredAt = escalationEvent.createdAt;
    } finally {
      log.close();
    }

    const file = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: {
        ...REPORT_BODY,
        source: 'escalation',
        sourceRef: `escalation:W1-01:${occurredAt}`,
      },
    });
    expect(file.statusCode).toBe(201);
    const created = file.json() as { id: number; filedBy: string };
    expect(created.filedBy).toBe('agent-w1-01');

    const triage = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/${created.id}/triage?project=${projectId}`,
      payload: { decision: 'reject' },
    });
    expect(triage.statusCode).toBe(200);
    expect(triage.json().status).toBe('rejected');
  });

  it('falls back to the operator identity when sourceRef does not resolve to a real event', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: { ...REPORT_BODY, sourceRef: 'trace:no-such-run:999' },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { filedBy: string }).filedBy).toBe('operator');
  });

  it('400s a file with a blank narrative field', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: { ...REPORT_BODY, whatHappened: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s a file with an invalid source', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: { ...REPORT_BODY, source: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists filed reports, optionally scoped by status', async () => {
    const { app, projectId } = await boot();
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: REPORT_BODY,
    });

    const pending = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/field-reports?status=pending`,
    });
    expect(pending.json().items).toHaveLength(1);

    const rejected = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/field-reports?status=rejected`,
    });
    expect(rejected.json().items).toHaveLength(0);
  });

  it('409s self-triage: the operator cannot triage a report they filed through this API', async () => {
    const { app, projectId } = await boot();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: REPORT_BODY,
    });
    const report = create.json() as { id: number };

    const triage = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/${report.id}/triage?project=${projectId}`,
      payload: { decision: 'reject' },
    });
    expect(triage.statusCode).toBe(409);
    expect(triage.json().rule).toBe('SELF_TRIAGE');
  });

  it('404s triage for a report id that does not exist', async () => {
    const { app, projectId } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/999/triage?project=${projectId}`,
      payload: { decision: 'reject' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s triage with an unknown decision', async () => {
    const { app, projectId } = await boot();
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/field-reports`,
      payload: REPORT_BODY,
    });
    const report = create.json() as { id: number };
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/${report.id}/triage?project=${projectId}`,
      payload: { decision: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accept-to-playbook: triaging a non-operator-filed report inserts a real, verified playbook entry', async () => {
    const { app, projectId, projectPath } = await boot();
    const report = seedReportFiledBy(projectPath, 'agent-w1-01');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/${report.id}/triage?project=${projectId}`,
      payload: {
        decision: 'playbook',
        taskClass: 'flaky-timeout-fix',
        entry: 'Retry with backoff before failing the gate.',
      },
    });
    expect(res.statusCode).toBe(200);
    const triaged = res.json() as {
      status: string;
      triagedBy: string;
      resultingPlaybookEntryId: number | null;
    };
    expect(triaged.status).toBe('accepted_playbook');
    expect(triaged.triagedBy).toBe('operator');
    expect(triaged.resultingPlaybookEntryId).not.toBeNull();
  });

  it('accept-to-ticket: triaging a non-operator-filed report creates a real ticket in the event log', async () => {
    const { app, projectId, projectPath } = await boot();
    const report = seedReportFiledBy(projectPath, 'agent-w1-01');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/${report.id}/triage?project=${projectId}`,
      payload: {
        decision: 'ticket',
        ticketId: 'W9-01',
        title: 'Fix the spoofed-receipt gate hole',
        lane: 'events',
        writeScope: ['packages/events/src/receipts.ts'],
      },
    });
    expect(res.statusCode).toBe(200);
    const triaged = res.json() as { status: string; resultingTicketId: string | null };
    expect(triaged.status).toBe('accepted_ticket');
    expect(triaged.resultingTicketId).toBe('W9-01');

    const log = openEventLog(stateDbPath(projectPath));
    try {
      const ticket = getTicket(log, 'W9-01');
      expect(ticket?.title).toBe('Fix the spoofed-receipt gate hole');
      expect(ticket?.acceptance[0]?.text).toContain(`field report #${report.id}`);
    } finally {
      log.close();
    }
  });

  it('409s a duplicate ticket id on accept-to-ticket instead of throwing', async () => {
    const { app, projectId, projectPath } = await boot();
    const first = seedReportFiledBy(projectPath, 'agent-w1-01');
    const second = seedReportFiledBy(projectPath, 'agent-w1-01');

    const ticketBody = {
      decision: 'ticket',
      ticketId: 'W9-02',
      title: 'Duplicate ticket id attempt',
      lane: 'events',
      writeScope: ['packages/events/src/receipts.ts'],
    };
    const firstRes = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/${first.id}/triage?project=${projectId}`,
      payload: ticketBody,
    });
    expect(firstRes.statusCode).toBe(200);

    const secondRes = await app.inject({
      method: 'POST',
      url: `/api/v1/field-reports/${second.id}/triage?project=${projectId}`,
      payload: ticketBody,
    });
    expect(secondRes.statusCode).toBe(409);

    // No half-commit: the second report must still be pending (and
    // therefore retriable), not stuck `accepted_ticket` pointing at a
    // ticket that was never created.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/field-reports?status=pending`,
    });
    const pendingIds = (list.json().items as Array<{ id: number }>).map((r) => r.id);
    expect(pendingIds).toContain(second.id);
  });
});
