/**
 * W10-69: does the creation pipeline actually CALL the model the user picked?
 *
 * A separate file from `index.test.ts` on purpose. Every case in that file
 * passes `gatewayConfig` to `registerPipelineRoutes`, which short-circuits the
 * whole resolution path — which is exactly why the route could build its port
 * from `resolveGatewayConfigFromEnv()` for two milestones without a single
 * test noticing. Injecting the answer is how the question went unasked.
 *
 * So nothing here injects `gatewayConfig`. Each case configures the project
 * the way a user does — a provider registry entry and a model-matrix row —
 * and asserts the model id the fake gateway RECEIVED. Asserting the resolved
 * config object instead would have passed all along: the config was always
 * resolvable, nothing ever asked for it.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  INTERVIEW_TOPICS,
  beginTopic,
  startSession,
  type InterviewSession,
} from '@dokima/pipeline';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProject } from '../../projects.js';
import { putProviders } from '../../server/providers-store.js';
import { putModelMatrix } from '../../server/model-matrix-store.js';
import { registerPipelineRoutes } from './index.js';
import { startFakeGatewayServer, type FakeGatewayServer } from '../test-fake-gateway.js';
import { postAndAwaitRun } from './run-await.js';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];
const servers: FakeGatewayServer[] = [];
const savedEnv = { ...process.env };

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
  process.env = { ...savedEnv };
});

function completeSession(): InterviewSession {
  let session = startSession('w10-69');
  for (let i = 0; i < INTERVIEW_TOPICS.length; i += 1) {
    session = beginTopic(
      session,
      i,
      { id: 'founder', kind: 'human' },
      {
        nextQuestion: () => null,
        draftDeliverable: (topic) => `Draft content for ${topic.deliverableId}.`,
      },
    ).session;
  }
  return session;
}

const BLUEPRINT_INPUT = {
  sections: [{ heading: 'Overview', body: 'A demo project, no open forks.' }],
  openQuestions: [],
};

const TECHNICAL_SLATE_INPUT = {
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
};

const TICKET_DRAFTS = {
  tickets: [
    {
      id: 'T-1',
      type: 'task',
      title: 'Build the thing',
      writeScope: ['apps/demo/**'],
      dependsOn: [],
      acceptance: ['It works'],
      verify: 'pnpm test',
      ownPackage: 'apps/demo',
      importsWorkspacePackages: [],
      providesInterfaces: [],
      consumesInterfaces: [],
    },
  ],
};

/**
 * Builds a project + route server with NO `gatewayConfig` injected. `configure`
 * gets the project dir and the fake gateway's URL so a case can register a
 * provider/matrix exactly as the Providers & Models panel would.
 */
async function harness(
  configure?: (projectDir: string, gatewayUrl: string) => Promise<void>,
): Promise<{ app: FastifyInstance; projectId: string; server: FakeGatewayServer }> {
  const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1069-home-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1069-proj-'));
  dirs.push(fleetHome, projectDir);

  const server = await startFakeGatewayServer([
    JSON.stringify(BLUEPRINT_INPUT),
    JSON.stringify(TECHNICAL_SLATE_INPUT),
    JSON.stringify(TICKET_DRAFTS),
  ]);
  servers.push(server);

  await configure?.(projectDir, server.url);

  const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
    path: projectDir,
    mode: 'new',
  });

  const app = Fastify({ logger: false });
  registerPipelineRoutes(app, { home: fleetHome }); // <- no gatewayConfig
  await app.ready();
  apps.push(app);

  return { app, projectId: record.id, server };
}

// W10-58: the run is a background job now. `postAndAwaitRun` POSTs, polls the
// status route to a terminal state, and presents the old synchronous shape, so
// every assertion below still asserts what it was written to assert.
async function run(app: FastifyInstance, projectId: string) {
  return postAndAwaitRun(app, projectId, {
    interviewSession: completeSession(),
    blueprintTitle: 'Demo',
  });
}

