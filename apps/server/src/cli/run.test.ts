import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, type EventLog } from '@dokima/events';
import { git } from '@dokima/git';
import { createTicket, listTickets, type Ticket } from '@dokima/tickets';
import { openWritableLog, resolveDbPath } from './db.js';
import { runCli } from './run.js';
import { collectIO, createTempProject, type TempProject } from './test-helpers.js';

const NOW = () => '2026-07-11T00:00:00.000Z';

async function seed(project: TempProject): Promise<void> {
  const log: EventLog = openWritableLog(resolveDbPath(project.cwd));
  createIdentity(log, { id: 'maker-1', name: 'Maker One', kind: 'human' }, { now: NOW });
  createIdentity(
    log,
    { id: 'reviewer-1', name: 'Reviewer One', kind: 'human' },
    { now: NOW },
  );
  createTicket(
    log,
    'maker-1',
    {
      id: 'W9-01',
      type: 'task',
      title: 'Sample ticket',
      lane: 'core',
      writeScope: ['packages/example/**'],
    },
    { now: NOW },
  );
  log.close();
}

describe('runCli (W0 exit criterion: a board that cannot lie, moved by CLI)', () => {
  let project: TempProject;

  afterEach(async () => {
    await project?.cleanup();
  });

  it('board renders a freshly seeded ticket under its lane and ready column', async () => {
    project = await createTempProject();
    await seed(project);
    const { stdout, io } = collectIO();

    const code = await runCli(['board'], { cwd: project.cwd, now: NOW, ...io });

    expect(code).toBe(0);
    const board = stdout.join('\n');
    expect(board).toContain('LANE: core');
    expect(board).toMatch(/ready\s+: W9-01 Sample ticket/);
  });

  it('drives claim -> start -> close -> accept -> comment through the verbs, printing the new status each time', async () => {
    project = await createTempProject();
    await seed(project);
    const cwd = project.cwd;

    const claim = collectIO();
    expect(
      await runCli(['claim', 'W9-01', '--actor', 'maker-1'], {
        cwd,
        now: NOW,
        ...claim.io,
      }),
    ).toBe(0);
    expect(claim.stdout).toEqual(['W9-01 claim -> claimed']);

    const start = collectIO();
    expect(
      await runCli(['start', 'W9-01', '--actor', 'maker-1'], {
        cwd,
        now: NOW,
        ...start.io,
      }),
    ).toBe(0);
    expect(start.stdout).toEqual(['W9-01 start -> in_progress']);

    // W23-42: close measures its evidence, so the file must really exist and
    // the verify must really pass. No git repo here, so the commit is recorded
    // caller-asserted — and the output says so.
    await fs.mkdir(path.join(cwd, 'packages/example/src'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'packages/example/src/index.ts'), 'export {};\n');
    const close = collectIO();
    expect(
      await runCli(
        [
          'close',
          'W9-01',
          '--actor',
          'maker-1',
          '--files',
          'packages/example/src/index.ts',
          '--commits',
          'abc123',
          '--verify-cmd',
          'true',
        ],
        { cwd, now: NOW, ...close.io },
      ),
    ).toBe(0);
    expect(close.stdout).toEqual([
      'W9-01 close -> in_review (commits caller-asserted: no git repo to check them against)',
    ]);

    const accept = collectIO();
    expect(
      await runCli(['accept', 'W9-01', '--actor', 'reviewer-1'], {
        cwd,
        now: NOW,
        ...accept.io,
      }),
    ).toBe(0);
    expect(accept.stdout).toEqual(['W9-01 accept -> done']);

    const comment = collectIO();
    expect(
      await runCli(['comment', 'W9-01', '--actor', 'reviewer-1', '--body', 'nice work'], {
        cwd,
        now: NOW,
        ...comment.io,
      }),
    ).toBe(0);
    expect(comment.stdout).toEqual(['W9-01 comment -> done']);

    const board = collectIO();
    expect(await runCli(['board'], { cwd, now: NOW, ...board.io })).toBe(0);
    expect(board.stdout.join('\n')).toMatch(/done\s+: W9-01 Sample ticket/);
  });

  it('release returns a claimed ticket to ready', async () => {
    project = await createTempProject();
    await seed(project);
    const cwd = project.cwd;

    await runCli(['claim', 'W9-01', '--actor', 'maker-1'], {
      cwd,
      now: NOW,
      ...collectIO().io,
    });
    const release = collectIO();
    expect(
      await runCli(['release', 'W9-01', '--actor', 'maker-1'], {
        cwd,
        now: NOW,
        ...release.io,
      }),
    ).toBe(0);
    expect(release.stdout).toEqual(['W9-01 release -> ready']);
  });

  it('prints the specific refusal reason and exits 1 on an invalid transition', async () => {
    project = await createTempProject();
    await seed(project);
    const { stderr, io } = collectIO();

    const code = await runCli(['start', 'W9-01', '--actor', 'maker-1'], {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain('refused [INVALID_TRANSITION]');
  });

  it('refuses self-accept with the SELF_ACCEPT reason', async () => {
    project = await createTempProject();
    await seed(project);
    const cwd = project.cwd;
    await runCli(['claim', 'W9-01', '--actor', 'maker-1'], {
      cwd,
      now: NOW,
      ...collectIO().io,
    });
    await runCli(['start', 'W9-01', '--actor', 'maker-1'], {
      cwd,
      now: NOW,
      ...collectIO().io,
    });
    await fs.writeFile(path.join(cwd, 'a.ts'), 'export {};\n');
    expect(
      await runCli(
        [
          'close',
          'W9-01',
          '--actor',
          'maker-1',
          '--files',
          'a.ts',
          '--commits',
          'abc',
          '--verify-cmd',
          'true',
        ],
        { cwd, now: NOW, ...collectIO().io },
      ),
    ).toBe(0);

    const { stderr, io } = collectIO();
    const code = await runCli(['accept', 'W9-01', '--actor', 'maker-1'], {
      cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr[0]).toContain('refused [SELF_ACCEPT]');
  });

  it('refuses a close whose verify command, RUN by close, did not exit 0 via MANIFEST_INVALID', async () => {
    project = await createTempProject();
    await seed(project);
    const cwd = project.cwd;
    await runCli(['claim', 'W9-01', '--actor', 'maker-1'], {
      cwd,
      now: NOW,
      ...collectIO().io,
    });
    await runCli(['start', 'W9-01', '--actor', 'maker-1'], {
      cwd,
      now: NOW,
      ...collectIO().io,
    });

    const { stderr, io } = collectIO();
    const code = await runCli(
      [
        'close',
        'W9-01',
        '--actor',
        'maker-1',
        '--files',
        'a.ts',
        '--commits',
        'abc',
        '--verify-cmd',
        'false',
      ],
      { cwd, now: NOW, ...io },
    );

    expect(code).toBe(1);
    expect(stderr[0]).toContain('refused [MANIFEST_INVALID]');
  });

  it('claim on an unknown ticket refuses with TICKET_NOT_FOUND', async () => {
    project = await createTempProject();
    await seed(project);
    const { stderr, io } = collectIO();

    const code = await runCli(['claim', 'does-not-exist', '--actor', 'maker-1'], {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr[0]).toContain('refused [TICKET_NOT_FOUND]');
  });

  it('auto-provisions a fresh --actor identity on first use', async () => {
    project = await createTempProject();
    await seed(project);
    const { io } = collectIO();

    const code = await runCli(['claim', 'W9-01', '--actor', 'brand-new-actor'], {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(0);
  });

  it('a bad command line refuses with exit code 2 and a usage message, without touching the log', async () => {
    project = await createTempProject();
    const { stderr, io } = collectIO();

    const code = await runCli(['claim', 'W9-01'], { cwd: project.cwd, now: NOW, ...io });

    expect(code).toBe(2);
    expect(stderr[0]).toMatch(/--actor/);
  });

  it('verify-chain reports OK on a real event log written by the verbs above', async () => {
    project = await createTempProject();
    await seed(project);
    await runCli(['claim', 'W9-01', '--actor', 'maker-1'], {
      cwd: project.cwd,
      now: NOW,
      ...collectIO().io,
    });

    const { stdout, io } = collectIO();
    const code = await runCli(['verify-chain'], { cwd: project.cwd, now: NOW, ...io });

    expect(code).toBe(0);
    expect(stdout[0]).toBe('chain OK: all events verified against the hash chain');
  });

  it('verify-chain refuses cleanly when no event log exists yet', async () => {
    project = await createTempProject();
    const { stderr, io } = collectIO();

    const code = await runCli(['verify-chain'], { cwd: project.cwd, now: NOW, ...io });

    expect(code).toBe(1);
    expect(stderr[0]).toContain('verify-chain refused');
  });
});

describe('W21-81: a lane/write-scope refusal reads as a refusal, not a crash', () => {
  let project: TempProject;

  afterEach(async () => {
    await project?.cleanup();
  });

  /** Seeds a second ticket in a DIFFERENT lane, so any overlap is FR-T3 cross-lane. */
  async function seedOtherLane(cwd: string): Promise<void> {
    const log: EventLog = openWritableLog(resolveDbPath(cwd));
    createTicket(
      log,
      'maker-1',
      {
        id: 'W9-02',
        type: 'task',
        title: 'Other lane ticket',
        lane: 'web',
        writeScope: ['packages/other/**'],
      },
      { now: NOW },
    );
    log.close();
  }

  it('widen-scope prints one refusal line naming both tickets and lanes, with no stack trace', async () => {
    project = await createTempProject();
    await seed(project);
    await seedOtherLane(project.cwd);

    const { stderr, stdout, io } = collectIO();
    const code = await runCli(
      [
        'widen-scope',
        'W9-01',
        '--actor',
        'maker-1',
        '--add',
        'packages/other/**',
        '--reason',
        'the ticket cannot satisfy its own acceptance without it',
      ],
      { cwd: project.cwd, now: NOW, ...io },
    );

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain('refused [LANE_SCOPE]');
    // The detail the dumped violation array carried survives in the one line.
    expect(stderr[0]).toContain('cross-lane-overlap');
    expect(stderr[0]).toContain('W9-01');
    expect(stderr[0]).toContain('W9-02');
    expect(stderr[0]).toContain('core');
    expect(stderr[0]).toContain('web');
    // A stack trace through dist/main.js is what made this read as breakage.
    expect(stderr[0]).not.toContain('    at ');
    expect(stderr[0]).not.toContain('LaneScopeError:');
  });

  it('add-ticket shares the check and refuses the same way', async () => {
    project = await createTempProject();
    await seed(project);

    const { stderr, io } = collectIO();
    const code = await runCli(
      [
        'add-ticket',
        'W9-03',
        '--actor',
        'maker-1',
        '--lane',
        'web',
        '--title',
        'Collides with W9-01 across lanes',
        '--write-scope',
        'packages/example/**',
      ],
      { cwd: project.cwd, now: NOW, ...io },
    );

    expect(code).toBe(1);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain('refused [LANE_SCOPE]');
    expect(stderr[0]).toContain('W9-01');
    expect(stderr[0]).toContain('W9-03');
    expect(stderr[0]).not.toContain('    at ');
  });

  it('a widen that does not collide still succeeds', async () => {
    project = await createTempProject();
    await seed(project);
    await seedOtherLane(project.cwd);

    const { stdout, io } = collectIO();
    const code = await runCli(
      [
        'widen-scope',
        'W9-01',
        '--actor',
        'maker-1',
        '--add',
        'packages/example-docs/**',
        '--reason',
        'the acceptance criterion names a file outside the scope',
      ],
      { cwd: project.cwd, now: NOW, ...io },
    );

    expect(code).toBe(0);
    expect(stdout[0]).toContain('W9-01 write_scope ->');
  });
});

/**
 * W21-99. `dokima board --db /nonexistent.db` printed "SqliteError: unable to
 * open database file" and a stack trace through better-sqlite3 and
 * dist/main.js — a person who mistypes a path is told the product broke.
 *
 * Third instance of one class: W21-81 (LaneScopeError), W21-91 (parseArgs
 * TypeError), now SqliteError. Each time a handler knew only its own error
 * type and everything else reached the top-level catch that prints err.stack.
 */
describe('a db path that cannot be opened refuses, it does not crash (W21-99)', () => {
  let project: TempProject;

  afterEach(async () => {
    await project?.cleanup();
  });

  it('RED FIXTURE: board names the path in one line, with no stack trace', async () => {
    const { stderr, io } = collectIO();

    const code = await runCli(['board', '--db', '/nonexistent-dir-w2199/x.db'], {
      cwd: '/tmp',
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain('refused [DB_OPEN]');
    expect(stderr[0]).toContain('/nonexistent-dir-w2199/x.db');
    expect(stderr[0]).not.toContain('    at ');
    expect(stderr[0]).not.toContain('SqliteError');
  });

  it('a lifecycle verb refuses the same way', async () => {
    const { stderr, io } = collectIO();

    const code = await runCli(
      ['claim', 'W9-01', '--actor', 'maker-1', '--db', '/nonexistent-dir-w2199/y.db'],
      { cwd: '/tmp', now: NOW, ...io },
    );

    expect(code).toBe(1);
    expect(stderr[0]).toContain('refused [DB_OPEN]');
    expect(stderr[0]).not.toContain('    at ');
  });

  it('a path that opens is unaffected', async () => {
    project = await createTempProject();
    await seed(project);
    const { stdout, io } = collectIO();

    const code = await runCli(['board'], { cwd: project.cwd, now: NOW, ...io });

    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('LANE: core');
  });
});

/**
 * W23-42: `dokima close` MEASURES its evidence. Before this, the receipt stored
 * whatever the caller typed — `--verify-cmd false` closed the ticket with
 * `{"command":"false","exitCode":0}`, because the exit defaulted to 0 and
 * `closeTicket` trusts its caller structurally.
 */
describe('W23-42: close runs verify, stats files and resolves commits itself', () => {
  let project: TempProject;

  afterEach(async () => {
    await project?.cleanup();
  });

  async function seedClaimed(cwd: string, verify: string | null = null): Promise<void> {
    const log: EventLog = openWritableLog(resolveDbPath(cwd));
    createIdentity(
      log,
      { id: 'maker-1', name: 'Maker One', kind: 'human' },
      { now: NOW },
    );
    createTicket(
      log,
      'maker-1',
      {
        id: 'W9-01',
        type: 'task',
        title: 'Sample ticket',
        lane: 'core',
        writeScope: ['**'],
        verify,
      },
      { now: NOW },
    );
    log.close();
    for (const verb of ['claim', 'start']) {
      expect(
        await runCli([verb, 'W9-01', '--actor', 'maker-1'], {
          cwd,
          now: NOW,
          ...collectIO().io,
        }),
      ).toBe(0);
    }
  }

  /** A real repo holding x.txt in one real commit; returns that commit's SHA. */
  async function commitFile(cwd: string): Promise<string> {
    await git(cwd, ['init', '-q']);
    await git(cwd, ['config', 'user.email', 'maker@example.test']);
    await git(cwd, ['config', 'user.name', 'Maker']);
    await fs.writeFile(path.join(cwd, 'x.txt'), 'real work\n');
    await git(cwd, ['add', 'x.txt']);
    await git(cwd, ['commit', '-q', '-m', 'real work']);
    return (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
  }

  function closeArgs(files: string, commits: string, verifyCmd: string): string[] {
    return [
      'close',
      'W9-01',
      '--actor',
      'maker-1',
      '--files',
      files,
      '--commits',
      commits,
      '--verify-cmd',
      verifyCmd,
    ];
  }

  function readTicket(cwd: string): Ticket {
    const log: EventLog = openWritableLog(resolveDbPath(cwd));
    try {
      const ticket = listTickets(log).find((t) => t.id === 'W9-01');
      if (!ticket) throw new Error('W9-01 missing');
      return ticket;
    } finally {
      log.close();
    }
  }

  it('RED FIXTURE (the 2026-09-23 repro): --verify-cmd false is refused, not receipted as exit 0', async () => {
    project = await createTempProject();
    await seedClaimed(project.cwd);
    await fs.writeFile(path.join(project.cwd, 'x.txt'), 'x\n');
    const { stderr, io } = collectIO();

    const code = await runCli(closeArgs('x.txt', 'deadbeef'.repeat(5), 'false'), {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr.join('\n')).toMatch(/refused \[MANIFEST_INVALID\].*verifyExit=1/);
    const ticket = readTicket(project.cwd);
    expect(ticket.status).toBe('in_progress');
    expect(ticket.manifest).toBeNull();
  });

  it('refuses a --files path that does not exist in the project', async () => {
    project = await createTempProject();
    await seedClaimed(project.cwd);
    const sha = await commitFile(project.cwd);
    const { stderr, io } = collectIO();

    const code = await runCli(closeArgs('x.txt,never-written.txt', sha, 'true'), {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('never-written.txt');
    expect(readTicket(project.cwd).status).toBe('in_progress');
  });

  it('refuses a --commits SHA that is not a commit in the project repo', async () => {
    project = await createTempProject();
    await seedClaimed(project.cwd);
    await commitFile(project.cwd);
    const { stderr, io } = collectIO();

    const code = await runCli(closeArgs('x.txt', 'deadbeef'.repeat(5), 'true'), {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('deadbeef'.repeat(5));
    expect(readTicket(project.cwd).status).toBe('in_progress');
  });

  it("runs the ticket's OWN verify when it declares one — a caller's `true` cannot stand in for it", async () => {
    project = await createTempProject();
    await seedClaimed(project.cwd, 'false');
    const sha = await commitFile(project.cwd);
    const { stderr, io } = collectIO();

    const code = await runCli(closeArgs('x.txt', sha, 'true'), {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr.join('\n')).toMatch(/verifyExit=1/);
  });

  it('a close that checks out records the MEASURED evidence, every part marked verified', async () => {
    project = await createTempProject();
    await seedClaimed(project.cwd);
    const sha = await commitFile(project.cwd);
    const { stdout, io } = collectIO();

    const code = await runCli(closeArgs('x.txt', sha, 'test -s x.txt'), {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(0);
    expect(stdout).toEqual(['W9-01 close -> in_review']);
    const receipt = readTicket(project.cwd).manifest?.closeReceipt;
    expect(receipt?.verify).toEqual({ command: 'test -s x.txt', exitCode: 0 });
    expect(receipt?.commits).toEqual([sha]);
    expect(receipt?.evidence).toEqual({
      verify: 'ran',
      verifySource: 'caller',
      files: 'verified',
      commits: 'verified',
    });
  });

  it('with no git repo, commits are recorded CALLER-ASSERTED — never as verified', async () => {
    project = await createTempProject();
    await seedClaimed(project.cwd);
    await fs.writeFile(path.join(project.cwd, 'x.txt'), 'x\n');
    const { stdout, io } = collectIO();

    const code = await runCli(closeArgs('x.txt', 'abc1234', 'true'), {
      cwd: project.cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(0);
    expect(stdout[0]).toMatch(/caller-asserted/);
    const receipt = readTicket(project.cwd).manifest?.closeReceipt;
    expect(receipt?.commits).toEqual(['abc1234']);
    expect(receipt?.evidence?.commits).toBe('caller_asserted');
    expect(receipt?.evidence?.files).toBe('verified');
  });
});
