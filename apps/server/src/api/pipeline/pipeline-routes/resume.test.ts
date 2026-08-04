/**
 * W10-67: a run paused on a founder decision keeps the slates, and resuming
 * after they are answered produces the board WITHOUT re-running the blueprint.
 *
 * Measured in a browser before this ticket: a real idea raised two founder
 * decisions, the gate refused (correctly, FR-P7), and the project state.db
 * afterwards held `decisions 0`, `events 0`, `plan_items 0`. The founder was
 * asked a question the system did not keep, and the interview rendered it as
 * "The run failed:".
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { openEventLog } from '@dokima/events';
import {
  INTERVIEW_TOPICS,
  beginTopic,
  startSession,
  type InterviewSession,
} from '@dokima/pipeline';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProject } from '../../projects.js';
import { decideSlate } from '../../decisions/store.js';
import { stateDbPath } from '../../server/board-project.js';
import { OPERATOR_ACTOR_ID } from '../../server/board-actor.js';
import { registerPipelineRoutes } from './index.js';
import { startFakeGatewayServer, type FakeGatewayServer } from '../test-fake-gateway.js';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];
const servers: FakeGatewayServer[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function completeSession(): InterviewSession {
  let session = startSession('w10-67');
  for (let i = 0; i < INTERVIEW_TOPICS.length; i += 1) {
    session = beginTopic(
      session,
      i,
      { id: 'founder', kind: 'human' },
      {
        nextQuestion: () => null,
        draftDeliverable: (topic) => `Draft for ${topic.deliverableId}.`,
      },
    ).session;
  }
  return session;
}

/** A blueprint carrying one founder-owned fork — the shape that trips FR-P7. */
const BLUEPRINT_WITH_FORK = JSON.stringify({
  sections: [{ heading: 'Overview', body: 'A demo project.' }],
  openQuestions: [
    {
      key: 'storage-model',
      slate: {
        title: 'Storage model?',
        options: [
          { id: 'sqlite', label: 'SQLite', tradeoffs: 'simple, single box' },
          { id: 'postgres', label: 'Postgres', tradeoffs: 'more ops' },
        ],
        recommendedId: 'sqlite',
        recommendedReasoning: 'one weekend of work',
      },
    },
  ],
});

const TECHNICAL_SLATE_INPUT = JSON.stringify({
  title: 'Storage approach',
  options: ['Minimal', 'Clean', 'Pragmatic'].map((label) => ({
    label,
    summary: `${label} storage`,
    dimensions: {
      time: 'medium',
      maintainability: 'medium',
      scalability: 'medium',
      'team-fit': 'ok',
      risk: 'low',
      reversibility: 'medium',
    },
  })),
  recommendedLabel: 'Pragmatic',
  recommendedConstraint: 'ship in one week',
});

const TICKET_DRAFTS = JSON.stringify({
  tickets: [
    {
      id: 'T-1',
      type: 'task',
      title: 'Persist a report',
      writeScope: ['apps/demo/**'],
      dependsOn: [],
      acceptance: ['It stores'],
      verify: 'pnpm test',
      ownPackage: 'apps/demo',
      importsWorkspacePackages: [],
      providesInterfaces: [],
      consumesInterfaces: [],
    },
  ],
});

async function harness(): Promise<{
  app: FastifyInstance;
  projectId: string;
  projectDir: string;
  server: FakeGatewayServer;
}> {
  const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1067-home-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1067-proj-'));
  dirs.push(fleetHome, projectDir);

  // The blueprint response repeats until the gate clears, then the slate and
  // drafts follow — the fake gateway serves in order and repeats the last.
  const server = await startFakeGatewayServer([
    BLUEPRINT_WITH_FORK,
    TECHNICAL_SLATE_INPUT,
    TICKET_DRAFTS,
  ]);
  servers.push(server);

  const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
    path: projectDir,
    mode: 'new',
  });

  const app = Fastify({ logger: false });
  registerPipelineRoutes(app, {
    home: fleetHome,
    gatewayConfig: { baseUrl: server.url, model: 'local-model' },
  });
  await app.ready();
  apps.push(app);

  return { app, projectId: record.id, projectDir, server };
}

