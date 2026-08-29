/**
 * W13-13. Found in live testing: a 27B model on local hardware exceeded the
 * 300s request timeout, `ProviderTimeoutError` propagated out of `runLandLoop`
 * and killed the run with a stack trace — after the session had already
 * written correct code, verified it to exit 0 and committed it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ProviderTimeoutError,
  ProviderUnreachableError,
  ProviderHttpError,
} from '@dokima/gateway';
import { runSessionAbsorbingProviderFailure } from './loop-land-session.js';

const handoff = {
  role: 'coding-agent',
  mission: 'do the thing',
  ticket: { id: 'T-1', title: 'do the thing' },
  context: 'ctx',
  writeScope: ['src/**'],
  produce: ['a thing'],
  verify: 'true',
};

/**
 * W22-18: every temp directory this file makes, removed after its tests.
 *
 * These leaked because the cleanup was per-test and partial: a test that
 * failed early, or a path with no `afterEach` of its own, left its directory
 * behind and nothing ever failed because of it. Tracking what was actually
 * made is what makes the sweep complete rather than a list someone has to
 * remember to extend.
 *
 * `force` so removing twice is fine — the per-test cleanups that already
 * exist stay, and this only catches what they miss.
 */
const madeTempDirs: string[] = [];

afterAll(async () => {
  for (const dir of madeTempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function cwd(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1313-'));
  madeTempDirs.push(dir);
  return dir;
}

describe('a provider failure ends the attempt, not the process (W13-13)', () => {
  it(
    'RED FIXTURE: a timeout returns a failed SessionResult instead of throwing. ' +
      'It used to propagate out of runLandLoop and kill the run, stranding the ' +
      'ticket in in_progress with correct work already committed',
    async () => {
      const { result, infraFailure } = await runSessionAbsorbingProviderFailure({
        handoff,
        cwd: await cwd(),
        spawn: () => {
          throw new ProviderTimeoutError('lm-studio', 300_000);
        },
      });
      expect(result.manifest).toBeNull();
      // W13-27: classified as infrastructure, so the ladder does not pay for it.
      expect(infraFailure).toBe('endpoint_failure');
      expect(result.exitCode).not.toBe(0);
    },
  );

  it(
    'says WHICH failure it was. "did not answer in time" and "answered without ' +
      'a manifest" point at different fixes — a longer timeout versus a ' +
      'different model — and someone choosing a smaller model needs to tell them apart',
    async () => {
      const { result, infraFailure } = await runSessionAbsorbingProviderFailure({
        handoff,
        cwd: await cwd(),
        spawn: () => {
          throw new ProviderTimeoutError('lm-studio', 300_000);
        },
      });
      expect(infraFailure).toBe('endpoint_failure');
      expect(result.output).toContain('provider failure');
      expect(result.output).toContain('timed out');
      expect(result.output).not.toContain('completion manifest');
    },
  );

  it('absorbs the other endpoint failures too — unreachable and HTTP are the same class of fact', async () => {
    for (const err of [
      new ProviderUnreachableError('lm-studio', 'ECONNREFUSED'),
      new ProviderHttpError('lm-studio', 503, 'Service Unavailable', 'upstream unavailable'),
    ]) {
      const { result, infraFailure } = await runSessionAbsorbingProviderFailure({
        handoff,
        cwd: await cwd(),
        spawn: () => {
          throw err;
        },
      });
      expect(result.manifest).toBeNull();
      expect(result.output).toContain('provider failure');
      // Every endpoint shape classifies the same way: none of them is
      // evidence about the work, so none costs an attempt (W13-27).
      expect(infraFailure).toBe('endpoint_failure');
    }
  });

  it(
    'does NOT absorb our own bugs. A catch-all here would turn a crash in the ' +
      'close gate into a quiet "attempt failed", which is the silence this ' +
      'product exists to refuse',
    async () => {
      await expect(
        runSessionAbsorbingProviderFailure({
          handoff,
          cwd: await cwd(),
          spawn: () => {
            throw new TypeError("Cannot read properties of undefined (reading 'x')");
          },
        }),
      ).rejects.toThrow(TypeError);
    },
  );
});