describe('pipeline/run resolves the model PER PROJECT (W10-69)', () => {
  it('sends the model the matrix selects — not the env default', async () => {
    const { app, projectId, server } = await harness(async (dir, url) => {
      await putProviders(dir, [
        { id: 'lm-studio', kind: 'oai-compat', baseUrl: url, enabled: true },
      ]);
      await putModelMatrix(dir, [
          { role: 'coding-agent', taskType: 'reasoning', model: 'qwen3.6-35b-a3b', fallback: [] },
        ]);
    });
    process.env.DOKIMA_MODEL_ID = 'env-default-must-lose';

    const res = await run(app, projectId);

    expect(res.statusCode).toBe(201);
    // THE ASSERTION THIS TICKET EXISTS FOR: what went on the wire.
    expect(server.requests[0]?.model).toBe('qwen3.6-35b-a3b');
    expect(server.requests[0]?.model).not.toBe('env-default-must-lose');
  });

  it('sends a vendor-namespaced id intact — W10-60 reaching the wire at last', async () => {
    const { app, projectId, server } = await harness(async (dir, url) => {
      await putProviders(dir, [
        { id: 'lm-studio', kind: 'oai-compat', baseUrl: url, enabled: true },
      ]);
      await putModelMatrix(dir, [
          { role: 'coding-agent', taskType: 'reasoning', model: 'qwen/qwen3.5-9b', fallback: [] },
        ]);
    });

    const res = await run(app, projectId);

    expect(res.statusCode).toBe(201);
    expect(server.requests[0]?.model).toBe('qwen/qwen3.5-9b');
  });

  it('every sequential phase uses the selected model, not just the first', async () => {
    const { app, projectId, server } = await harness(async (dir, url) => {
      await putProviders(dir, [
        { id: 'lm-studio', kind: 'oai-compat', baseUrl: url, enabled: true },
      ]);
      await putModelMatrix(dir, [
          { role: 'coding-agent', taskType: 'reasoning', model: 'qwen3.6-35b-a3b', fallback: [] },
        ]);
    });

    await run(app, projectId);

    expect(server.requests.length).toBeGreaterThanOrEqual(3);
    for (const req of server.requests) {
      expect(req.model).toBe('qwen3.6-35b-a3b');
    }
  });

  it('a project with NO registry still falls back to the env target (C-1 first run)', async () => {
    process.env.DOKIMA_MODEL_ID = 'env-fallback-model';
    const server = await startFakeGatewayServer([
      JSON.stringify(BLUEPRINT_INPUT),
      JSON.stringify(TECHNICAL_SLATE_INPUT),
      JSON.stringify(TICKET_DRAFTS),
    ]);
    servers.push(server);
    process.env.DOKIMA_MODEL_BASE_URL = server.url;

    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1069-home-'));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1069-proj-'));
    dirs.push(fleetHome, projectDir);
    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
    });
    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, { home: fleetHome });
    await app.ready();
    apps.push(app);

    const res = await run(app, record.id);

    expect(res.statusCode).toBe(201);
    expect(server.requests[0]?.model).toBe('env-fallback-model');
  });

  it('an unbindable matrix row is a NAMED refusal, never a silent fallback to localhost', async () => {
    const { app, projectId, server } = await harness(async (dir, url) => {
      await putProviders(dir, [
        { id: 'box-a', kind: 'oai-compat', baseUrl: url, enabled: true },
        { id: 'box-b', kind: 'oai-compat', baseUrl: url, enabled: true },
      ]);
      // Two enabled providers and an unqualified model: genuinely ambiguous.
      await putModelMatrix(dir, [
          { role: 'coding-agent', taskType: 'reasoning', model: 'some-model', fallback: [] },
        ]);
    });

    const res = await run(app, projectId);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ rule: 'MODEL_RESOLUTION' });
    expect(server.requests).toHaveLength(0); // never quietly called anything
  });

  it('an explicit gatewayConfig still wins — the documented CI/e2e seam (Law 9)', async () => {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1069-home-'));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1069-proj-'));
    dirs.push(fleetHome, projectDir);
    const server = await startFakeGatewayServer([
      JSON.stringify(BLUEPRINT_INPUT),
      JSON.stringify(TECHNICAL_SLATE_INPUT),
      JSON.stringify(TICKET_DRAFTS),
    ]);
    servers.push(server);

    await putProviders(projectDir, [
      { id: 'lm-studio', kind: 'oai-compat', baseUrl: server.url, enabled: true },
    ]);
    await putModelMatrix(projectDir, [
        { role: 'coding-agent', taskType: 'reasoning', model: 'registry-model-must-lose', fallback: [] },
      ]);

    const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
      path: projectDir,
      mode: 'new',
    });
    const app = Fastify({ logger: false });
    registerPipelineRoutes(app, {
      home: fleetHome,
      gatewayConfig: { baseUrl: server.url, model: 'injected-fake-model' },
    });
    await app.ready();
    apps.push(app);

    const res = await run(app, record.id);

    expect(res.statusCode).toBe(201);
    expect(server.requests[0]?.model).toBe('injected-fake-model');
  });
});
