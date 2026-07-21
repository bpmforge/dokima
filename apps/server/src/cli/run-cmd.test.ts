import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  listEvents,
  mintReceipt,
  type EventLog,
} from '@shipwright/events';
import { claimTicket, createTicket, listTickets, startTicket } from '@shipwright/tickets';
import { createWorktree, git } from '@shipwright/git';
import { resetLoopModuleCacheForTests } from '../api/pipeline/onboard-dispatch-port.js';
import {
  startFakeGatewayServer,
  type FakeGatewayServer,
} from '../api/pipeline/test-fake-gateway.js';
import { openWritableLog, resolveDbPath } from './db.js';
import { runCli } from './run.js';
import { collectIO, createTempProject, type TempProject } from './test-helpers.js';

const NOW = () => '2026-07-18T00:00:00.000Z';

describe('shipwright run (FR-C7 — CLI drives the same @shipwright/harbormaster verbs a route would)', () => {
  let project: TempProject;
  let server: FakeGatewayServer | undefined;
  const envKeysToRestore = [
    'SHIPWRIGHT_MODEL_BASE_URL',
    'SHIPWRIGHT_MODEL_API_KEY',
    'SHIPWRIGHT_MODEL_ID',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(async () => {
    await project?.cleanup();
    await server?.close();
    server = undefined;
    resetLoopModuleCacheForTests();
    for (const key of envKeysToRestore) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
      delete savedEnv[key];
    }
  });

  it('start -> pause -> resume -> stop, each printed as "<runId> <verb> -> <status>"', async () => {
    project = await createTempProject();
    const cwd = project.cwd;

    const start = collectIO();
    const startCode = await runCli(
      [
        'run',
        'start',
        '--project',
        'proj-1',
        '--mode',
        'feature',
        '--breakpoint',
        'wave',
        '--berths',
        '2',
        '--actor',
        'operator-1',
      ],
      { cwd, now: NOW, ...start.io },
    );
    expect(startCode).toBe(0);
    expect(start.stdout[0]).toMatch(
      /^run-.* started -> running \(breakpoint=wave berths=2\)$/,
    );
    const runId = start.stdout[0]?.split(' ')[0];
    expect(runId).toBeTruthy();

    const pause = collectIO();
    expect(
      await runCli(['run', 'pause', runId!, '--actor', 'operator-1'], {
        cwd,
        now: NOW,
        ...pause.io,
      }),
    ).toBe(0);
    expect(pause.stdout[0]).toBe(`${runId} pause -> paused`);

    const resume = collectIO();
    expect(
      await runCli(
        ['run', 'resume', runId!, '--actor', 'operator-1', '--signing-key', 'test-key'],
        { cwd, now: NOW, ...resume.io },
      ),
    ).toBe(0);
    expect(resume.stdout[0]).toBe(`${runId} resume -> ok (closed=0 skipped=0)`);

    const stop = collectIO();
    expect(
      await runCli(['run', 'stop', runId!, '--actor', 'operator-1'], {
        cwd,
        now: NOW,
        ...stop.io,
      }),
    ).toBe(0);
    expect(stop.stdout[0]).toBe(`${runId} stop -> stopped`);
  });

  it('start --mode onboard actually runs a real onboard/analysis run (W8-09) — real gateway + real runSession, findings become board tickets', async () => {
    project = await createTempProject();
    const cwd = project.cwd;
    await git(cwd, ['init', '-b', 'main']);
    await git(cwd, ['config', 'user.name', 'Shipwright Test']);
    await git(cwd, ['config', 'user.email', 'test@shipwright.invalid']);
    await fs.writeFile(`${cwd}/README.md`, '# fixture\n');
    await git(cwd, ['add', '--', 'README.md']);
    await git(cwd, ['commit', '-m', 'chore: initial commit']);

    server = await startFakeGatewayServer([
      JSON.stringify({
        summary: 'Reviewed.',
        findings: [
          {
            title: 'Missing docs',
            severity: 'MEDIUM',
            recommendation: 'Add docs.',
            verify: 'true',
          },
        ],
      }),
    ]);
    savedEnv.SHIPWRIGHT_MODEL_BASE_URL = process.env.SHIPWRIGHT_MODEL_BASE_URL;
    process.env.SHIPWRIGHT_MODEL_BASE_URL = server.url;

    const start = collectIO();
    const startCode = await runCli(
      [
        'run',
        'start',
        '--project',
        'proj-onboard',
        '--mode',
        'onboard',
        '--breakpoint',
        'never',
        '--actor',
        'operator-1',
      ],
      { cwd, now: NOW, ...start.io },
    );

    expect(startCode).toBe(0);
    expect(start.stdout[0]).toMatch(/^run-.* started -> running/);
    expect(start.stdout[1]).toMatch(
      /onboard analysis complete: 16 steps, 16 findings proposed, 16 accepted onto the board/,
    );
    expect(server.requests).toHaveLength(16);

    const log = openWritableLog(resolveDbPath(cwd));
    try {
      expect(listTickets(log)).toHaveLength(16);
    } finally {
      log.close();
    }
  });

  it('rejects a bad --breakpoint with a usage error (exit 2), never touching the DB', async () => {
    project = await createTempProject();
    const io = collectIO();
    const code = await runCli(
      [
        'run',
        'start',
        '--project',
        'proj-1',
        '--mode',
        'feature',
        '--breakpoint',
        'sometimes',
        '--actor',
        'operator-1',
      ],
      { cwd: project.cwd, now: NOW, ...io.io },
    );
    expect(code).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/--breakpoint one of ticket\|wave\|never/);
  });

  it('resume requires a signing key (FR-S2) — refuses with a usage error rather than defaulting to empty', async () => {
    project = await createTempProject();
    const cwd = project.cwd;
    const start = collectIO();
    await runCli(
      [
        'run',
        'start',
        '--project',
        'proj-1',
        '--mode',
        'feature',
        '--breakpoint',
        'never',
        '--actor',
        'operator-1',
      ],
      { cwd, now: NOW, ...start.io },
    );
    const runId = start.stdout[0]?.split(' ')[0];

    const resume = collectIO();
    const code = await runCli(['run', 'resume', runId!, '--actor', 'operator-1'], {
      cwd,
      now: NOW,
      ...resume.io,
    });
    expect(code).toBe(2);
    expect(resume.stderr.join('\n')).toMatch(/requires --signing-key/);
  });

  it('resume refuses with a drift report (409-equivalent exit 1) and suspends the run when a claimed ticket has tampered evidence', async () => {
    project = await createTempProject();
    const cwd = project.cwd;
    await git(cwd, ['init', '-b', 'main']);
    await git(cwd, ['config', 'user.name', 'Shipwright Test']);
    await git(cwd, ['config', 'user.email', 'test@shipwright.invalid']);
    await fs.writeFile(`${cwd}/README.md`, '# fixture\n');
    await git(cwd, ['add', '--', 'README.md']);
    await git(cwd, ['commit', '-m', 'chore: initial commit']);

    const log: EventLog = openWritableLog(resolveDbPath(cwd));
    createIdentity(
      log,
      { id: 'worker-1', name: 'Worker One', kind: 'machine' },
      { now: NOW },
    );
    createTicket(
      log,
      'worker-1',
      {
        id: 'W9-01',
        type: 'task',
        title: 'Ticket W9-01',
        lane: 'core',
        writeScope: ['packages/example/**'],
        verify: 'true',
      },
      { now: NOW },
    );
    claimTicket(log, { ticketId: 'W9-01', actorId: 'worker-1' });
    startTicket(log, { ticketId: 'W9-01', actorId: 'worker-1' });

    const worktree = await createWorktree({
      repoRoot: cwd,
      ticketId: 'W9-01',
      slug: 'ticket-w9-01',
      baseRef: 'main',
    });
    const relPath = 'packages/example/file.ts';
    const filePath = `${worktree.path}/${relPath}`;
    await fs.mkdir(`${worktree.path}/packages/example`, { recursive: true });
    await fs.writeFile(filePath, 'export const a = 1;\n');
    await git(worktree.path, ['add', '--', relPath]);
    await git(worktree.path, ['commit', '-m', 'feat: add file']);

    mintReceipt(
      log,
      {
        id: 'receipt-w9-01',
        kind: 'close',
        projectId: 'proj-1',
        ticketId: 'W9-01',
        validators: [{ name: 'secrets-scan', exitCode: 0, gapCount: 0 }],
        inputFiles: [{ path: relPath, content: 'export const a = 1;\n' }],
        verifyCommand: 'true',
        verifyExit: 0,
        actorId: 'worker-1',
        payload: { commits: [], files: [relPath], evidence: [] },
      },
      { signingKey: 'test-key', now: NOW },
    );
    log.close();

    // Tamper after the receipt minted.
    await fs.writeFile(filePath, 'export const a = 999; // tampered\n');

    const start = collectIO();
    await runCli(
      [
        'run',
        'start',
        '--project',
        'proj-1',
        '--mode',
        'feature',
        '--breakpoint',
        'never',
        '--actor',
        'operator-1',
      ],
      { cwd, now: NOW, ...start.io },
    );
    const runId = start.stdout[0]?.split(' ')[0];

    const resume = collectIO();
    const code = await runCli(
      ['run', 'resume', runId!, '--actor', 'operator-1', '--signing-key', 'test-key'],
      { cwd, now: NOW, ...resume.io },
    );
    expect(code).toBe(1);
    expect(resume.stderr.join('\n')).toMatch(/resume refused — state drift detected/);
    expect(resume.stderr.join('\n')).toMatch(/W9-01/);

    const verifyLog: EventLog = openWritableLog(resolveDbPath(cwd));
    expect(
      verifyLog.db.prepare('SELECT status FROM runs WHERE id = ?').get(runId),
    ).toEqual({
      status: 'suspended',
    });
    expect(
      listEvents(verifyLog).filter((e) => e.eventType === 'ticket.closed'),
    ).toHaveLength(0);
    verifyLog.close();
  });
});
