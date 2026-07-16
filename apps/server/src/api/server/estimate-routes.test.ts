import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, openEventLog } from '@shipwright/events';
import {
  acceptTicket,
  claimTicket,
  closeTicket,
  createTicket,
  startTicket,
} from '@shipwright/tickets';
import { buildApiServer, type ApiServer } from '../server.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4402;

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('estimate/spend/digest routes (BLUEPRINT §12.2, FR-G7, US-307/309)', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{ app: ApiServer['app']; fleetHome: string }> {
    const fleetHome = await tmpDir('shipwright-estimate-routes-');
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return { app: server.app, fleetHome };
  }

  function headers() {
    return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
  }

  async function registerProject(
    app: ApiServer['app'],
    fleetHome: string,
    name: string,
  ): Promise<{ id: string; dbPath: string }> {
    const projectDir = path.join(fleetHome, name);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(),
      payload: { path: projectDir, mode: 'new' },
    });
    const { id } = res.json() as { id: string };
    return { id, dbPath: path.join(projectDir, '.shipwright', 'state.db') };
  }

  describe('GET /projects/:id/estimate', () => {
    it('rejects unauthenticated with 401', async () => {
      const { app } = await boot();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/whatever/estimate',
        headers: { host: `127.0.0.1:${PORT}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('404s for an unregistered project id', async () => {
      const { app } = await boot();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/does-not-exist/estimate',
        headers: headers(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('empty board yields zero waves, not a fabricated total', async () => {
      const { app, fleetHome } = await boot();
      const { id } = await registerProject(app, fleetHome, 'proj-empty');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${id}/estimate`,
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { waves: unknown[]; total_usd: number };
      expect(body.waves).toEqual([]);
      expect(body.total_usd).toBe(0);
    });

    it('real board tickets drive a real per-wave breakdown with assumptions shown', async () => {
      const { app, fleetHome } = await boot();
      const { id, dbPath } = await registerProject(app, fleetHome, 'proj-estimate');
      const log = openEventLog(dbPath);
      createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
      createTicket(log, 'agent-1', {
        id: 'T-1',
        type: 'task',
        title: 'One',
        lane: 'ui',
        writeScope: ['a/**'],
      });
      createTicket(log, 'agent-1', {
        id: 'T-2',
        type: 'task',
        title: 'Two',
        lane: 'ui',
        writeScope: ['b/**'],
      });
      log.close();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${id}/estimate`,
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        waves: Array<{ wave: number; ticket_count: number; estimated_usd: number }>;
        total_usd: number;
        assumptions: string[];
      };
      expect(body.waves).toHaveLength(1);
      expect(body.waves[0]).toMatchObject({ wave: 0, ticket_count: 2 });
      expect(body.total_usd).toBeGreaterThan(0);
      expect(body.assumptions.length).toBeGreaterThan(0);
    });

    it('excludes done tickets: the estimate is money about to be spent, not money already spent (BLUEPRINT §12.2)', async () => {
      const { app, fleetHome } = await boot();
      const { id, dbPath } = await registerProject(app, fleetHome, 'proj-done-excluded');
      const log = openEventLog(dbPath);
      createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
      createIdentity(log, { id: 'reviewer-1', name: 'Reviewer', kind: 'machine' });
      createTicket(log, 'agent-1', {
        id: 'T-DONE',
        type: 'task',
        title: 'Already closed',
        lane: 'ui',
        writeScope: ['a/**'],
      });
      createTicket(log, 'agent-1', {
        id: 'T-PENDING',
        type: 'task',
        title: 'Still pending',
        lane: 'ui',
        writeScope: ['b/**'],
      });
      claimTicket(log, { ticketId: 'T-DONE', actorId: 'agent-1' });
      startTicket(log, { ticketId: 'T-DONE', actorId: 'agent-1' });
      closeTicket(log, {
        ticketId: 'T-DONE',
        actorId: 'agent-1',
        files: ['a/x.ts'],
        commits: ['abc123'],
        verify: { command: 'pnpm test', exitCode: 0 },
      });
      acceptTicket(log, { ticketId: 'T-DONE', actorId: 'reviewer-1' });
      log.close();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${id}/estimate`,
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        waves: Array<{ wave: number; ticket_count: number }>;
        total_usd: number;
      };
      expect(body.waves).toHaveLength(1);
      expect(body.waves[0]).toMatchObject({ wave: 0, ticket_count: 1 });
    });
  });

  describe('POST /projects/:id/estimate/what-if', () => {
    async function seedTwoTickets(
      app: ApiServer['app'],
      fleetHome: string,
    ): Promise<string> {
      const { id, dbPath } = await registerProject(app, fleetHome, 'proj-whatif');
      const log = openEventLog(dbPath);
      createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
      createTicket(log, 'agent-1', {
        id: 'T-1',
        type: 'task',
        title: 'One',
        lane: 'ui',
        writeScope: ['a/**'],
      });
      createTicket(log, 'agent-1', {
        id: 'T-2',
        type: 'task',
        title: 'Two',
        lane: 'ui',
        writeScope: ['b/**'],
      });
      log.close();
      return id;
    }

    it('rejects a non-object overrides body with 400', async () => {
      const { app, fleetHome } = await boot();
      const id = await seedTwoTickets(app, fleetHome);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/estimate/what-if`,
        headers: headers(),
        payload: { overrides: 'nope' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a non-numeric override with 400', async () => {
      const { app, fleetHome } = await boot();
      const id = await seedTwoTickets(app, fleetHome);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/estimate/what-if`,
        headers: headers(),
        payload: { overrides: { 'code-reviewer': 'cheap' } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('lowering a role rate deterministically lowers the total (SRS FR-G7)', async () => {
      const { app, fleetHome } = await boot();
      const id = await seedTwoTickets(app, fleetHome);

      const base = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${id}/estimate`,
        headers: headers(),
      });
      const baseBody = base.json() as { total_usd: number };

      const whatIf = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/estimate/what-if`,
        headers: headers(),
        payload: { overrides: { 'code-reviewer': 0.01 } },
      });
      expect(whatIf.statusCode).toBe(200);
      const whatIfBody = whatIf.json() as { total_usd: number };
      expect(whatIfBody.total_usd).toBeLessThan(baseBody.total_usd);

      // deterministic: same override recomputed twice yields the same total
      const again = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/estimate/what-if`,
        headers: headers(),
        payload: { overrides: { 'code-reviewer': 0.01 } },
      });
      const againBody = again.json() as { total_usd: number };
      expect(againBody.total_usd).toBe(whatIfBody.total_usd);
    });
  });

  describe('GET /projects/:id/spend', () => {
    it('404s for an unregistered project id', async () => {
      const { app } = await boot();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/does-not-exist/spend?group_by=rung',
        headers: headers(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects an unsupported group_by with 400', async () => {
      const { app, fleetHome } = await boot();
      const { id } = await registerProject(app, fleetHome, 'proj-spend-bad');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${id}/spend?group_by=model`,
        headers: headers(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('group_by=rung returns an honest-empty rollup with the gap documented', async () => {
      const { app, fleetHome } = await boot();
      const { id } = await registerProject(app, fleetHome, 'proj-spend');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${id}/spend?group_by=rung`,
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        group_by: string;
        items: unknown[];
        assumptions: string[];
      };
      expect(body.group_by).toBe('rung');
      expect(body.items).toEqual([]);
      expect(body.assumptions.length).toBeGreaterThan(0);
    });
  });

  describe('GET /projects/:id/spend/digest', () => {
    it('404s for an unregistered project id', async () => {
      const { app } = await boot();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/does-not-exist/spend/digest',
        headers: headers(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('is a Review-tier card with honest-empty rollups and suppression volume documented as a gap (US-309 AC-1, GATE_ECONOMICS §3)', async () => {
      const { app, fleetHome } = await boot();
      const { id } = await registerProject(app, fleetHome, 'proj-digest');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${id}/spend/digest`,
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        tier: string;
        total_spend_usd: number;
        by_rung: unknown[];
        suppression_volume: unknown[];
        assumptions: string[];
      };
      expect(body.tier).toBe('review');
      expect(body.total_spend_usd).toBe(0);
      expect(body.by_rung).toEqual([]);
      expect(body.suppression_volume).toEqual([]);
      expect(body.assumptions.length).toBeGreaterThanOrEqual(2);
    });
  });
});
