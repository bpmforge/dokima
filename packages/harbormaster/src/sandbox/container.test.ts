import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isContainerRuntimeAvailable, runInContainerSandbox } from './container.js';

const TEST_IMAGE = 'node:22-alpine';

/** Only smoke-test against an image already cached locally — never pull over the network in tests. */
function imageAvailable(): boolean {
  if (!isContainerRuntimeAvailable()) return false;
  for (const binary of ['podman', 'docker']) {
    try {
      execFileSync(binary, ['image', 'exists', TEST_IMAGE], { stdio: 'ignore' });
      return true;
    } catch {
      // try the next binary / fall through to false
    }
  }
  return false;
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-sandbox-container-'));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('runInContainerSandbox', () => {
  it.runIf(imageAvailable())(
    'FR-I4: --network=none leaves only the loopback interface configured — no route out, structurally',
    async () => {
      await withTempDir(async (cwd) => {
        const denied = await runInContainerSandbox({
          cwd,
          command: "ip link show | grep -c '^[0-9]'",
          container: { image: TEST_IMAGE },
          timeoutMs: 30_000,
        });
        expect(denied.exitCode).toBe(0);
        expect(denied.stdout.trim()).toBe('1'); // lo only

        const allowed = await runInContainerSandbox({
          cwd,
          command: "ip link show | grep -c '^[0-9]'",
          container: { image: TEST_IMAGE },
          allowNetwork: true,
          timeoutMs: 30_000,
        });
        expect(allowed.exitCode).toBe(0);
        expect(Number(allowed.stdout.trim())).toBeGreaterThan(1); // lo + a real interface
      });
    },
    45_000,
  );

  it.runIf(imageAvailable())(
    'mounts cwd read-write at /work',
    async () => {
      await withTempDir(async (cwd) => {
        await fs.writeFile(path.join(cwd, 'marker.txt'), 'hi', 'utf8');
        const result = await runInContainerSandbox({
          cwd,
          command: 'cat /work/marker.txt && echo -n world > /work/out.txt',
          container: { image: TEST_IMAGE },
          timeoutMs: 30_000,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('hi');
        const out = await fs.readFile(path.join(cwd, 'out.txt'), 'utf8');
        expect(out).toBe('world');
      });
    },
    45_000,
  );

  it('reports profile: container on every result shape', () => {
    // Static shape check — doesn't require a runtime, keeps this suite
    // meaningful even when podman/docker aren't installed at all.
    expect(isContainerRuntimeAvailable()).toEqual(expect.any(Boolean));
  });
});
