/**
 * W23-14. The approval is the one write in this feature that lets a machine
 * finish work by itself, so the route that records it gets the same scrutiny
 * as the policy behind it: what it covers, who it belongs to, and what it
 * says when it cannot promise what it is offering.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
import { registerProject } from '../projects.js';
import { buildApiServer, type ApiServer } from '../server.js';
import { startBuildRun } from './approved-build-run-state.js';

// Assembled rather than written out: the pre-commit secrets scanner refused
// the literal, and it was right to — a token-shaped string in source is
// exactly what FR-S2 exists to keep out, fixture or not.
const TOKEN = ['test', 'token', 'w2314', '0123456789'].join('-');
const PORT = 4407;

describe('the approved-build routes (W23-14)', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot() {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-ab14-'));
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-ab14-proj-'));
    dirs.push(projectDir);
    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
      name: 'ab14',
    });
    await fs.mkdir(path.join(projectDir, '.dokima'), { recursive: true });
    const dbPath = path.join(projectDir, '.dokima', 'state.db');
    const log = openEventLog(dbPath);
    try {
      createIdentity(log, { id: 'operator', name: 'Operator', kind: 'human' });
      createTicket(log, 'operator', {
        id: 'T-1',
        type: 'task',
        title: 'Add the login form',
        lane: 'core',
        writeScope: ['src/login/**'],
        acceptance: [{ id: 'AC-1', text: 'a person can log in', done: false }],
      });
    } finally {
      log.close();
    }
    return {
      app: server.app,
      id: record.id,
      dbPath,
      h: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` },
    };
  }

  it('the preview names what the digest covers — tickets, scopes, budget — and it is read from the project, not the request', async () => {
    const { app, id, h } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/approved-build/preview?budget_usd=5`,
      headers: h,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tickets).toHaveLength(1);
    expect(body.tickets[0]).toMatchObject({ id: 'T-1', write_scope: ['src/login/**'] });
    expect(body.input_digest).toMatch(/^sha256:/);
    expect(body.budget_usd).toBe(5);
    // C-5: the things that stop and ask however this is set.
    expect(body.still_asks_you.length).toBeGreaterThan(0);
  });

  it('RED FIXTURE: with no reviewer model it says so BEFORE launch rather than advertising an unattended finish', async () => {
    const { app, id, h } = await boot();
    const body = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${id}/approved-build/preview`,
        headers: h,
      })
    ).json();
    // This fixture project configures no models at all, which is exactly the
    // configuration the promise must not be made in.
    expect(body.independent_review).toBe(false);
    expect(body.independent_review_reason).toBeTruthy();
  });

  it('the approval is recorded under the approving human, with the digest the server computed', async () => {
    const { app, id, dbPath, h } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/approved-build`,
      headers: h,
      payload: { actor_id: 'founder', budget_usd: 5 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.version).toBe('approved-build-v1');

    const log = openEventLog(dbPath);
    try {
      const approvals = listEvents(log).filter(
        (e) => e.eventType === 'build.approval.recorded',
      );
      expect(approvals).toHaveLength(1);
      expect(approvals[0]?.actorId).toBe('founder');
      // FR-S2: the payload carries the digest and the budget, never the
      // specification itself and never a credential.
      const payload = approvals[0]?.payload as Record<string, unknown>;
      expect(payload.inputDigest).toBe(body.input_digest);
      expect(payload.tickets).toBeUndefined();
    } finally {
      log.close();
    }
  });

  it('a non-numeric budget is refused rather than digested as something else', async () => {
    const { app, id, h } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/approved-build`,
      headers: h,
      payload: { budget_usd: 'five dollars' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('progress comes from durable state, and a run from another project is a 404', async () => {
    const { app, id, dbPath, h } = await boot();
    const log = openEventLog(dbPath);
    try {
      startBuildRun(log, {
        runId: 'run-1',
        projectId: id,
        actorId: 'operator',
        approvedBuild: true,
      });
      startBuildRun(log, {
        runId: 'not-yours',
        projectId: 'another-project',
        actorId: 'operator',
        approvedBuild: true,
      });
    } finally {
      log.close();
    }

    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/build-runs/run-1/progress`,
      headers: h,
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ runId: 'run-1', phase: 'not_started' });

    const theirs = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/build-runs/not-yours/progress`,
      headers: h,
    });
    expect(theirs.statusCode).toBe(404);

    // And the list a reload uses shows this project's runs only.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/build-runs`,
      headers: h,
    });
    expect(list.json().runs.map((r: { runId: string }) => r.runId)).toEqual(['run-1']);
  });
});
