import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRealOnboardDispatch,
  resetLoopModuleCacheForTests,
} from './onboard-dispatch-port.js';
import { MalformedModelOutputError } from './errors.js';
import { startFakeGatewayServer, type FakeGatewayServer } from './test-fake-gateway.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

interface TempRepo {
  repoRoot: string;
  cleanup: () => Promise<void>;
}

async function createTempRepo(): Promise<TempRepo> {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'shipwright-onboard-dispatch-test-'),
  );
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Shipwright Test']);
  await git(repoRoot, ['config', 'user.email', 'test@shipwright.invalid']);
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# fixture\n');
  await git(repoRoot, ['add', '--', 'README.md']);
  await git(repoRoot, ['commit', '-m', 'chore: initial commit']);
  return { repoRoot, cleanup: () => fs.rm(repoRoot, { recursive: true, force: true }) };
}

const VALID_COMPLETION = {
  summary: 'The repo looks fine.',
  findings: [
    {
      title: 'No lockfile pinning',
      severity: 'MEDIUM',
      recommendation: 'Pin transitive deps.',
      verify: 'true',
    },
  ],
};

describe('createRealOnboardDispatch (W8-09 AC1 — real gateway + real runSession, Law 6/9)', () => {
  let repo: TempRepo | undefined;
  let server: FakeGatewayServer | undefined;

  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
    await server?.close();
    server = undefined;
    resetLoopModuleCacheForTests();
  });

  it('runs a real @shipwright/loop runSession whose spawn calls the real gateway (no network — fake HTTP server only)', async () => {
    repo = await createTempRepo();
    server = await startFakeGatewayServer([JSON.stringify(VALID_COMPLETION)]);

    const dispatch = createRealOnboardDispatch({
      repoRoot: repo.repoRoot,
      config: { baseUrl: server.url, model: 'local-model', fetchImpl: fetch },
    });

    const artifact = await dispatch('health-coordinator', {
      stepId: 'health',
      seedContext: { repoRoot: repo.repoRoot },
      priorArtifacts: {},
      deliverables: [
        { id: 'docs/HEALTH_ASSESSMENT.md', producingRole: 'health-coordinator' },
      ],
    });

    expect(artifact.stepId).toBe('health');
    expect(artifact.role).toBe('health-coordinator');
    expect(artifact.summary).toBe('The repo looks fine.');
    expect(artifact.findings).toEqual(VALID_COMPLETION.findings);
    expect(artifact.session.exitCode).toBe(0);
    expect(artifact.session.scopeViolations).toEqual([]);

    // Proves the call actually reached the fake HTTP server (gateway), not a
    // child process or any other network path.
    expect(server.requests).toHaveLength(1);
    const body = server.requests[0] as { messages: { role: string; content: string }[] };
    expect(body.messages[1]?.content).toContain('ROLE: health-coordinator');
    expect(body.messages[1]?.content).toContain('health');
  });

  it('throws MalformedModelOutputError on a non-JSON specialist completion', async () => {
    repo = await createTempRepo();
    server = await startFakeGatewayServer(['not json at all']);

    const dispatch = createRealOnboardDispatch({
      repoRoot: repo.repoRoot,
      config: { baseUrl: server.url, model: 'local-model', fetchImpl: fetch },
    });

    await expect(
      dispatch('landscape-mapper', {
        stepId: 'landscape',
        seedContext: {},
        priorArtifacts: {},
        deliverables: [{ id: 'docs/LANDSCAPE.md', producingRole: 'landscape-mapper' }],
      }),
    ).rejects.toBeInstanceOf(MalformedModelOutputError);
  });

  it('throws MalformedModelOutputError when findings are missing a required field', async () => {
    repo = await createTempRepo();
    server = await startFakeGatewayServer([
      JSON.stringify({ summary: 'x', findings: [{ title: 'no severity' }] }),
    ]);

    const dispatch = createRealOnboardDispatch({
      repoRoot: repo.repoRoot,
      config: { baseUrl: server.url, model: 'local-model', fetchImpl: fetch },
    });

    await expect(
      dispatch('landscape-mapper', {
        stepId: 'landscape',
        seedContext: {},
        priorArtifacts: {},
        deliverables: [{ id: 'docs/LANDSCAPE.md', producingRole: 'landscape-mapper' }],
      }),
    ).rejects.toBeInstanceOf(MalformedModelOutputError);
  });
});
