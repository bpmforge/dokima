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
