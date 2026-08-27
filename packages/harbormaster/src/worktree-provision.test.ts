/**
 * W21-12. The fixtures that matter are the ones that would let this step break
 * a promise: installing when it should not, taking instruction from anywhere
 * but the disk, failing silently, or quietly handing the agent the ability to
 * install things itself.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openEventLog, createIdentity, type EventLog } from '@dokima/events';
import { AGENT_SESSION_TOOL_NAMES } from './agent-session/tools.js';
import {
  planProvision,
  provisionWorktree,
  provisionFailureReason,
} from './worktree-provision.js';

const dirs: string[] = [];
async function tempDir(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `provision-${name}-`));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function logIn(dir: string): Promise<EventLog> {
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  return log;
}

describe('W21-74 — the manifest can appear DURING the session', () => {
  /**
   * The premise the post-session provision in `attemptOnce` rests on: this
   * step is a fresh look at disk every time, not a once-per-worktree decision.
   * Tally's PLAN-tally-01 skipped at 17:57:49 with "no package.json", the
   * agent wrote one at 17:58:03, and the close gate then failed on
   * `sh: tsc: command not found`. If planProvision ever memoises or a caller
   * makes it once-only, that failure comes straight back.
   */
  it('plans nothing on an empty worktree and an install once the agent writes package.json', async () => {
    const dir = await tempDir('appears');
    expect(await planProvision(dir)).toBeNull();

    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'tally', devDependencies: { typescript: '^5.3.2' } }),
    );

    // Greenfield: a manifest and no lockfile yet — npm is the one that works.
    expect(await planProvision(dir)).toEqual({
      command: 'npm',
      args: ['install'],
      because: 'package.json with no lockfile',
    });
  });

  it('a second call is a cheap skip once dependencies are present', async () => {
    const dir = await tempDir('already');
    await fs.writeFile(path.join(dir, 'package.json'), '{}');
    await fs.mkdir(path.join(dir, 'node_modules'));
    const log = await logIn(dir);

    const result = await provisionWorktree({
      worktreePath: dir,
      log,
      actorId: 'operator',
      ticketId: 'T-1',
    });

    expect(result.ran).toBe(false);
    expect(provisionFailureReason(result)).toBeNull();
  });
});

describe('planProvision (W21-12) — decided only from files on disk', () => {
  it('a worktree with no manifest needs nothing', async () => {
    expect(await planProvision(await tempDir('bare'))).toBeNull();
  });

  it('RED FIXTURE: dependencies already installed means NOTHING runs — re-installing per ticket would cost minutes and mutate the tree the agent is judged on', async () => {
    const dir = await tempDir('installed');
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}');
    await fs.mkdir(path.join(dir, 'node_modules'));
    expect(await planProvision(dir)).toBeNull();
  });

  it('the lockfile on disk picks the manager — never ticket text, never model output', async () => {
    const cases: readonly [string, string][] = [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm'],
    ];
    for (const [lockfile, manager] of cases) {
      const dir = await tempDir(manager);
      await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}');
      await fs.writeFile(path.join(dir, lockfile), '');
      const plan = await planProvision(dir);
      expect(plan?.command, lockfile).toBe(manager);
      expect(plan?.because, lockfile).toContain(lockfile);
    }
  });

  it('greenfield — a manifest with no lockfile — falls back to npm, which ships with node', async () => {
    const dir = await tempDir('greenfield');
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"vault"}');
    const plan = await planProvision(dir);
    expect(plan?.command).toBe('npm');
    expect(plan?.because).toContain('no lockfile');
  });
});

