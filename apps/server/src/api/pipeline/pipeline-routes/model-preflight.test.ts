/**
 * W17-05: the run button's preflight — unreachable refuses BEFORE any run
 * state exists; the injected-config seam (tests/CI, law 9a) skips it.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { putProviders } from '../../server/providers-store.js';
import { putModelMatrix } from '../../server/model-matrix-store.js';
import { preflightPipelineModel } from './model-preflight.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('preflightPipelineModel (W17-05)', () => {
  it('the injected-config seam skips preflight by design (law 9a — the fake gateway owes no /models contract)', async () => {
    const result = await preflightPipelineModel({
      projectPath: '/nowhere',
      injectedConfig: { baseUrl: 'http://fake', model: 'fake' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('RED FIXTURE: a project whose provider points at a dead endpoint refuses at the button with the model and fix location named', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-preflight-'));
    dirs.push(projectDir);
    await putProviders(projectDir, [
      {
        id: 'dead-box',
        kind: 'oai-compat',
        baseUrl: 'http://127.0.0.1:1/v1',
        enabled: true,
      } as never,
    ]);
    await putModelMatrix(projectDir, [
      {
        role: 'coding-agent',
        taskType: 'reasoning',
        providerId: 'dead-box',
        model: 'ghost-model',
        fallback: [],
        updatedAt: '2026-08-21T00:00:00.000Z',
      } as never,
    ]);

    const result = await preflightPipelineModel({ projectPath: projectDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('ghost-model');
      expect(result.reason).toContain('Settings -> Models');
      expect(result.reason).toContain('was not started');
    }
  });

  it('a project with nothing configured refuses with the no-model sentence, not a crash', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-preflight-empty-'));
    dirs.push(projectDir);
    const result = await preflightPipelineModel({ projectPath: projectDir });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no model is configured|Settings/);
  });
});
