/**
 * W10-58 acceptance 6, the red fixture: with a deliberately slow provider, the
 * route must return promptly with a run id AND phase events must land
 * afterwards. "A test that only checks the fast path would pass today and prove
 * nothing."
 *
 * NOTHING HERE IS TIMED. A wall-clock threshold ("responded in under 200ms")
 * would be exactly the flaky-on-a-loaded-host assertion this repo has spent
 * days diagnosing — and it would also be weaker, since a synchronous route on a
 * fast fake provider could satisfy it. Instead the slow provider blocks on a
 * promise this test owns, so "returned before the work finished" is a
 * happens-before fact: the response is asserted while `release` has provably
 * not been called. That fails deterministically against the old synchronous
 * route no matter how fast or loaded the machine is.
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
import { openEventLog, listEvents } from '@dokima/events';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProject } from '../../projects.js';
import { stateDbPath } from '../../server/board-project.js';
import { registerPipelineRoutes } from './index.js';
import type { RealGatewayPort } from '../gateway-model-port.js';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function completeSession(): InterviewSession {
  let session = startSession('w10-58');
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

interface SlowPort {
  readonly port: RealGatewayPort;
  /** Resolves once the blueprint call has been ENTERED — proves the job started. */
  readonly entered: Promise<void>;
  release: () => void;
  released: boolean;
  /** Rejects the SECOND call instead of resolving it, to exercise partial-progress persistence. */
  failAfterBlueprint?: boolean;
}

function slowPort(opts: { failAfterBlueprint?: boolean } = {}): SlowPort {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });

  const state: SlowPort = {
    entered,
    released: false,
    release: () => {
      state.released = true;
      release();
    },
    failAfterBlueprint: opts.failAfterBlueprint,
    port: {
      resolveBlueprintInput: async () => {
        markEntered();
        await gate;
        return BLUEPRINT_INPUT as never;
      },
      resolveTechnicalSlateInput: async () => {
        if (opts.failAfterBlueprint) {
          throw new Error('provider exploded during the technical slate');
        }
        return TECHNICAL_SLATE_INPUT as never;
      },
      resolveTicketDrafts: async () => TICKET_DRAFTS.tickets as never,
    } as unknown as RealGatewayPort,
  };
  return state;
}

async function harness(port: RealGatewayPort) {
  const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1058-home-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1058-proj-'));
  dirs.push(fleetHome, projectDir);

  const record = await registerProject(path.join(fleetHome, 'fleet.json'), {
    path: projectDir,
    mode: 'new',
  });

  const app = Fastify({ logger: false });
  registerPipelineRoutes(app, {
    home: fleetHome,
    modelPortFactory: async () => port,
  });
  await app.ready();
  apps.push(app);
  return { app, projectId: record.id, projectDir };
}

function start(app: FastifyInstance, projectId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/pipeline/run`,
    payload: { interviewSession: completeSession(), blueprintTitle: 'Demo' },
  });
}

async function pollUntil(
  app: FastifyInstance,
  projectId: string,
  runId: string,
  done: (status: string) => boolean,
) {
  for (let i = 0; i < 2000; i += 1) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/pipeline/runs/${runId}`,
    });
    const body = res.json() as { status: string };
    if (done(body.status)) return body as never;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error(`run ${runId} never reached the expected state`);
}

