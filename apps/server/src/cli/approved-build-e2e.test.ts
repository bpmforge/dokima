/**
 * W23-16 (AB-16). The whole workflow, through the entrance a person uses.
 *
 * Every card from AB-11 on proved its piece at the seam it owns, with the
 * review and the maker injected. That is the right way to prove a decision
 * table and the wrong way to prove a workflow: a chain of correct components
 * can still be wired to nothing, which is the exact defect this wave has found
 * four times (`resolvePauseAction`, `decideApprovedBuildAction`,
 * `recordApprovedBuild`, `runPhaseGate`).
 *
 * So this drives `executeBuildRun` — the same function the CLI and the HTTP
 * job both call — over a real git repository, with real worktrees, the real
 * close gate, the real review pass, the real security registry and the real
 * acceptance policy. What is faked is exactly what AB-16 step 2 permits:
 * the external MODEL process (a local HTTP fixture; Law 9a forbids a live
 * call) and the external TOOL processes (a scanner binary on PATH). Nothing
 * mocks the orchestrator into returning done.
 */

import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents } from '@dokima/events';
import { createTicket, getTicket } from '@dokima/tickets';
import { git } from '@dokima/git';
import { openWritableLog, resolveDbPath } from './db.js';
import { executeBuildRun } from './run-build.js';
import { executeBuildRunJob } from '../api/server/runs-job.js';
import { readBuildRunState } from '../api/server/approved-build-run-state.js';
import { recordApprovedBuild, approvedBuildRunInputs } from './approved-build.js';
import { collectIO, createTempProject, type TempProject } from './test-helpers.js';
import { writeProjectSetting } from '@dokima/shared';
import { AGENT_RUNNER_SETTINGS_KEY } from '../api/server/settings-types.js';

const TIMEOUT_MS = 120_000;
const NOW = () => '2026-09-08T00:00:00.000Z';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A real repository with a real first commit — worktrees fork from it. */
async function repo(): Promise<TempProject> {
  const project = await createTempProject();
  cleanups.push(project.cleanup);
  await git(project.cwd, ['init', '-b', 'main']);
  await git(project.cwd, ['config', 'user.email', 'demo@dokima.local']);
  await git(project.cwd, ['config', 'user.name', 'Demo']);
  await fs.mkdir(path.join(project.cwd, 'src'), { recursive: true });
  await fs.writeFile(path.join(project.cwd, 'src/app.ts'), 'export const answer = 0;\n');
  await git(project.cwd, ['add', '-A']);
  await git(project.cwd, ['commit', '-m', 'initial']);
  return project;
}

/**
 * An external agent that lands one ticket per invocation, writing a file named
 * after the ticket it was handed. Nothing about it is a model: the maker model
 * is therefore `external-agent`, which is what lets the reviewer below be a
 * DIFFERENT model without a settings matrix — C-4 compares the two names.
 */
async function writeAgent(dir: string, body?: readonly string[]): Promise<string> {
  const file = path.join(dir, 'agent.sh');
  await fs.writeFile(
    file,
    body
      ? body.join('\n')
      : [
          '#!/usr/bin/env bash',
          'set -eu',
          'TICKET="$(printf "%s" "$1" | grep -oE "T-[0-9]+" | head -1)"',
          'mkdir -p "src/$TICKET"',
          // A DIFFERENT tree on every attempt. Writing identical bytes makes
          // `git commit` fail with "nothing to commit", which reads downstream as
          // an agent that attempted nothing — a fixture artefact that looks
          // exactly like a real park.
          'ATTEMPT="$(git rev-list --count HEAD)"',
          'printf "export const %s = 42; // attempt %s\\n" "answer_${TICKET//-/_}" "$ATTEMPT" > "src/${TICKET}/index.ts"',
          'git add -A >/dev/null',
          'git -c user.email=a@b.c -c user.name=agent commit -qm "${TICKET}: done"',
          'SHA="$(git rev-parse HEAD)"',
          // The manifest, printed by the shell so the ticket id and the sha are
          // the ones this invocation actually used.
          'printf \'{"ticket":"%s","files":["src/%s/index.ts"],"verify":{"command":"true","exit":0},"commits":["%s"],"evidence":["e"],"memory_written":["m"]}\\n\' "$TICKET" "$TICKET" "$SHA"',
          '',
        ].join('\n'),
  );
  await fs.chmod(file, 0o755);
  return file;
}

/**
 * A scanner binary that answers cleanly, put on PATH for the run.
 *
 * THIS IS THE FAKE AB-16 STEP 2 PERMITS, and it is worth naming precisely:
 * `semgrep` is not installed on this machine or in CI, so the real registry
 * reports `tool-sast: unavailable`, every required check fails, and NOTHING
 * can be machine-accepted. That is correct behaviour — an outage is not a
 * defect, and W23-11 parks on it — and it also means the acceptance path
 * cannot be exercised anywhere without a binary present. The adapter, its
 * exit-code interpretation and its sandboxing are all real; only the
 * executable is ours. The REAL scanner is covered by W23-04's opt-in smoke
 * test (`DOKIMA_TEST_REAL_SCANNERS=1`).
 */
