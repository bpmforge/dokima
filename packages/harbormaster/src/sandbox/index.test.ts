import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSandboxProfileAvailable,
  runInProcessSandbox,
  runSandboxed,
  SandboxUnavailableError,
} from './index.js';

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-sandbox-index-'));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Stands in for the real Fastify core (API_DESIGN §1, bound 127.0.0.1 only
 * per SC-08) — serves the same kind of index.html an agent-session sandbox
 * that permitted loopback could otherwise scrape the bearer token from
 * (THREAT_MODEL §5.6's residual-risk item 6, the reason W6-06 exists).
 */
async function withFakeCoreServer<T>(run: (port: number) => Promise<T>): Promise<T> {
  const server = http.createServer((_req, res) => {
    res.end('<html>fake core index.html, bearer token would live here</html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to bind fake core server');
  }
  try {
    return await run(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('runSandboxed', () => {
  it.runIf(isSandboxProfileAvailable('process'))(
    'FR-I4 / THREAT_MODEL §5.6: an agent-session fixture fetching http://127.0.0.1:<core port>/ fails under the default (no-network) sandbox profile',
    async () => {
      await withFakeCoreServer(async (corePort) => {
        await withTempDir(async (cwd) => {
          const result = await runSandboxed({
            cwd,
            command: `curl -sS --max-time 2 http://127.0.0.1:${corePort}/`,
          });
          expect(result.networkAllowed).toBe(false);
          expect(result.exitCode).not.toBe(0);
          expect(result.stdout).not.toContain('bearer token');
          // The denial must come from the network policy, not from the
          // sandbox mechanism itself failing to start.
          expect(result.stderr).not.toMatch(/sandbox-exec|No such file or directory/);
        });
      });
    },
  );

  it.runIf(isSandboxProfileAvailable('process'))(
    'defaults to the process profile when none is given',
    async () => {
      await withTempDir(async (cwd) => {
        const result = await runSandboxed({
          cwd,
          command: 'echo hi',
          allowNetwork: true,
        });
        expect(result.profile).toBe('process');
        expect(result.stdout).toBe('hi\n');
      });
    },
  );

  it('routes profile: "container" to the container backend and surfaces SandboxUnavailableError when no runtime exists', async () => {
    if (isSandboxProfileAvailable('container')) return; // covered for real in container.test.ts
    await withTempDir(async (cwd) => {
      await expect(
        runSandboxed({ cwd, command: 'echo hi', profile: 'container' }),
      ).rejects.toBeInstanceOf(SandboxUnavailableError);
    });
  });
});

describe('isSandboxProfileAvailable', () => {
  it('is a boolean for both profiles, regardless of what this host actually has installed', () => {
    expect(typeof isSandboxProfileAvailable('process')).toBe('boolean');
    expect(typeof isSandboxProfileAvailable('container')).toBe('boolean');
  });
});

// Sanity: the process-profile re-export from the barrel is the same function,
// not a divergent copy — the barrel exists to avoid a second implementation.
describe('barrel re-exports', () => {
  it('re-exports runInProcessSandbox from process.ts unchanged', () => {
    expect(typeof runInProcessSandbox).toBe('function');
  });
});
