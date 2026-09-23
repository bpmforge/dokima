/**
 * W23-44: the unsandboxed-verify waiver reaches the runs it waives.
 *
 * PROVED before this existed: with sandbox-exec off PATH and
 * DOKIMA_ALLOW_UNSANDBOXED_VERIFY=1, the build run's preflight passed and
 * appended `sandbox.waived`, and then every `reRunVerify` threw
 * `SandboxUnavailableError` — the waiver was honoured at preflight and
 * nowhere after it. The host here CAN sandbox, so the platform is modelled:
 * the process profile reports unavailable and refuses exactly as the real one
 * does unless the caller allows network (the one path that needs no wrapper).
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxUnavailableError } from './types.js';

vi.mock('./process.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./process.js')>();
  return {
    ...real,
    isProcessSandboxAvailable: () => false,
    runInProcessSandbox: (options: Parameters<typeof real.runInProcessSandbox>[0]) => {
      if (!options.allowNetwork) {
        return Promise.reject(new SandboxUnavailableError('no isolation on this host'));
      }
      return real.runInProcessSandbox(options);
    },
  };
});

const { runSandboxed, setUnsandboxedVerifyWaiver, isUnsandboxedVerifyWaived } =
  await import('./index.js');
const { reRunVerify } = await import('../loop-gates-verify.js');

const dirs: string[] = [];
afterEach(async () => {
  setUnsandboxedVerifyWaiver(false);
  delete process.env.DOKIMA_WAIVER_TEST_SECRET;
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function cwd(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-waiver-'));
  dirs.push(dir);
  return dir;
}

describe('the unsandboxed-verify waiver (W23-44)', () => {
  it('without the waiver a host that cannot isolate still refuses (SC-07 unchanged)', async () => {
    await expect(runSandboxed({ cwd: await cwd(), command: 'true' })).rejects.toThrow(
      SandboxUnavailableError,
    );
    expect(isUnsandboxedVerifyWaived()).toBe(false);
  });

  it('RED FIXTURE: with the waiver switched on, the close gate verify RUNS instead of throwing', async () => {
    setUnsandboxedVerifyWaiver(true);
    const result = await reRunVerify(await cwd(), 'true', 10_000);
    expect(result.exitCode).toBe(0);
    expect(isUnsandboxedVerifyWaived()).toBe(true);
  });

  it('the waived run is what it says: network allowed, environment STILL cleaned', async () => {
    setUnsandboxedVerifyWaiver(true);
    process.env.DOKIMA_WAIVER_TEST_SECRET = 'must-not-leak';
    const result = await runSandboxed({
      cwd: await cwd(),
      command: 'test -z "$DOKIMA_WAIVER_TEST_SECRET"',
    });
    expect(result.exitCode).toBe(0);
    expect(result.networkAllowed).toBe(true);
  });
});
