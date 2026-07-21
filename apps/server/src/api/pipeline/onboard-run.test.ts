import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { listEvents } from '@shipwright/events';
import { getTicket, listTickets } from '@shipwright/tickets';
import { openWritableLog, resolveDbPath } from '../../cli/db.js';
import { resetLoopModuleCacheForTests } from './onboard-dispatch-port.js';
import { runOnboardAnalysis } from './onboard-run.js';
import { startFakeGatewayServer, type FakeGatewayServer } from './test-fake-gateway.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

interface TempRepo {
  repoRoot: string;
  cleanup: () => Promise<void>;
}

async function createTempRepo(): Promise<TempRepo> {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'shipwright-onboard-run-test-'),
  );
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return { repoRoot, cleanup: () => fs.rm(repoRoot, { recursive: true, force: true }) };
}

const NOW = () => '2026-07-21T00:00:00.000Z';

const COMPLETION_WITH_FINDING = {
  summary: 'Reviewed.',
  findings: [
    {
      title: 'Missing docs',
      severity: 'MEDIUM',
      recommendation: 'Add docs.',
      verify: 'true',
    },
  ],
};

describe('runOnboardAnalysis (W8-09 — full onboard/analysis run, real gateway + real runSession, no network)', () => {
  let repo: TempRepo | undefined;
  let server: FakeGatewayServer | undefined;

  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
    await server?.close();
    server = undefined;
    resetLoopModuleCacheForTests();
  });

  it('runs all 16 real steps against the fake-model gateway, persists a run_completed event with the coverage manifest, and turns every finding into an accepted board ticket', async () => {
    repo = await createTempRepo();
    server = await startFakeGatewayServer([JSON.stringify(COMPLETION_WITH_FINDING)]);

    const dbPath = resolveDbPath(repo.repoRoot);
    const log = openWritableLog(dbPath);
    try {
      const outcome = await runOnboardAnalysis({
        log,
        runId: 'run-onboard-1',
        projectPath: repo.repoRoot,
        now: NOW,
        gatewayConfig: { baseUrl: server.url, model: 'local-model', fetchImpl: fetch },
      });

      // AC3(c): every model call went through the fake HTTP server, never a real network call.
      expect(server.requests).toHaveLength(16);

      expect(Object.keys(outcome.result.stepArtifacts)).toHaveLength(16);
      expect(outcome.result.coverageManifest.antiSlopRules).toHaveLength(30);

      // AC1: emit wired to append-only events.
      const events = listEvents(log);
      const stepCompleteEvents = events.filter(
        (e) => e.eventType === 'onboard.step-complete',
      );
      expect(stepCompleteEvents).toHaveLength(16);
      const runCompletedEvent = events.find(
        (e) => e.eventType === 'onboard.run_completed',
      );
      expect(runCompletedEvent).toBeDefined();
      expect(
        (runCompletedEvent?.payload as { coverageManifest: { antiSlopRules: unknown[] } })
          .coverageManifest.antiSlopRules,
      ).toHaveLength(30);

      // AC2: findings become board items through the existing plans lifecycle —
      // one finding per step (16 identical-shape completions, distinct stepId/role
      // per catalogId hash) -> 16 accepted plan items, all with a real minted ticket.
      expect(outcome.proposed).toHaveLength(16);
      expect(outcome.accepted).toHaveLength(16);
      expect(outcome.accepted.every((a) => a.ticketCreated)).toBe(true);

      const tickets = listTickets(log);
      expect(tickets).toHaveLength(16);

      // AC3(b): maker != verifier — every ticket-creating event is signed by the
      // operator identity, never by any of the specialist identities that produced
      // the underlying findings.
      const ticketCreatedEvents = events.filter((e) => e.eventType === 'ticket.created');
      expect(ticketCreatedEvents).toHaveLength(16);
      for (const e of ticketCreatedEvents) {
        expect(e.actorId).toBe('operator');
        expect(e.actorId.startsWith('specialist:')).toBe(false);
      }
      const specialistSignedEvents = stepCompleteEvents.filter((e) =>
        e.actorId.startsWith('specialist:'),
      );
      expect(specialistSignedEvents).toHaveLength(16);

      // First ticket sanity check — real board state, not a re-derivation.
      const firstTicket = getTicket(log, tickets[0]!.id);
      expect(firstTicket).toBeDefined();
    } finally {
      log.close();
    }
  });

  it('all-or-nothing: a real dispatch failure means no run_completed event and no plan items at all', async () => {
    repo = await createTempRepo();
    // Every call after the first returns a malformed (non-JSON) completion,
    // simulating a mid-run specialist failure.
    server = await startFakeGatewayServer([
      JSON.stringify(COMPLETION_WITH_FINDING),
      'not json',
    ]);

    const dbPath = resolveDbPath(repo.repoRoot);
    const log = openWritableLog(dbPath);
    try {
      await expect(
        runOnboardAnalysis({
          log,
          runId: 'run-onboard-2',
          projectPath: repo.repoRoot,
          now: NOW,
          gatewayConfig: { baseUrl: server.url, model: 'local-model', fetchImpl: fetch },
        }),
      ).rejects.toThrow();

      const events = listEvents(log);
      expect(events.some((e) => e.eventType === 'onboard.run_completed')).toBe(false);
      expect(listTickets(log)).toHaveLength(0);
    } finally {
      log.close();
    }
  });
});
