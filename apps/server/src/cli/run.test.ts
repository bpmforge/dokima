import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, type EventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
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
          'pnpm test',
        ],
        { cwd, now: NOW, ...close.io },
      ),
    ).toBe(0);
    expect(close.stdout).toEqual(['W9-01 close -> in_review']);

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
        'pnpm test',
      ],
      { cwd, now: NOW, ...collectIO().io },
    );

    const { stderr, io } = collectIO();
    const code = await runCli(['accept', 'W9-01', '--actor', 'maker-1'], {
      cwd,
      now: NOW,
      ...io,
    });

    expect(code).toBe(1);
    expect(stderr[0]).toContain('refused [SELF_ACCEPT]');
  });

  it('refuses a close whose verify command did not exit 0 via MANIFEST_INVALID', async () => {
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
        'pnpm test',
        '--verify-exit',
        '1',
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