describe('the creation run is a job, not a held request (W10-58)', () => {
  it('THE RED FIXTURE: responds with a run id while the provider is still blocked', async () => {
    const slow = slowPort();
    const { app, projectId } = await harness(slow.port);

    const res = await start(app, projectId);

    // The load-bearing assertion. The provider has not been released, so under
    // the old synchronous route this response could not exist yet.
    expect(slow.released).toBe(false);
    expect(res.statusCode).toBe(202);
    const { run_id: runId, status } = res.json() as {
      run_id: string;
      status: string;
    };
    expect(status).toBe('running');
    expect(runId).toMatch(/^[0-9a-f-]{36}$/i);

    // ...and the job really is running behind it, rather than the route having
    // simply skipped the work.
    await slow.entered;
    const running = await pollUntil(app, projectId, runId, (s) => s === 'running');
    expect((running as unknown as { status: string }).status).toBe('running');

    slow.release();

    const finished = (await pollUntil(
      app,
      projectId,
      runId,
      (s) => s === 'completed' || s === 'failed',
    )) as unknown as {
      status: string;
      phases: { name: string }[];
      result: { plan_items: unknown[] };
    };
    expect(finished.status).toBe('completed');
    // Phase completions landed AFTER the response — acceptance 6's second half.
    expect(finished.phases.map((p) => p.name)).toEqual([
      'blueprint',
      'technical-slate',
      'ticket-drafts',
      'board',
    ]);
    expect(finished.result.plan_items.length).toBeGreaterThan(0);
  });

  it('appends a hash-chained progress event per model-authored stage', async () => {
    const slow = slowPort();
    const { app, projectId, projectDir } = await harness(slow.port);
    const { run_id: runId } = (await start(app, projectId)).json() as {
      run_id: string;
    };
    slow.release();
    await pollUntil(app, projectId, runId, (s) => s === 'completed');

    const log = openEventLog(stateDbPath(projectDir));
    try {
      const stageEvents = listEvents(log).filter(
        (e) => e.eventType === 'pipeline.stage.completed',
      );
      expect(stageEvents).toHaveLength(3);
      // A progress marker is never a gate receipt (Law 4/5) — nothing verified
      // this output, so nothing may attest it.
      expect(
        listEvents(log).filter((e) => e.eventType === 'gate.receipt_minted'),
      ).toHaveLength(0);
    } finally {
      log.close();
    }
  });

  it('refuses a second concurrent run on the same project, naming the one in flight', async () => {
    const slow = slowPort();
    const { app, projectId } = await harness(slow.port);
    const first = (await start(app, projectId)).json() as { run_id: string };
    await slow.entered;

    const second = await start(app, projectId);
    expect(second.statusCode).toBe(409);
    expect((second.json() as { detail: string }).detail).toContain(first.run_id);

    slow.release();
    await pollUntil(
      app,
      projectId,
      projectId ? first.run_id : '',
      (s) => s === 'completed',
    );
  });

  it('KEEPS what it already paid for when a later stage fails (acceptance 5)', async () => {
    const slow = slowPort({ failAfterBlueprint: true });
    const { app, projectId, projectDir } = await harness(slow.port);
    const { run_id: runId } = (await start(app, projectId)).json() as {
      run_id: string;
    };
    slow.release();

    const failed = (await pollUntil(
      app,
      projectId,
      runId,
      (s) => s === 'failed',
    )) as unknown as { status: string; phases: { name: string }[] };
    expect(failed.status).toBe('failed');
    expect(failed.phases.map((p) => p.name)).toEqual(['blueprint']);

    // The expensive, model-authored blueprint input survives on disk, so a
    // resume does not pay for that call again. Before this ticket a phase-3
    // failure discarded everything.
    const raw = await fs.readFile(
      path.join(projectDir, '.dokima', 'runs', `${runId}.json`),
      'utf8',
    );
    const record = JSON.parse(raw) as { blueprintInput?: unknown; status: string };
    expect(record.status).toBe('failed');
    expect(record.blueprintInput).toBeDefined();
  });

  it('a resume against a FAILED run is a 404, not a crash', async () => {
    // W10-58 regression: `runs/<id>.json` used to exist only for a paused run,
    // so `loadPausedRun`'s "has a blueprintInput" check was equivalent to "is
    // paused". Now a failed (or completed) run persists a blueprintInput too and
    // has no `slateIdsByKey`, so that predicate would hand `applyDecisions` a
    // record whose `Object.entries(paused.slateIdsByKey)` throws — a 500 where a
    // 404 belongs, reachable on two of the four terminal statuses.
    const slow = slowPort({ failAfterBlueprint: true });
    const { app, projectId } = await harness(slow.port);
    const { run_id: runId } = (await start(app, projectId)).json() as {
      run_id: string;
    };
    slow.release();
    await pollUntil(app, projectId, runId, (s) => s === 'failed');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/pipeline/${runId}/resume`,
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(404);
  });
});