describe('provisionWorktree (W21-12)', () => {
  it('does nothing, and says so, when there is nothing to do', async () => {
    const dir = await tempDir('noop');
    const log = await logIn(dir);
    const result = await provisionWorktree({
      worktreePath: dir,
      log,
      actorId: 'operator',
      ticketId: 'T-1',
    });
    expect(result.ran).toBe(false);
    expect(result.ok).toBe(true);
    // W21-21: a skip is LEDGERED with its reason. Silence would make "nothing
    // needed installing" and "this code never ran" identical from the
    // outside — which is exactly how a dead call site hid for a whole wave.
    const row = log.db
      .prepare("select payload from events where event_type = 'worktree.provisioned'")
      .get() as { payload: string };
    expect(row).toBeTruthy();
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    expect(payload.ran).toBe(false);
    expect(String(payload.why)).toContain('no package.json');
    log.close();
  });

  it('an already-installed tree says so in the ledger, distinctly from having no manifest', async () => {
    const dir = await tempDir('skip-installed');
    const log = await logIn(dir);
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}');
    await fs.mkdir(path.join(dir, 'node_modules'));
    await provisionWorktree({ worktreePath: dir, log, actorId: 'operator', ticketId: 'T-1' });
    const row = log.db
      .prepare("select payload from events where event_type = 'worktree.provisioned'")
      .get() as { payload: string };
    expect(String(JSON.parse(row.payload).why)).toContain('already installed');
    log.close();
  });

  it('RED FIXTURE: a failed provision is LEDGERED and reported, never swallowed into a doomed verify', async () => {
    const dir = await tempDir('fail');
    const log = await logIn(dir);
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}');
    // A manager that cannot exist: the spawn fails, which is the same shape as
    // a missing package manager on a real machine.
    const result = await provisionWorktree({
      worktreePath: dir,
      log,
      actorId: 'operator',
      ticketId: 'T-1',
      timeoutMs: 15_000,
    });
    // npm may or may not be installed wherever this runs; either way the step
    // must have RUN and must have ledgered its outcome.
    expect(result.ran).toBe(true);
    const rows = log.db
      .prepare("select payload from events where event_type = 'worktree.provisioned'")
      .all() as { payload: string }[];
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]!.payload) as Record<string, unknown>;
    expect(payload.command).toContain('install');
    expect(payload.because).toContain('lockfile');
    expect(payload).toHaveProperty('durationMs');
    log.close();
  }, 60_000);

  it('a failure reason names the real cause — dependencies, not the work', async () => {
    const reason = provisionFailureReason({
      ran: true,
      ok: false,
      exitCode: 1,
      durationMs: 10,
      output: 'ENOENT',
      plan: { command: 'npm', args: ['install'], because: 'package.json with no lockfile' },
    });
    expect(reason).toContain('dependencies were never installed');
    expect(reason).toContain('not a failure of the work');
    expect(provisionFailureReason({
      ran: false, ok: true, exitCode: null, durationMs: 0, output: '', plan: null,
    })).toBeNull();
  });
});

describe('installing must not look like a scope violation (W21-23)', () => {
  it('RED FIXTURE: the dependency directory is ignored BEFORE the install, so the SC-01 sweep never sees it', async () => {
    const dir = await tempDir('ignore');
    const log = await logIn(dir);
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}');
    await fs.writeFile(path.join(dir, '.gitignore'), '.dokima/\n');
    await provisionWorktree({
      worktreePath: dir,
      log,
      actorId: 'operator',
      ticketId: 'T-1',
      timeoutMs: 60_000,
    });
    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(ignore).toContain('node_modules/');
    // The project's own entry survives — this appends, never overwrites.
    expect(ignore).toContain('.dokima/');
    log.close();
  }, 90_000);

  it('re-provisioning does not add the entry twice', async () => {
    const dir = await tempDir('ignore-twice');
    const log = await logIn(dir);
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}');
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules/\n');
    await provisionWorktree({
      worktreePath: dir, log, actorId: 'operator', ticketId: 'T-1', timeoutMs: 60_000,
    });
    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(ignore.match(/node_modules\//g)).toHaveLength(1);
    log.close();
  }, 90_000);
});

