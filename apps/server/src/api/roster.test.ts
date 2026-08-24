import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createIdentity,
  openEventLog,
  openGlobalDb,
  putModelFitness,
} from '@dokima/events';
import { buildApiServer, type ApiServer } from './server.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4403;

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const CLEAN_EXPERT = [
  '---',
  "description: 'A clean fixture expert'",
  'mode: "primary"',
  '---',
  '',
  '# Clean Expert',
].join('\n');

async function writeFixtureContentDir(dirs: string[]): Promise<string> {
  const contentDir = await tmpDir('dokima-roster-fixture-content-');
  dirs.push(contentDir);
  await fs.mkdir(path.join(contentDir, 'coordinators'), { recursive: true });
  await fs.writeFile(
    path.join(contentDir, 'coordinators', 'sdlc-lead.md'),
    CLEAN_EXPERT,
    'utf8',
  );
  return contentDir;
}

describe('roster routes (SRS FR-E2, R-K1)', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  function headers() {
    return { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };
  }

  async function boot(
    rosterContentDir: string,
  ): Promise<{ app: ApiServer['app']; fleetHome: string }> {
    const fleetHome = await tmpDir('dokima-roster-routes-');
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
      rosterContentDir,
    });
    active = server;
    return { app: server.app, fleetHome };
  }

  async function registerProject(
    app: ApiServer['app'],
    fleetHome: string,
    name: string,
  ): Promise<{ id: string; projectDir: string }> {
    const projectDir = path.join(fleetHome, name);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(),
      payload: { path: projectDir, mode: 'new' },
    });
    const { id } = res.json() as { id: string };
    return { id, projectDir };
  }

  it('lists experts from the given content dir, unconfigured model resolution and empty fitness by default (C-1 honesty)', async () => {
    const contentDir = await writeFixtureContentDir(dirs);
    const { app } = await boot(contentDir);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/roster',
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { experts: unknown[] };
    expect(body.experts).toEqual([
      {
        id: 'sdlc-lead',
        display_name: 'Sdlc Lead',
        cluster: 'coordinators',
        mode: 'primary',
        description: 'A clean fixture expert',
        effective_model: { chain: [], scope: null, used_default_role: false },
        fitness_cards: [],
        instruction_cost: null,
      },
    ]);
  });

  it('resolves against the global config when no project is given (winning scope: global)', async () => {
    const contentDir = await writeFixtureContentDir(dirs);
    const fleetHome = await tmpDir('dokima-roster-global-');
    dirs.push(fleetHome);
    await fs.writeFile(
      path.join(fleetHome, 'config.json'),
      JSON.stringify({
        'roleMatrix.sdlc-lead': {
          default: { model: 'qwen2.5-coder-32b-instruct', fallbackChain: [] },
        },
      }),
      'utf8',
    );
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
      rosterContentDir: contentDir,
    });
    active = server;

    const res = await server.app.inject({
      method: 'GET',
      url: '/api/v1/roster',
      headers: headers(),
    });
    const body = res.json() as { experts: { effective_model: unknown }[] };
    expect(body.experts[0]?.effective_model).toEqual({
      chain: ['qwen2.5-coder-32b-instruct'],
      scope: 'global',
      used_default_role: false,
    });
  });

  it('project settings.json override wins over global (?project= layers in project scope)', async () => {
    const contentDir = await writeFixtureContentDir(dirs);
    const { app, fleetHome } = await boot(contentDir);
    await fs.writeFile(
      path.join(fleetHome, 'config.json'),
      JSON.stringify({
        'roleMatrix.sdlc-lead': { default: { model: 'global-model', fallbackChain: [] } },
      }),
      'utf8',
    );
    const { id, projectDir } = await registerProject(app, fleetHome, 'proj-a');
    await fs.writeFile(
      path.join(projectDir, '.dokima', 'settings.json'),
      JSON.stringify({
        'roleMatrix.sdlc-lead': {
          default: { model: 'project-model', fallbackChain: ['fb'] },
        },
      }),
      'utf8',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/roster?project=${id}`,
      headers: headers(),
    });
    const body = res.json() as { experts: { effective_model: unknown }[] };
    expect(body.experts[0]?.effective_model).toEqual({
      chain: ['project-model', 'fb'],
      scope: 'project',
      used_default_role: false,
    });
  });

  it('surfaces a fitness card only for the configured model, not every model this role has ever been benched on', async () => {
    const contentDir = await writeFixtureContentDir(dirs);
    const fleetHome = await tmpDir('dokima-roster-fitness-wired-');
    dirs.push(fleetHome);
    await fs.writeFile(
      path.join(fleetHome, 'config.json'),
      JSON.stringify({
        'roleMatrix.sdlc-lead': {
          default: { model: 'configured-model', fallbackChain: [] },
        },
      }),
      'utf8',
    );
    const global = openGlobalDb(path.join(fleetHome, 'global.db'));
    putModelFitness(global, {
      model: 'configured-model',
      role: 'sdlc-lead',
      verdict: 'fit',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: '2026-07-16T00:00:00.000Z',
    });
    putModelFitness(global, {
      model: 'some-other-model-once-benched',
      role: 'sdlc-lead',
      verdict: 'unfit',
      harnessVersion: '1.0.0',
      receiptPayload: [],
      runAt: '2026-07-01T00:00:00.000Z',
    });
    global.close();

    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
      rosterContentDir: contentDir,
    });
    active = server;

    const res = await server.app.inject({
      method: 'GET',
      url: '/api/v1/roster',
      headers: headers(),
    });
    const body = res.json() as {
      experts: { fitness_cards: { model: string; verdict: string }[] }[];
    };
    expect(body.experts[0]?.fitness_cards).toEqual([
      {
        model: 'configured-model',
        verdict: 'fit',
        harness_version: '1.0.0',
        run_at: '2026-07-16T00:00:00.000Z',
      },
    ]);
  });

  it('refuses roster content with a hardcoded model id, naming the violated rule (FR-E2)', async () => {
    const contentDir = await tmpDir('dokima-roster-poisoned-content-');
    dirs.push(contentDir);
    await fs.writeFile(
      path.join(contentDir, 'poisoned.md'),
      [
        '---',
        "description: 'Poisoned'",
        'mode: "primary"',
        'model: claude-opus-4-8',
        '---',
      ].join('\n'),
      'utf8',
    );
    const { app } = await boot(contentDir);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/roster',
      headers: headers(),
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { rule?: string; detail: string };
    expect(body.rule).toBe('FR-E2: pin roles, not models');
    expect(body.detail).toContain('claude-opus-4-8');
  });

  describe('GET /api/v1/roster/:agent/history', () => {
    it('400s when the required "project" query parameter is missing', async () => {
      const contentDir = await writeFixtureContentDir(dirs);
      const { app } = await boot(contentDir);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/roster/sdlc-lead/history',
        headers: headers(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s for an unregistered project id', async () => {
      const contentDir = await writeFixtureContentDir(dirs);
      const { app } = await boot(contentDir);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/roster/sdlc-lead/history?project=ghost',
        headers: headers(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns event-derived history for the agent (HANDOFFs run, outcomes)', async () => {
      const contentDir = await writeFixtureContentDir(dirs);
      const { app, fleetHome } = await boot(contentDir);
      const { id, projectDir } = await registerProject(app, fleetHome, 'proj-hist');

      const dbPath = path.join(projectDir, '.dokima', 'state.db');
      const log = openEventLog(dbPath);
      createIdentity(log, { id: 'sdlc-lead', name: 'SDLC Lead', kind: 'machine' });
      appendEvent(log, {
        eventType: 'ticket.claimed',
        actorId: 'sdlc-lead',
        ticketId: 'T-1',
        payload: {},
      });
      appendEvent(log, {
        eventType: 'ticket.started',
        actorId: 'sdlc-lead',
        ticketId: 'T-1',
        payload: {},
      });
      appendEvent(log, {
        eventType: 'ticket.closed',
        actorId: 'sdlc-lead',
        ticketId: 'T-1',
        payload: {},
      });
      log.close();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/roster/sdlc-lead/history?project=${id}`,
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        agent_id: string;
        handoffs_run: number;
        outcomes: number;
        verdict_scores: number;
        spend: number;
        escalations: number;
        entries: unknown[];
      };
      expect(body.agent_id).toBe('sdlc-lead');
      expect(body.handoffs_run).toBe(2);
      expect(body.outcomes).toBe(1);
      expect(body.verdict_scores).toBe(0);
      expect(body.spend).toBe(0);
      expect(body.escalations).toBe(0);
      expect(body.entries).toHaveLength(3);
    });

    it('an agent with no matching events resolves to zero counts, not a 404 (C-1 honesty)', async () => {
      const contentDir = await writeFixtureContentDir(dirs);
      const { app, fleetHome } = await boot(contentDir);
      const { id } = await registerProject(app, fleetHome, 'proj-empty-hist');

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/roster/nobody-home/history?project=${id}`,
        headers: headers(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { handoffs_run: number };
      expect(body.handoffs_run).toBe(0);
    });
  });
  it('RED FIXTURE (W20-01, D-028): a role WITH a persona serves it; a role WITHOUT one serves no persona field at all — the client then renders the raw id, never an invented person', async () => {
    const contentDir = await tmpDir('dokima-roster-personas-');
    dirs.push(contentDir);
    await fs.mkdir(path.join(contentDir, 'other'), { recursive: true });
    await fs.mkdir(path.join(contentDir, 'coordinators'), { recursive: true });
    await fs.writeFile(
      path.join(contentDir, 'other', 'coding-agent.md'),
      '---\nname: Coding Agent\nmode: primary\ndescription: Builds things\n---\nbody\n',
    );
    await fs.writeFile(
      path.join(contentDir, 'coordinators', 'sdlc-lead.md'),
      '---\nname: Sdlc Lead\nmode: primary\ndescription: A clean fixture expert\n---\nbody\n',
    );
    const { app } = await boot(contentDir);

    const res = await app.inject({ method: 'GET', url: '/api/v1/roster', headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      experts: { id: string; persona?: { display_name: string; job_line: string } }[];
    };
    const sam = body.experts.find((e) => e.id === 'coding-agent');
    const lead = body.experts.find((e) => e.id === 'sdlc-lead');
    expect(sam?.persona?.display_name).toBe('Sam');
    expect(sam?.persona?.job_line).toContain('hands on the keyboard');
    expect(lead).toBeDefined();
    expect(lead?.persona).toBeUndefined();
    expect(sam?.id).toBe('coding-agent');   // the face never replaces the id
  });

});
