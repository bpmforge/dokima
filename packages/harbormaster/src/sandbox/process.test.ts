import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isProcessSandboxAvailable, runInProcessSandbox } from './process.js';
import { SandboxUnavailableError } from './types.js';

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-sandbox-proc-'));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** A throwaway loopback listener standing in for "the core" (THREAT_MODEL §5.6). */
async function withLoopbackServer<T>(run: (port: number) => Promise<T>): Promise<T> {
  const server = http.createServer((_req, res) => res.end('reached'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to bind loopback test server');
  }
  try {
    return await run(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('runInProcessSandbox', () => {
  it.runIf(isProcessSandboxAvailable())(
    'FR-I4: denies network by default, even to a live loopback listener (THREAT_MODEL §5.6)',
    async () => {
      await withLoopbackServer(async (port) => {
        await withTempDir(async (cwd) => {
          const result = await runInProcessSandbox({
            cwd,
            command: `curl -sS --max-time 2 http://127.0.0.1:${port}/`,
          });
          expect(result.exitCode).not.toBe(0);
          expect(result.stdout).not.toContain('reached');
          expect(result.networkAllowed).toBe(false);
          // Denial must come from curl being blocked by the network policy,
          // not from sandbox-exec failing to start (e.g. its profile file
          // having been deleted before the child ever ran).
          expect(result.stderr).not.toMatch(/sandbox-exec|No such file or directory/);
        });
      });
    },
  );

  it.runIf(isProcessSandboxAvailable())(
    'runs a benign command successfully under the default (network-denied) profile',
    async () => {
      await withTempDir(async (cwd) => {
        const result = await runInProcessSandbox({ cwd, command: 'echo hi' });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('hi\n');
        expect(result.networkAllowed).toBe(false);
      });
    },
  );

  it.runIf(isProcessSandboxAvailable())(
    'allows network when the project opts in (allowNetwork: true)',
    async () => {
      await withLoopbackServer(async (port) => {
        await withTempDir(async (cwd) => {
          const result = await runInProcessSandbox({
            cwd,
            command: `curl -sS --max-time 2 http://127.0.0.1:${port}/`,
            allowNetwork: true,
          });
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('reached');
          expect(result.networkAllowed).toBe(true);
        });
      });
    },
  );

  it('never carries the parent process env through to the sandboxed command', async () => {
    process.env.SHIPWRIGHT_SANDBOX_TEST_SECRET = 'sk-should-never-leak';
    try {
      await withTempDir(async (cwd) => {
        const result = await runInProcessSandbox({
          cwd,
          command: 'echo "[$SHIPWRIGHT_SANDBOX_TEST_SECRET]"',
          allowNetwork: true,
        });
        expect(result.stdout).toContain('[]');
      });
    } finally {
      delete process.env.SHIPWRIGHT_SANDBOX_TEST_SECRET;
    }
  });

  it('runs the command in the given cwd', async () => {
    await withTempDir(async (cwd) => {
      await fs.writeFile(path.join(cwd, 'marker.txt'), 'hi', 'utf8');
      const result = await runInProcessSandbox({
        cwd,
        command: 'cat marker.txt',
        allowNetwork: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hi');
    });
  });

  it('kills a hung command once timeoutMs elapses, well under the process timeout', async () => {
    await withTempDir(async (cwd) => {
      const start = Date.now();
      const result = await runInProcessSandbox({
        cwd,
        command: 'sleep 30',
        allowNetwork: true,
        timeoutMs: 50,
        forceKillGraceMs: 50,
      });
      const elapsed = Date.now() - start;
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(elapsed).toBeLessThan(1_000);
    });
  });

  it('refuses to run rather than silently skip isolation on an unsupported platform', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await withTempDir(async (cwd) => {
        await expect(
          runInProcessSandbox({ cwd, command: 'echo hi' }),
        ).rejects.toBeInstanceOf(SandboxUnavailableError);
      });
    } finally {
      if (original) Object.defineProperty(process, 'platform', original);
    }
  });
});

describe('isProcessSandboxAvailable', () => {
  afterEach(() => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    if (original && original.value !== process.platform) {
      Object.defineProperty(process, 'platform', original);
    }
  });

  it('is false for a platform with no implemented isolation mechanism', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(isProcessSandboxAvailable()).toBe(false);
    } finally {
      if (original) Object.defineProperty(process, 'platform', original);
    }
  });
});