async function fakeScannerOnPath(dir: string): Promise<string> {
  const bin = path.join(dir, 'fake-bin');
  await fs.mkdir(bin, { recursive: true });
  const semgrep = path.join(bin, 'semgrep');
  await fs.writeFile(
    semgrep,
    ['#!/usr/bin/env bash', 'echo \'{"results":[],"errors":[]}\'', 'exit 0', ''].join(
      '\n',
    ),
  );
  await fs.chmod(semgrep, 0o755);
  return bin;
}

/** The model endpoint: an OpenAI-compatible fixture with a scripted reply queue. */
async function fakeModel(replies: string[]): Promise<{
  url: string;
  prompts: string[];
  close: () => Promise<void>;
}> {
  const prompts: string[] = [];
  let nth = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      prompts.push(Buffer.concat(chunks).toString('utf8'));
      const content = replies[Math.min(nth, replies.length - 1)] ?? '';
      nth += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-ab16',
          model: 'local-model',
          choices: [
            { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture did not bind');
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  cleanups.push(close);
  return { url: `http://127.0.0.1:${address.port}/v1`, prompts, close };
}

/** The reviewer's wire shape, as `parseVerdict` actually reads it: JSON. */
const VERDICT = (verdict: string) =>
  JSON.stringify({ verdict, score: 9, reasoning: 'what the ticket asked for' });

interface RunOptions {
  readonly tickets: readonly { id: string; dependsOn?: readonly string[] }[];
  readonly replies: string[];
  readonly withScanner?: boolean;
  readonly approve?: boolean;
  readonly mutateAfterApproval?: (dbPath: string) => void;
  readonly berths?: number;
  /**
   * Which door. `cli` calls `executeBuildRun` the way `dokima run` does; `http`
   * goes through `executeBuildRunJob`, the function the POST route dispatches,
   * which is also where W23-13's durable run state is written.
   */
  readonly entrance?: 'cli' | 'http';
  /** Replaces the agent script body, for scenarios about a maker that cannot finish. */
  readonly agentBody?: readonly string[];
}

/** One complete run through the real entry point. Returns everything a scenario asserts on. */
async function runBuild(options: RunOptions) {
  const project = await repo();
  const agent = await writeAgent(project.cwd, options.agentBody);
  const model = await fakeModel(options.replies);
  const bin = options.withScanner === false ? null : await fakeScannerOnPath(project.cwd);

  /**
   * A settings file that makes no local-only choice. `networkPolicyOf` reads
   * a MISSING file as local-only (a first run has chosen nothing, and the
   * conservative reading is the one that cannot surprise), so a fixture that
   * wants the SAST check to run has to say so — exactly as a user would.
   */
  await fs.mkdir(path.join(project.cwd, '.dokima'), { recursive: true });
  await fs.writeFile(
    path.join(project.cwd, '.dokima', 'settings.json'),
    JSON.stringify({ 'modelPolicy.localOnly': false }),
  );

  const dbPath = resolveDbPath(project.cwd);
  const log = openWritableLog(dbPath);
  createIdentity(log, { id: 'worker-1', name: 'worker-1', kind: 'machine' });
  for (const ticket of options.tickets) {
    createTicket(log, 'worker-1', {
      id: ticket.id,
      type: 'task',
      title: `Ticket ${ticket.id}`,
      lane: ticket.id,
      writeScope: [`src/${ticket.id}/**`],
      verify: 'true',
      dependsOn: [...(ticket.dependsOn ?? [])],
      acceptance: [{ id: 'AC-1', text: 'it works', done: false }],
    });
  }
  if (options.approve !== false) {
    recordApprovedBuild(log, {
      actorId: 'worker-1',
      ...approvedBuildRunInputs({ projectId: 'p', budgetUsd: 0 }),
    });
  }
  options.mutateAfterApproval?.(dbPath);

  const env = {
    DOKIMA_SIGNING_KEY: process.env.DOKIMA_SIGNING_KEY,
    DOKIMA_MODEL_BASE_URL: process.env.DOKIMA_MODEL_BASE_URL,
    PATH: process.env.PATH,
  };
  process.env.DOKIMA_SIGNING_KEY = 'test-signing-key-ab16';
  process.env.DOKIMA_MODEL_BASE_URL = model.url;
  if (bin) process.env.PATH = `${bin}:${process.env.PATH ?? ''}`;
  const io = collectIO();
  try {
    if (options.entrance === 'http') {
      // The HTTP job takes no agent-command argument — the runner is a project
      // SETTING, which is how a real installation configures it.
      await writeProjectSetting(project.cwd, {
        key: AGENT_RUNNER_SETTINGS_KEY,
        value: { kind: 'external', command: agent },
        actorId: 'worker-1',
      });
      // The HTTP door: the same job the route dispatches, with its own durable
      // start/outcome record. It opens the log itself, so ours is closed first.
      log.close();
      await executeBuildRunJob({
        projectPath: project.cwd,
        projectId: 'p',
        actorId: 'worker-1',
        runId: 'run-ab16',
        now: NOW,
        approvedBuild: true,
        budgetUsd: null,
      });
      const reopened = openWritableLog(dbPath);
      cleanups.push(async () => reopened.close());
      return {
        exitCode: 0,
        log: reopened,
        project,
        io,
        prompts: model.prompts,
        ticket: (id: string) => getTicket(reopened, id),
        events: () => listEvents(reopened),
      };
    }
    const exitCode = await executeBuildRun(
      log,
      {
        projectId: 'p',
        actorId: 'worker-1',
        agentCommand: agent,
        approvedBuild: true,
        ...(options.berths ? { berths: options.berths } : {}),
      },
      'run-ab16',
      { cwd: project.cwd, ...io.io, now: NOW },
    );
    return {
      exitCode,
      log,
      project,
      io,
      prompts: model.prompts,
      ticket: (id: string) => getTicket(log, id),
      events: () => listEvents(log),
    };
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    cleanups.push(async () => log.close());
  }
}

describe('the approved build, through the entrance a person uses', () => {
  it(
    'a rejected ticket is repaired and accepted with nobody in the room, and main never moves',
    async () => {
      // The reviewer CONTRADICTS the first attempt and CONFIRMS the repair.
      const result = await runBuild({
        tickets: [{ id: 'T-1' }],
        replies: [VERDICT('CONTRADICTED'), VERDICT('CONFIRMED'), VERDICT('CONFIRMED')],
      });
      expect(result.exitCode).toBe(0);

      const types = result.events().map((e) => e.eventType);
      expect(types).toContain('review.verdict');
      expect(types).toContain('ticket.rejected');
      expect(types).toContain('build.repair.round');
      expect(types).toContain('build.accept.decided');

      const rejects = result.events().filter((e) => e.eventType === 'ticket.rejected');
      expect(rejects[0]?.actorId).toBe('machine-reviewer');
      // The point of the whole wave: the ticket is DONE, and no person acted.
      expect(result.ticket('T-1')?.status).toBe('done');
      const accepts = result
        .events()
        .filter((e) => e.eventType === 'ticket.accepted')
        .map((e) => e.actorId);
      expect(accepts).toEqual(['machine-reviewer']);

      // And the trunk is untouched: an acceptance is not a merge (C-5).
      const head = await git(result.project.cwd, ['rev-parse', 'main']);
      const log = await git(result.project.cwd, ['log', '--oneline', 'main']);
      expect(log.stdout.trim().split('\n')).toHaveLength(1);
      expect(head.stdout.trim()).toBeTruthy();
    },
    TIMEOUT_MS,
  );

  it(
    'three dependent tickets and one independent one finish in ONE run, in dependency order',
    async () => {
      const result = await runBuild({
        tickets: [
          { id: 'T-1' },
          { id: 'T-2', dependsOn: ['T-1'] },
          { id: 'T-3', dependsOn: ['T-2'] },
          { id: 'T-9' },
        ],
        replies: [VERDICT('CONFIRMED')],
      });
      expect(result.exitCode).toBe(0);
      for (const id of ['T-1', 'T-2', 'T-3', 'T-9']) {
        expect([id, result.ticket(id)?.status]).toEqual([id, 'done']);
      }
      // Dependency order, from the ledger rather than from the loop's own
      // account of itself: T-2 could not be claimed before T-1 was accepted.
      const seq = result
        .events()
        .filter(
          (e) => e.eventType === 'ticket.claimed' || e.eventType === 'ticket.accepted',
        )
        .map((e) => `${e.eventType}:${e.ticketId}`);
      expect(seq.indexOf('ticket.accepted:T-1')).toBeLessThan(
        seq.indexOf('ticket.claimed:T-2'),
      );
      expect(seq.indexOf('ticket.accepted:T-2')).toBeLessThan(
        seq.indexOf('ticket.claimed:T-3'),
      );
      // And every acceptance is the machine's, with no human acting at all.
      const humanVerbs = result
        .events()
        .filter((e) => e.eventType === 'ticket.accepted')
        .map((e) => e.actorId);
      expect(new Set(humanVerbs)).toEqual(new Set(['machine-reviewer']));
    },
    TIMEOUT_MS,
  );

  it(
    'the BERTH path accepts identically to the sequential one (W23-12 acceptance 4)',
    async () => {
      const result = await runBuild({
        // Independent tickets, so two berths can genuinely run at once.
        tickets: [{ id: 'T-1' }, { id: 'T-2' }],
        replies: [VERDICT('CONFIRMED')],
        berths: 2,
      });
      expect(result.exitCode).toBe(0);
      expect(result.ticket('T-1')?.status).toBe('done');
      expect(result.ticket('T-2')?.status).toBe('done');
      // The post-close seam ran inside the berth engine, not after it: the
      // acceptance for each ticket is recorded before the run ends, by the
      // machine reviewer, exactly as on the sequential path.
      const decided = result
        .events()
        .filter((e) => e.eventType === 'build.accept.decided')
        .map((e) => (e.payload as { accepted?: boolean }).accepted);
      expect(decided.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    },
    TIMEOUT_MS,
  );

  it(
    'RED FIXTURE: with no scanner installed nothing is accepted, and the reason is the outage — not a defect',
    async () => {
      const result = await runBuild({
        tickets: [{ id: 'T-1' }],
        replies: [VERDICT('CONFIRMED')],
        withScanner: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.ticket('T-1')?.status).toBe('in_review');
      const decided = result
        .events()
        .filter((e) => e.eventType === 'build.accept.decided')
        .map((e) => e.payload as { accepted?: boolean; ruleId?: string });
      expect(decided.length).toBeGreaterThan(0);
      expect(decided.every((d) => d.accepted === false)).toBe(true);
      // The rule that fired names the outage, not the code.
      expect(decided[0]?.ruleId).toBe('accept-required-check-failed');
      // The work is retained: the close receipt is still in the ledger.
      expect(result.events().some((e) => e.eventType === 'ticket.closed')).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'the HTTP door reaches the same end, and records a VERIFIED run rather than merely exit 0',
    async () => {
      const result = await runBuild({
        tickets: [{ id: 'T-1' }],
        replies: [VERDICT('CONFIRMED')],
        entrance: 'http',
      });
      const state = readBuildRunState(result.log, 'run-ab16');
      expect(result.ticket('T-1')?.status).toBe('done');
      // W23-13: exit 0 alone was never the claim. Everything this run landed
      // was verified and accepted, and the record says which of the five
      // outcomes that is.
      expect(state?.outcome).toBe('verified');
      expect(state?.approvedBuild).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'RED FIXTURE: a run whose work still needs a person records AWAITING DECISION, not done',
    async () => {
      const result = await runBuild({
        tickets: [{ id: 'T-1' }],
        replies: [VERDICT('CONFIRMED')],
        withScanner: false,
        entrance: 'http',
      });
      expect(result.ticket('T-1')?.status).toBe('in_review');
      expect(readBuildRunState(result.log, 'run-ab16')?.outcome).toBe(
        'awaiting_decision',
      );
    },
    TIMEOUT_MS,
  );

  it(
    'RED FIXTURE: a run that PARKED everything is not "verified" — a parked ticket needs a person too',
    async () => {
      const result = await runBuild({
        tickets: [{ id: 'T-1' }],
        replies: [VERDICT('CONFIRMED')],
        entrance: 'http',
        // An agent that cannot produce a manifest: the ticket parks and is
        // released to `ready`, so nothing is left `in_review` and the run
        // reported "every ticket this run landed was verified and accepted" —
        // true only because it landed none.
        agentBody: ['#!/usr/bin/env bash', 'echo "I could not do it"', 'exit 0', ''],
      });
      expect(result.ticket('T-1')?.status).toBe('ready');
      expect(readBuildRunState(result.log, 'run-ab16')?.outcome).toBe(
        'awaiting_decision',
      );
    },
    TIMEOUT_MS,
  );

  it(
    'RED FIXTURE: an approval that no longer matches the specification refuses BEFORE anything is claimed',
    async () => {
      const result = await runBuild({
        tickets: [{ id: 'T-1' }],
        replies: [VERDICT('CONFIRMED')],
        mutateAfterApproval: (dbPath) => {
          // A second ticket after the approval changes what was approved.
          const log = openWritableLog(dbPath);
          try {
            createTicket(log, 'worker-1', {
              id: 'T-9',
              type: 'task',
              title: 'Snuck in after the approval',
              lane: 'later',
              writeScope: ['src/T-9/**'],
              verify: 'true',
              acceptance: [{ id: 'AC-1', text: 'it works', done: false }],
            });
          } finally {
            log.close();
          }
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.io.stderr.join('\n')).toMatch(/approved build inputs changed/);
      // Nothing was claimed: the tickets are exactly as they were.
      expect(result.ticket('T-1')?.status).toBe('ready');
      expect(result.events().some((e) => e.eventType === 'ticket.claimed')).toBe(false);
    },
    TIMEOUT_MS,
  );
});
