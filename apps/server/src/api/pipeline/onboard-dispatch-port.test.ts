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
import { putProviders } from '../server/providers-store.js';
import { putModelMatrix } from '../server/model-matrix-store.js';

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
    path.join(os.tmpdir(), 'dokima-onboard-dispatch-test-'),
  );
  await git(repoRoot, ['init', '-b', 'main']);
  await git(repoRoot, ['config', 'user.name', 'Dokima Test']);
  await git(repoRoot, ['config', 'user.email', 'test@dokima.invalid']);
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

  it('runs a real @dokima/loop runSession whose spawn calls the real gateway (no network — fake HTTP server only)', async () => {
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

/**
 * W10-45. The seam W10-03 wired for `gateway-model-port.ts` and left unwired
 * here: the onboard/analysis path resolved its model from three env vars and
 * built an unconditional oai-compat provider, so whatever the user picked in
 * the Providers panel was silently ignored on the one path the dogfood runs.
 *
 * Two REAL gateways, not mocks — the assertion is which socket received the
 * request, which is the only thing that distinguishes a wired seam from a
 * plausible-looking one.
 */
describe('createRealOnboardDispatch model resolution (W10-45)', () => {
  let repo: TempRepo | undefined;
  let providerA: FakeGatewayServer | undefined;
  let providerB: FakeGatewayServer | undefined;

  afterEach(async () => {
    resetLoopModuleCacheForTests();
    await providerA?.close();
    await providerB?.close();
    await repo?.cleanup();
    repo = providerA = providerB = undefined;
  });

  const dispatchOnce = (repoRoot: string, role: string) =>
    createRealOnboardDispatch({ repoRoot })(role, {
      stepId: 'security',
      seedContext: {},
      priorArtifacts: {},
      deliverables: [{ id: 'docs/SECURITY.md', producingRole: role }],
    });

  it('RED FIXTURE: the matrix picks the provider — a row pointing at B routes the call to B, not A', async () => {
    repo = await createTempRepo();
    providerA = await startFakeGatewayServer([JSON.stringify(VALID_COMPLETION)]);
    providerB = await startFakeGatewayServer([JSON.stringify(VALID_COMPLETION)]);

    await putProviders(repo.repoRoot, [
      { id: 'alpha', kind: 'oai-compat', baseUrl: providerA.url, enabled: true },
      { id: 'beta', kind: 'oai-compat', baseUrl: providerB.url, enabled: true },
    ]);
    // `<providerId>/<model>` is the binding convention model-resolution.ts uses.
    await putModelMatrix(repo.repoRoot, [
      { role: 'security-auditor', taskType: 'reasoning', model: 'beta/chosen-model', fallback: [] },
    ]);

    await dispatchOnce(repo.repoRoot, 'security-auditor');

    // Before this ticket BOTH of these were wrong: A (well, localhost:1234)
    // got the call and B never heard from anyone.
    expect(providerB.requests).toHaveLength(1);
    expect(providerA.requests).toHaveLength(0);
    expect(providerB.requests[0]).toMatchObject({ model: 'chosen-model' });
  });

  it('resolves PER ROLE — two roles with different matrix rows reach different providers in one run', async () => {
    repo = await createTempRepo();
    providerA = await startFakeGatewayServer([JSON.stringify(VALID_COMPLETION)]);
    providerB = await startFakeGatewayServer([JSON.stringify(VALID_COMPLETION)]);

    await putProviders(repo.repoRoot, [
      { id: 'alpha', kind: 'oai-compat', baseUrl: providerA.url, enabled: true },
      { id: 'beta', kind: 'oai-compat', baseUrl: providerB.url, enabled: true },
    ]);
    await putModelMatrix(repo.repoRoot, [
      { role: 'landscape-mapper', taskType: 'reasoning', model: 'alpha/map-model', fallback: [] },
      { role: 'security-auditor', taskType: 'reasoning', model: 'beta/audit-model', fallback: [] },
    ]);

    // Resolving once at construction — the obvious wrong fix — would send both
    // of these to whichever role happened to be resolved first.
    await dispatchOnce(repo.repoRoot, 'landscape-mapper');
    await dispatchOnce(repo.repoRoot, 'security-auditor');

    expect(providerA.requests).toHaveLength(1);
    expect(providerB.requests).toHaveLength(1);
    expect(providerA.requests[0]).toMatchObject({ model: 'map-model' });
    expect(providerB.requests[0]).toMatchObject({ model: 'audit-model' });
  });

  it('falls back to the env config when nothing is configured — a normal first-run state, not an error (C-1)', async () => {
    repo = await createTempRepo();
    providerA = await startFakeGatewayServer([JSON.stringify(VALID_COMPLETION)]);

    // No providers, no matrix rows. The e2e fake-model gateway depends on this
    // path continuing to work, so env must stay a working documented override.
    process.env.DOKIMA_MODEL_BASE_URL = providerA.url;
    process.env.DOKIMA_MODEL_ID = 'env-model';
    try {
      await dispatchOnce(repo.repoRoot, 'security-auditor');
    } finally {
      delete process.env.DOKIMA_MODEL_BASE_URL;
      delete process.env.DOKIMA_MODEL_ID;
    }

    expect(providerA.requests).toHaveLength(1);
    expect(providerA.requests[0]).toMatchObject({ model: 'env-model' });
  });

  it('an explicit config still wins outright — the seam tests and the e2e gateway drive', async () => {
    repo = await createTempRepo();
    providerA = await startFakeGatewayServer([JSON.stringify(VALID_COMPLETION)]);
    providerB = await startFakeGatewayServer([JSON.stringify(VALID_COMPLETION)]);

    await putProviders(repo.repoRoot, [
      { id: 'beta', kind: 'oai-compat', baseUrl: providerB.url, enabled: true },
    ]);
    await putModelMatrix(repo.repoRoot, [
      { role: 'security-auditor', taskType: 'reasoning', model: 'beta/ignored', fallback: [] },
    ]);

    await createRealOnboardDispatch({
      repoRoot: repo.repoRoot,
      config: { baseUrl: providerA.url, model: 'explicit-model', fetchImpl: fetch },
    })('security-auditor', {
      stepId: 'security',
      seedContext: {},
      priorArtifacts: {},
      deliverables: [{ id: 'docs/SECURITY.md', producingRole: 'security-auditor' }],
    });

    expect(providerA.requests).toHaveLength(1);
    expect(providerB.requests).toHaveLength(0);
  });
});