describe('the agent is not refused for changes the harness made (W21-28)', () => {
  const gitInit = async (dir: string) => {
    const { execFile } = await import('node:child_process');
    const run = (args: string[]) =>
      new Promise<void>((resolve, reject) =>
        execFile('git', args, { cwd: dir }, (err) => (err ? reject(err) : resolve())),
      );
    await run(['init', '-q']);
    await run(['config', 'user.email', 'harness@dokima.test']);
    await run(['config', 'user.name', 'Harness']);
    await fs.writeFile(path.join(dir, 'seed.txt'), 'seed');
    await run(['add', '-A']);
    await run(['commit', '-q', '-m', 'seed']);
  };

  it('RED FIXTURE: the live trio — .gitignore, the lockfile and validator telemetry — is committed by the harness, so the session diff is only the agent\'s', async () => {
    const dir = await tempDir('harness-commit');
    const log = await logIn(dir);
    await gitInit(dir);
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x"}');
    await fs.mkdir(path.join(dir, 'docs', 'work'), { recursive: true });
    await fs.writeFile(path.join(dir, 'docs/work/telemetry.jsonl'), '{"source":"validator"}\n');
    // Something the AGENT wrote: it must be left exactly where it is.
    await fs.writeFile(path.join(dir, 'agent-work.ts'), 'export const x = 1;\n');

    await provisionWorktree({
      worktreePath: dir, log, actorId: 'operator', ticketId: 'T-1', timeoutMs: 90_000,
    });

    const { execFile } = await import('node:child_process');
    const status = await new Promise<string>((resolve) =>
      execFile('git', ['status', '--porcelain'], { cwd: dir }, (_e, out) => resolve(out)),
    );
    // The harness's leavings are gone from the diff…
    expect(status).not.toContain('.gitignore');
    expect(status).not.toContain('package-lock.json');
    expect(status).not.toContain('telemetry.jsonl');
    // …and the agent's file is untouched, still waiting to be judged.
    expect(status).toContain('agent-work.ts');
    log.close();
  }, 120_000);
});

describe('the agent still cannot install anything (SC-18, D-023)', () => {
  it('RED FIXTURE: the closed tool set gains NO install-shaped tool — the harness provisions, the model never does', () => {
    expect([...AGENT_SESSION_TOOL_NAMES].sort()).toEqual(
      ['commit', 'edit', 'list', 'read', 'search', 'verify', 'write'].sort(),
    );
    for (const name of AGENT_SESSION_TOOL_NAMES) {
      expect(name).not.toMatch(/install|exec|shell|run|spawn|fetch|network/i);
    }
  });
});

describe('W21-86 — a tool\'s own artifacts never trip the scope sweep', () => {
  /**
   * Tally's PLAN-tally-01 finished its work and had the session DISCARDED:
   * "tsconfig.tsbuildinfo (outside-scope). Session output discarded; no
   * Completion Manifest was produced." Its acceptance criterion is
   * `npm run build` — `tsc --build` — which writes that file. The product
   * told the maker to run a command and refused it for the command's output.
   */
  it('ignores the tsc build cache alongside node_modules', async () => {
    const dir = await tempDir('artifacts');
    await fs.writeFile(path.join(dir, 'package.json'), '{}');
    const log = await logIn(dir);

    await provisionWorktree({ worktreePath: dir, log, actorId: 'operator', ticketId: 'T-1' });

    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(ignore).toContain('node_modules/');
    expect(ignore).toContain('*.tsbuildinfo');
  });

  it("never overwrites the project's own .gitignore", async () => {
    const dir = await tempDir('keeps');
    await fs.writeFile(path.join(dir, 'package.json'), '{}');
    await fs.writeFile(path.join(dir, '.gitignore'), 'secrets.env\n');
    const log = await logIn(dir);

    await provisionWorktree({ worktreePath: dir, log, actorId: 'operator', ticketId: 'T-1' });

    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(ignore).toContain('secrets.env');
    expect(ignore).toContain('*.tsbuildinfo');
  });
});
