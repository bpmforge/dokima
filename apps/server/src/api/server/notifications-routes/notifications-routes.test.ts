import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acceptTicket,
  closeTicket,
  claimTicket,
  createTicket,
  startTicket,
} from '@dokima/tickets';
import { createIdentity, openEventLog } from '@dokima/events';
import { buildApiServer, type ApiServer } from '../../server.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4403;

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('notification center + morning queue routes (FR-N4, FR-F4, US-704/US-404)', () => {
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
    const fleetHome = await tmpDir('dokima-notifications-routes-');
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
    return { id, dbPath: path.join(projectDir, '.dokima', 'state.db') };
  }

  async function emit(
    app: ApiServer['app'],
    projectId: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/notifications`,
      headers: headers(),
      payload,
    });
  }

  describe('GET /api/v1/notifications', () => {
    it('rejects unauthenticated with 401', async () => {
      const { app } = await boot();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { host: `127.0.0.1:${PORT}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('404s for an unregistered project filter', async () => {
      const { app } = await boot();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?project=does-not-exist',
        headers: headers(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('400s for an invalid tier/status filter', async () => {
      const { app } = await boot();
      const badTier = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?tier=urgent',
        headers: headers(),
      });
      expect(badTier.statusCode).toBe(400);
      const badStatus = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?status=whatever',
        headers: headers(),
      });
      expect(badStatus.statusCode).toBe(400);
    });

    it('an empty, freshly-registered project has an empty notification center (UX_SPEC §2b empty state)', async () => {
      const { app, fleetHome } = await boot();
      await registerProject(app, fleetHome, 'proj-empty');
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [], next_cursor: null });
    });

    it('lists an emitted notification, filterable by tier and status', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-list');
      const created = await emit(app, projectId, {
        tier: 'decide',
        kind: 'approval',
        title: 'Merge W4-07',
        body: { diffStat: '+10 -2' },
      });
      expect(created.statusCode).toBe(201);
      const wire = created.json() as {
        id: string;
        project_id: string;
        project_name: string;
      };
      expect(wire.project_id).toBe(projectId);
      expect(wire.project_name).toBe('proj-list');

      const listed = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?tier=decide',
        headers: headers(),
      });
      expect((listed.json() as { items: unknown[] }).items).toHaveLength(1);

      const wrongTier = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?tier=review',
        headers: headers(),
      });
      expect((wrongTier.json() as { items: unknown[] }).items).toHaveLength(0);
    });

    it('propagates a non-schema state.db failure as a 500, instead of silently degrading to an empty list (SQLITE_CANTOPEN regression)', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId, dbPath } = await registerProject(
        app,
        fleetHome,
        'proj-cantopen',
      );
      await fs.chmod(dbPath, 0o000);
      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/notifications?project=${projectId}`,
          headers: headers(),
        });
        expect(res.statusCode).toBe(500);
      } finally {
        await fs.chmod(dbPath, 0o644);
      }
    });

    it('aggregates across every registered project (FR-F4), and a project filter isolates one', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectA } = await registerProject(app, fleetHome, 'proj-a');
      const { id: projectB } = await registerProject(app, fleetHome, 'proj-b');
      await emit(app, projectA, {
        tier: 'review',
        kind: 'gate_passed',
        title: 'A gate',
        summary: 's',
      });
      await emit(app, projectB, {
        tier: 'review',
        kind: 'gate_passed',
        title: 'B gate',
        summary: 's',
      });

      const all = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: headers(),
      });
      expect((all.json() as { items: unknown[] }).items).toHaveLength(2);

      const filtered = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications?project=${projectA}`,
        headers: headers(),
      });
      const filteredItems = (filtered.json() as { items: { project_id: string }[] })
        .items;
      expect(filteredItems).toHaveLength(1);
      expect(filteredItems[0]?.project_id).toBe(projectA);
    });
  });

  describe('POST /api/v1/projects/:id/notifications (emitter contract, US-704 AC-1)', () => {
    it('404s for an unregistered project', async () => {
      const { app } = await boot();
      const res = await emit(app, 'does-not-exist', {
        tier: 'decide',
        kind: 'approval',
        title: 'x',
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects an unclassified (missing/invalid tier) notification with 400', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-taxonomy');
      const missingTier = await emit(app, projectId, { kind: 'approval', title: 'x' });
      expect(missingTier.statusCode).toBe(400);
      const invalidTier = await emit(app, projectId, {
        tier: 'urgent',
        kind: 'approval',
        title: 'x',
      });
      expect(invalidTier.statusCode).toBe(400);
      const invalidKind = await emit(app, projectId, {
        tier: 'decide',
        kind: 'urgent',
        title: 'x',
      });
      expect(invalidKind.statusCode).toBe(400);
    });

    it('rejects a missing title with 400', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-title');
      const res = await emit(app, projectId, { tier: 'decide', kind: 'approval' });
      expect(res.statusCode).toBe(400);
    });

    it('tier: review batches into one digest per open batch', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-digest');
      const first = await emit(app, projectId, {
        tier: 'review',
        kind: 'gate_passed',
        title: 'Gate A',
        summary: 'green',
      });
      const second = await emit(app, projectId, {
        tier: 'review',
        kind: 'pr_ready',
        title: 'PR ready',
        summary: 'pushed',
      });
      expect((first.json() as { id: string }).id).toBe(
        (second.json() as { id: string }).id,
      );

      const listed = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications?project=${projectId}&tier=review`,
        headers: headers(),
      });
      expect((listed.json() as { items: unknown[] }).items).toHaveLength(1);
    });
  });

  describe('GET /api/v1/approvals/queue (morning queue, UX_SPEC §7)', () => {
    it('only lists Decide/Review tiers, sorted by leverage, never Record', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-queue');
      await emit(app, projectId, {
        tier: 'review',
        kind: 'digest',
        title: 'digest',
        body: {},
      });
      await emit(app, projectId, { tier: 'decide', kind: 'pr_ready', title: 'merge me' });
      await emit(app, projectId, {
        tier: 'decide',
        kind: 'clarification',
        title: 'clarify',
      });
      await emit(app, projectId, {
        tier: 'record',
        kind: 'gate_passed',
        title: 'fyi only',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/approvals/queue',
        headers: headers(),
      });
      const items = (res.json() as { items: { tier: string; kind: string }[] }).items;
      expect(items.map((i) => i.kind)).toEqual(['pr_ready', 'clarification', 'digest']);
      expect(items.every((i) => i.tier !== 'record')).toBe(true);
    });

    it('aggregates the queue across projects and interleaves by leverage', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectA } = await registerProject(app, fleetHome, 'proj-queue-a');
      const { id: projectB } = await registerProject(app, fleetHome, 'proj-queue-b');
      await emit(app, projectA, {
        tier: 'decide',
        kind: 'clarification',
        title: 'low leverage',
      });
      await emit(app, projectB, {
        tier: 'decide',
        kind: 'pr_ready',
        title: 'high leverage',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/approvals/queue',
        headers: headers(),
      });
      const items = (res.json() as { items: { project_id: string; kind: string }[] })
        .items;
      expect(items[0]?.project_id).toBe(projectB);
      expect(items[0]?.kind).toBe('pr_ready');
    });
  });

  describe('POST /api/v1/approvals/:id/decide', () => {
    it('approves and removes the card from the open queue', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-decide');
      const created = await emit(app, projectId, {
        tier: 'decide',
        kind: 'approval',
        title: 'Merge it',
      });
      const notificationId = (created.json() as { id: string }).id;

      const decided = await app.inject({
        method: 'POST',
        url: `/api/v1/approvals/${notificationId}/decide?project=${projectId}`,
        headers: headers(),
        payload: { decision: 'approved' },
      });
      expect(decided.statusCode).toBe(200);

      const queue = await app.inject({
        method: 'GET',
        url: '/api/v1/approvals/queue',
        headers: headers(),
      });
      expect((queue.json() as { items: unknown[] }).items).toHaveLength(0);
    });

    it('404s deciding an unknown notification id', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-decide-404');
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/approvals/does-not-exist/decide?project=${projectId}`,
        headers: headers(),
        payload: { decision: 'approved' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('400s an invalid decision value', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-decide-400');
      const created = await emit(app, projectId, {
        tier: 'decide',
        kind: 'approval',
        title: 'x',
      });
      const id = (created.json() as { id: string }).id;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/approvals/${id}/decide?project=${projectId}`,
        headers: headers(),
        payload: { decision: 'maybe' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/notifications/:id/dismiss', () => {
    it('dismisses an open notification', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId } = await registerProject(app, fleetHome, 'proj-dismiss');
      const created = await emit(app, projectId, {
        tier: 'record',
        kind: 'gate_passed',
        title: 'fyi',
      });
      const id = (created.json() as { id: string }).id;

      const dismissed = await app.inject({
        method: 'POST',
        url: `/api/v1/notifications/${id}/dismiss?project=${projectId}`,
        headers: headers(),
      });
      expect(dismissed.statusCode).toBe(200);

      const listed = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications?project=${projectId}&status=dismissed`,
        headers: headers(),
      });
      expect((listed.json() as { items: unknown[] }).items).toHaveLength(1);
    });
  });

  describe('trust-graduation suggestion (R-A1/US-310)', () => {
    it('surfaces a Record-tier suggestion card once evidence crosses threshold', async () => {
      const { app, fleetHome } = await boot();
      const { id: projectId, dbPath } = await registerProject(
        app,
        fleetHome,
        'proj-trust',
      );
      const log = openEventLog(dbPath);
      createIdentity(log, { id: 'agent-1', name: 'Agent', kind: 'machine' });
      createIdentity(log, { id: 'reviewer-1', name: 'Reviewer', kind: 'machine' });
      for (let i = 0; i < 10; i++) {
        const ticketId = `T-clean-${i}`;
        createTicket(log, 'agent-1', {
          id: ticketId,
          type: 'task',
          title: ticketId,
          lane: 'ui',
          writeScope: [`a/${i}/**`],
        });
        claimTicket(log, { ticketId, actorId: 'agent-1' });
        startTicket(log, { ticketId, actorId: 'agent-1' });
        closeTicket(log, {
          ticketId,
          actorId: 'agent-1',
          files: ['a.ts'],
          commits: ['c1'],
          verify: { command: 'test', exitCode: 0 },
        });
        acceptTicket(log, { ticketId, actorId: 'reviewer-1' });
      }
      createTicket(log, 'agent-1', {
        id: 'T-ready-ui',
        type: 'task',
        title: 'ready ui',
        lane: 'ui',
        writeScope: ['b/**'],
      });
      createTicket(log, 'agent-1', {
        id: 'T-ready-gateway',
        type: 'task',
        title: 'ready gateway',
        lane: 'gateway',
        writeScope: ['c/**'],
      });
      log.close();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications?project=${projectId}`,
        headers: headers(),
      });
      const items = (res.json() as { items: { tier: string; kind: string }[] }).items;
      const suggestion = items.find((i) => i.kind === 'suggestion');
      expect(suggestion).toMatchObject({ tier: 'record', kind: 'suggestion' });

      // Idempotent — a second GET does not duplicate the suggestion card.
      const again = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications?project=${projectId}`,
        headers: headers(),
      });
      const suggestions = (again.json() as { items: { kind: string }[] }).items.filter(
        (i) => i.kind === 'suggestion',
      );
      expect(suggestions).toHaveLength(1);
    });
  });
});
