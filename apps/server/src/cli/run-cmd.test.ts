import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, mintReceipt, type EventLog } from '@dokima/events';
import { claimTicket, createTicket, getTicket, startTicket } from '@dokima/tickets';
import { createWorktree, git } from '@dokima/git';
import { openWritableLog, resolveDbPath } from './db.js';
import { runCli } from './run.js';
import { collectIO, createTempProject, type TempProject } from './test-helpers.js';

const NOW = () => '2026-07-18T00:00:00.000Z';

describe('dokima run (FR-C7 — CLI drives the same @dokima/harbormaster verbs a route would)', () => {
  let project: TempProject;

  afterEach(async () => {
    await project?.cleanup();
  });

  it('start -> pause -> resume -> stop, each printed as "<runId> <verb> -> <status>"', async () => {
    project = await createTempProject();
    const cwd = project.cwd;
    const previousKey = process.env.DOKIMA_SIGNING_KEY;
    process.env.DOKIMA_SIGNING_KEY = 'test-signing-key';

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
    if (previousKey === undefined) delete process.env.DOKIMA_SIGNING_KEY;
    else process.env.DOKIMA_SIGNING_KEY = previousKey;
    // W11-04 CONTRACT CHANGE: a build mode with no agent configured (no
    // `--agent-command`, no `agentRunner` setting) no longer refuses — it
    // runs on Dokima's own built-in agent (D-023). With no board seeded,
    // nothing is claimable, so the run completes idle.
    expect(startCode).toBe(0);
    expect(start.stdout[0]).toMatch(
      /^run-.* started -> running \(breakpoint=wave berths=2\)$/,
    );
    expect(start.stdout.join('\n')).toContain(
      'finished: 0 landed, 0 parked (stop: idle)',
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
    await git(cwd, ['config', 'user.name', 'Dokima Test']);
    await git(cwd, ['config', 'user.email', 'test@dokima.invalid']);
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

  /**
   * W10-77 RED FIXTURE — the agentic loop, end to end, under law 9.
   *
   * Before this ticket `run start --mode new_product` minted a run record and
   * returned: measured on a real board, nothing claimed, no events, no session,
   * and `--berths` read by nothing. The engine it needed (`runLandLoop`) was
   * built in W3-01a/b/c and exported from nothing until W10-78.
   *
   * The agent here is a shell script with no network, no model and no quota
   * spend — which is not a shortcut but the law-9 requirement ("everything must
   * work with a fake/local model and no network"). It does what a real coding
   * session does: edits an in-scope file and COMMITS it. The commit is
   * load-bearing — the close gate checks the manifest against git rather than
   * against the agent's word (SC-02), and an agent that only edits is refused
   * with "uncommitted, or never real". That refusal is asserted too, because a
   * loop that lands work nobody committed would be worse than one that lands
   * nothing.
   */
  async function gitRepoProject(): Promise<TempProject> {
    const proj = await createTempProject();
    await git(proj.cwd, ['init', '-b', 'main']);
    await git(proj.cwd, ['config', 'user.email', 'demo@dokima.local']);
    await git(proj.cwd, ['config', 'user.name', 'Demo']);
    await fs.mkdir(`${proj.cwd}/src`, { recursive: true });
    await fs.writeFile(`${proj.cwd}/src/app.ts`, 'export const answer = 0;\n');
    await git(proj.cwd, ['add', '-A']);
    await git(proj.cwd, ['commit', '-m', 'initial']);
    return proj;
  }

  async function writeAgent(dir: string, commit: boolean): Promise<string> {
    const file = `${dir}/agent-${commit ? 'commits' : 'edits-only'}.sh`;
    const commitLines = commit
      ? [
          'git add src/app.ts',
          'git -c user.email=a@b.c -c user.name=agent commit -qm "T-1: 42"',
          'SHA="$(git rev-parse HEAD)"',
        ].join('\n')
      : 'SHA=""';
    await fs.writeFile(
      file,
      [
        '#!/usr/bin/env bash',
        'set -eu',
        "printf 'export const answer = 42;\\n' > src/app.ts",
        commitLines,
        'cat <<JSON',
        '{"ticket":"T-1","files":["src/app.ts"],"verify":{"command":"true","exit":0},' +
          '"commits":["$SHA"],"evidence":["e"],"memory_written":["m"]}',
        'JSON',
        '',
      ].join('\n'),
    );
    await fs.chmod(file, 0o755);
    return file;
  }

  function seedBoard(log: EventLog): void {
    createIdentity(log, { id: 'worker-1', name: 'worker-1', kind: 'machine' });
    createTicket(log, 'worker-1', {
      id: 'T-1',
      type: 'task',
      title: 'Set the answer to 42',
      lane: 'core',
      writeScope: ['src/**'],
      verify: 'true',
      acceptance: [{ id: 'AC-1', text: 'answer is 42', done: false }],
    });
  }

  async function startBuildRun(cwd: string, agent: string) {
    const io = collectIO();
    const previousKey = process.env.DOKIMA_SIGNING_KEY;
    process.env.DOKIMA_SIGNING_KEY = 'test-signing-key';
    try {
      const code = await runCli(
        [
          'run',
          'start',
          '--project',
          'proj-1',
          '--mode',
          'new_product',
          '--breakpoint',
          'never',
          '--berths',
          '1',
          '--actor',
          'worker-1',
          '--agent-command',
          agent,
        ],
        { cwd, ...io.io },
      );
      return { code, io };
    } finally {
      if (previousKey === undefined) delete process.env.DOKIMA_SIGNING_KEY;
      else process.env.DOKIMA_SIGNING_KEY = previousKey;
    }
  }

  it('RED FIXTURE: `run start` on a build mode claims a ticket, runs an agent session, and LANDS it', async () => {
    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    seedBoard(log);
    log.close();

    const agent = await writeAgent(project.cwd, true);
    const { code, io } = await startBuildRun(project.cwd, agent);

    expect(code).toBe(0);
    expect(io.stdout.join('\n')).toContain('T-1: landed');

    // The ticket reached in_review with a real close receipt — NOT done: the
    // loop is the maker and may not accept its own work (C-4).
    const after = openWritableLog(resolveDbPath(project.cwd));
    const ticket = getTicket(after, 'T-1');
    after.close();
    expect(ticket?.status).toBe('in_review');
    expect(ticket?.manifest?.closeReceipt?.files).toEqual(['src/app.ts']);

    // And the agent's work is really on the ticket branch, not merely claimed.
    const { stdout: branchFile } = await git(project.cwd, [
      'show',
      'sw/T-1-set-the-answer-to-42:src/app.ts',
    ]);
    expect(branchFile).toContain('42');
  }, 120_000);

  it('an agent that edits without committing is REFUSED by the close gate, and the ticket is parked', async () => {
    project = await gitRepoProject();
    const log = openWritableLog(resolveDbPath(project.cwd));
    seedBoard(log);
    log.close();

    const agent = await writeAgent(project.cwd, false);
    const { io } = await startBuildRun(project.cwd, agent);

    expect(io.stdout.join('\n')).toContain('T-1: parked');
    const after = openWritableLog(resolveDbPath(project.cwd));
    const ticket = getTicket(after, 'T-1');
    after.close();
    expect(ticket?.manifest?.closeReceipt).toBeFalsy();
    const comments = ticket?.history.filter((h) => h.verb === 'comment') ?? [];
    const evidence = comments.map((c) => c.body).join('\n');
    expect(evidence).toContain('close gate refused');
    expect(evidence).toContain('no commits found on the ticket branch');
  }, 120_000);

  it('RED FIXTURE (W11-04, acceptance 3): a build mode with no agent configured runs the built-in agent rather than refusing', async () => {
    project = await gitRepoProject();
    const previousKey = process.env.DOKIMA_SIGNING_KEY;
    process.env.DOKIMA_SIGNING_KEY = 'test-signing-key';
    try {
      const noAgent = collectIO();
      expect(
        await runCli(
          [
            'run',
            'start',
            '--project',
            'p',
            '--mode',
            'new_product',
            '--breakpoint',
            'never',
            '--berths',
            '1',
            '--actor',
            'worker-1',
          ],
          { cwd: project.cwd, ...noAgent.io },
        ),
      ).toBe(0);
      expect(noAgent.stderr.join('\n')).not.toContain('no agent is configured');
      expect(noAgent.stdout.join('\n')).toContain(
        'finished: 0 landed, 0 parked (stop: idle)',
      );
    } finally {
      if (previousKey === undefined) delete process.env.DOKIMA_SIGNING_KEY;
      else process.env.DOKIMA_SIGNING_KEY = previousKey;
    }
  });

  it('refuses a build mode with no signing key, rather than pretending', async () => {
    project = await gitRepoProject();
    const previousKey = process.env.DOKIMA_SIGNING_KEY;
    delete process.env.DOKIMA_SIGNING_KEY;
    try {
      const noKey = collectIO();
      expect(
        await runCli(
          [
            'run',
            'start',
            '--project',
            'p',
            '--mode',
            'new_product',
            '--breakpoint',
            'never',
            '--berths',
            '1',
            '--actor',
            'worker-1',
            '--agent-command',
            '/bin/true',
          ],
          { cwd: project.cwd, ...noKey.io },
        ),
      ).toBe(2);
      // A close gate that minted receipts against a placeholder key would
      // produce receipts verifying against nothing — worse than refusing.
      expect(noKey.stderr.join('\n')).toContain('DOKIMA_SIGNING_KEY');
    } finally {
      if (previousKey !== undefined) process.env.DOKIMA_SIGNING_KEY = previousKey;
    }
  });
});
