/**
 * W13-25. SC-07 was documented as landed and had zero callers; this is the
 * refusal that keeps it honest when a host cannot isolate.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import {
  assertSandboxOrWaiver,
  refusedToolRunner,
  sandboxSettingRefusal,
} from './sandbox-preflight.js';

vi.mock('@dokima/harbormaster', async () => {
  const actual =
    await vi.importActual<typeof import('@dokima/harbormaster')>('@dokima/harbormaster');
  return {
    ...actual,
    isSandboxProfileAvailable: vi.fn(),
    setUnsandboxedVerifyWaiver: vi.fn(),
  };
});
const { isSandboxProfileAvailable, setUnsandboxedVerifyWaiver } =
  await import('@dokima/harbormaster');

const dirs: string[] = [];
let log: EventLog | undefined;

afterEach(async () => {
  log?.close();
  log = undefined;
  vi.resetAllMocks();
  delete process.env.DOKIMA_ALLOW_UNSANDBOXED_VERIFY;
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function openLog(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-sandbox-pre-'));
  dirs.push(dir);
  const opened = openEventLog(path.join(dir, 'state.db'));
  createIdentity(opened, { id: 'worker-1', name: 'worker', kind: 'machine' });
  log = opened;
  return opened;
}

function io() {
  const stderr: string[] = [];
  return {
    stderr,
    io: { cwd: '.', stdout: () => {}, stderr: (l: string) => stderr.push(l) },
  };
}

describe('assertSandboxOrWaiver (W13-25)', () => {
  it('lets a run proceed when the host can isolate', async () => {
    vi.mocked(isSandboxProfileAvailable).mockReturnValue(true);
    const sink = io();
    expect(
      assertSandboxOrWaiver(await openLog(), 'worker-1', 'run-1', sink.io as never),
    ).toBe(true);
    expect(sink.stderr).toEqual([]);
  });

  it(
    'RED FIXTURE: refuses when it cannot, rather than running unsandboxed. A ' +
      'silent fallback would make the board show a green it did not earn — ' +
      'worse than never having claimed the control, and SC-07 claimed it as ' +
      'landed since W6-06 while the module had zero callers',
    async () => {
      vi.mocked(isSandboxProfileAvailable).mockReturnValue(false);
      const sink = io();
      expect(
        assertSandboxOrWaiver(await openLog(), 'worker-1', 'run-1', sink.io as never),
      ).toBe(false);
      const said = sink.stderr.join('\n');
      // Names the control, what to install, and that nothing was claimed.
      expect(said).toMatch(/SC-07/);
      expect(said).toMatch(/sandbox-exec|unshare/);
      expect(said).toMatch(/Nothing was claimed/);
    },
  );

  it(
    'the waiver is EXPLICIT AND RECORDED, never a silent fallback — a run that ' +
      'uses it appends sandbox.waived so the log says the gate ran without its ' +
      'isolation',
    async () => {
      vi.mocked(isSandboxProfileAvailable).mockReturnValue(false);
      process.env.DOKIMA_ALLOW_UNSANDBOXED_VERIFY = '1';
      const opened = await openLog();
      const sink = io();

      expect(assertSandboxOrWaiver(opened, 'worker-1', 'run-1', sink.io as never)).toBe(
        true,
      );
      const waived = listEvents(opened).filter((e) => e.eventType === 'sandbox.waived');
      expect(waived).toHaveLength(1);
      expect(waived[0]?.runId).toBe('run-1');
      // And it says so out loud, not only in the log.
      expect(sink.stderr.join('\n')).toMatch(/UNSANDBOXED/);
      // W23-44 RED: and the verify runs it waives actually get the waiver —
      // before this, the preflight passed and every reRunVerify threw.
      expect(setUnsandboxedVerifyWaiver).toHaveBeenCalledWith(true);
    },
  );
});

/**
 * W23-57: DEPLOYMENT §5 told users to set `sandbox: container`, and no
 * production caller ever read it — every run went through the process profile
 * whatever the project chose, silently. Until the profile is wired for real
 * (W23-61) the choice is REFUSED with the reason at every door, never ignored.
 */
describe('sandboxSettingRefusal (W23-57)', () => {
  async function projectWith(settings: Record<string, unknown> | null): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-sandbox-setting-'));
    dirs.push(dir);
    if (settings) {
      await fs.mkdir(path.join(dir, '.dokima'));
      await fs.writeFile(
        path.join(dir, '.dokima', 'settings.json'),
        JSON.stringify(settings),
      );
    }
    return dir;
  }

  it('RED FIXTURE: settings `sandbox: container` is refused by name — never read as "process"', async () => {
    const refusal = await sandboxSettingRefusal(
      await projectWith({ sandbox: 'container' }),
    );
    expect(refusal).toMatch(/sandbox: container/);
    expect(refusal).toMatch(/W23-61/);
  });

  it('no setting, or `process`, is the default and proceeds', async () => {
    expect(await sandboxSettingRefusal(await projectWith(null))).toBeNull();
    expect(
      await sandboxSettingRefusal(await projectWith({ sandbox: 'process' })),
    ).toBeNull();
  });

  it('an unknown value is refused rather than coerced to the default', async () => {
    expect(await sandboxSettingRefusal(await projectWith({ sandbox: 'vm' }))).toMatch(
      /"vm"/,
    );
  });

  it('the refused tool runner runs nothing and says why', async () => {
    const out = await refusedToolRunner('the reason')(
      { executable: 'touch' } as never,
      ['x'],
      { cwd: '.', allowNetwork: false, timeoutMs: 1000 } as never,
    );
    expect(out.exitCode).toBeNull();
    expect(out.stderr).toContain('the reason');
  });
});