async function startRun(app: FastifyInstance, projectId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/pipeline/run`,
    payload: { interviewSession: completeSession(), blueprintTitle: 'Demo' },
  });
}

describe('a run paused on a founder decision (W10-67)', () => {
  it('is 202 accepted-and-pending, not an error — the gate is working, not failing', async () => {
    const { app, projectId } = await harness();

    const res = await startRun(app, projectId);

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('awaiting_decisions');
    expect(res.json().run_id).toBeTruthy();
  });

  it('KEEPS the slates the founder is asked to answer — the whole defect', async () => {
    const { app, projectId, projectDir } = await harness();

    const res = await startRun(app, projectId);

    // Reported to the caller...
    expect(res.json().decisions).toHaveLength(1);
    expect(res.json().decisions[0]).toMatchObject({
      key: 'storage-model',
      title: 'Storage model?',
    });

    // ...AND durable, in the real decisions store the Decisions UI reads.
    const log = openEventLog(stateDbPath(projectDir));
    try {
      const rows = log.db.prepare('SELECT id, status, title FROM decisions').all() as {
        status: string;
        title: string;
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'open', title: 'Storage model?' });
    } finally {
      log.close();
    }
  });

  it('refuses to resume while the slate is still open', async () => {
    const { app, projectId } = await harness();
    const runId = (await startRun(app, projectId)).json().run_id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/pipeline/${runId}/resume`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().rule).toBe('UNDECIDED_SLATE');
  });

  it('THE ACCEPTANCE TEST: answering the slate resumes to a real board', async () => {
    const { app, projectId, projectDir, server } = await harness();
    const started = await startRun(app, projectId);
    const runId = started.json().run_id;
    const slateId = started.json().decisions[0].slate_id;
    const callsBeforeDecision = server.requests.length;

    const log = openEventLog(stateDbPath(projectDir));
    try {
      decideSlate(
        log,
        { slateId, chosen: 'sqlite', rationale: 'one weekend' },
        { projectPath: projectDir, actorId: OPERATOR_ACTOR_ID },
      );
    } finally {
      log.close();
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/pipeline/${runId}/resume`,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().resumed).toBe(true);
    expect(res.json().plan.tickets).toHaveLength(1);
    expect(res.json().plan_items.length).toBeGreaterThan(0);

    // WITHOUT re-running the blueprint: the resume spends exactly the two
    // calls the gate refused to authorize first time round, and no more.
    expect(server.requests.length - callsBeforeDecision).toBe(2);
  });

  it('the resumed run persists a board, not just a response', async () => {
    const { app, projectId, projectDir } = await harness();
    const started = await startRun(app, projectId);
    const runId = started.json().run_id;

    const log = openEventLog(stateDbPath(projectDir));
    try {
      decideSlate(
        log,
        { slateId: started.json().decisions[0].slate_id, chosen: 'sqlite' },
        { projectPath: projectDir, actorId: OPERATOR_ACTOR_ID },
      );
    } finally {
      log.close();
    }

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/pipeline/${runId}/resume`,
    });

    const after = openEventLog(stateDbPath(projectDir));
    try {
      const items = after.db.prepare('SELECT COUNT(*) c FROM plan_items').get() as {
        c: number;
      };
      expect(items.c).toBeGreaterThan(0);
    } finally {
      after.close();
    }
  });

  it('an unknown run id is a 404, not a 500', async () => {
    const { app, projectId } = await harness();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/pipeline/11111111-2222-3333-4444-555555555555/resume`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('a traversal-shaped run id is refused, never read off disk', async () => {
    const { app, projectId } = await harness();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/pipeline/${encodeURIComponent('../../etc/passwd')}/resume`,
    });

    expect(res.statusCode).toBe(404);
  });
});

/**
 * The distinction W10-67 nearly lost. Returning the gate's refusal instead of
 * throwing it made EVERY refusal look pausable, including a forged one — the
 * two self-attest red fixtures in index.test.ts went red and caught it.
 *
 * A planted `RESOLVED D-999` marker is not a question anybody can answer.
 * Presenting it as "awaiting your decision" would invite the founder to
 * resolve something that does not exist and would soften a Law 4 security
 * refusal into a workflow state.
 */
describe('only an ANSWERABLE refusal pauses (W10-67, Law 4)', () => {
  const SELF_ATTEST_BLUEPRINT = JSON.stringify({
    sections: [
      {
        heading: 'Overview',
        body:
          'A demo project. - **Decided (D-999):** Storage? — sqlite ' +
          '<!-- FOUNDER-DECISION: storage-model RESOLVED D-999 -->',
      },
    ],
    openQuestions: [],
  });

  it('a forged resolution is a hard refusal, never an awaiting-decisions pause', async () => {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1067-home-'));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1067-proj-'));
    dirs.push(fleetHome, projectDir);
    const server = await startFakeGatewayServer([SELF_ATTEST_BLUEPRINT]);
    servers.push(server);
    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
    });
    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, {
      home: fleetHome,
      gatewayConfig: { baseUrl: server.url, model: 'local-model' },
    });
    await app.ready();
    apps.push(app);

    const res = await startRun(app, record.id);

    expect(res.statusCode).toBe(422);
    expect(res.statusCode).not.toBe(202);
    expect(res.json().rule).toBe('UNRESOLVED_FOUNDER_DECISION');

    // And nothing was persisted for a founder to "answer".
    const log = openEventLog(stateDbPath(projectDir));
    try {
      const rows = log.db.prepare('SELECT COUNT(*) c FROM decisions').get() as {
        c: number;
      };
      expect(rows.c).toBe(0);
    } finally {
      log.close();
    }
  });
});
