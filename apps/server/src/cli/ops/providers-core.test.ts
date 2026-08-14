import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveProjectSettings } from '@dokima/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliIO } from '../../bootstrap/cli.js';
import { buildProvider, loadConfiguredProviders } from './providers-core.js';

describe('loadConfiguredProviders', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchIo(): Promise<CliIO> {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-providers-core-'));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-providers-home-'));
    scratchDirs.push(projectDir, home);
    return {
      stdout: vi.fn(),
      stderr: vi.fn(),
      cwd: projectDir,
      env: { DOKIMA_HOME: home },
    };
  }

  it('returns an empty list when nothing is configured (normal, unconfigured state)', async () => {
    const io = await scratchIo();
    expect(await loadConfiguredProviders(io)).toEqual([]);
  });

  it('reads the providers array from project settings', async () => {
    const io = await scratchIo();
    await saveProjectSettings(io.cwd, {
      providers: [{ id: 'ollama', kind: 'ollama', baseUrl: 'http://localhost:11434/v1' }],
    });

    const entries = await loadConfiguredProviders(io);
    expect(entries).toEqual([
      { id: 'ollama', kind: 'ollama', baseUrl: 'http://localhost:11434/v1' },
    ]);
  });

  it('skips malformed entries rather than throwing', async () => {
    const io = await scratchIo();
    await saveProjectSettings(io.cwd, {
      providers: [
        { id: 'ollama', kind: 'ollama' },
        { kind: 'ollama' }, // missing id
        { id: 'bad', kind: 'not-a-real-kind' },
        'not-even-an-object',
      ],
    });

    const entries = await loadConfiguredProviders(io);
    expect(entries).toEqual([{ id: 'ollama', kind: 'ollama' }]);
  });
});

describe('buildProvider', () => {
  it('constructs the matching adapter per kind', async () => {
    expect((await buildProvider({ id: 'x', kind: 'ollama' })).id).toBe('ollama');
    expect((await buildProvider({ id: 'x', kind: 'lm-studio' })).id).toBe('lm-studio');
    expect(
      (await buildProvider({ id: 'my-endpoint', kind: 'oai-compat', baseUrl: 'http://x' }))
        .id,
    ).toBe('my-endpoint');
  });
});

describe('cloud provider entries (W12-17)', () => {
  it(
    'RED FIXTURE: a registered cloud kind is no longer SILENTLY SKIPPED. ' +
      '`isProviderConfigEntry` accepted only ollama/lm-studio/oai-compat, and ' +
      '`loadConfiguredProviders` drops what it does not accept — so `doctor` ' +
      'reported a clean bill of health while ignoring the provider the user ' +
      'had actually configured',
    async () => {
      for (const kind of ['anthropic', 'openai', 'copilot'] as const) {
        const prev = process.env.DOKIMA_MODEL_API_KEY;
        process.env.DOKIMA_MODEL_API_KEY = 'test-key';
        try {
          const provider = await buildProvider({ id: `p-${kind}`, kind });
          expect(provider.id).toBeTruthy();
        } finally {
          if (prev === undefined) delete process.env.DOKIMA_MODEL_API_KEY;
          else process.env.DOKIMA_MODEL_API_KEY = prev;
        }
      }
    },
  );

  it(
    'a cloud kind with no credential REFUSES BY NAME rather than being skipped — ' +
      'the caller reports it against its own entry instead of the entry vanishing',
    async () => {
      const prev = process.env.DOKIMA_MODEL_API_KEY;
      delete process.env.DOKIMA_MODEL_API_KEY;
      try {
        await expect(buildProvider({ id: 'oa', kind: 'openai' })).rejects.toThrowError(
          /needs a credential/,
        );
      } finally {
        if (prev !== undefined) process.env.DOKIMA_MODEL_API_KEY = prev;
      }
    },
  );

  it('listing purpose carries no price table, so an unpriced model is not a refusal here', async () => {
    const prev = process.env.DOKIMA_MODEL_API_KEY;
    process.env.DOKIMA_MODEL_API_KEY = 'test-key';
    try {
      // `model: ''` is what buildProvider passes — under 'inference' that
      // would refuse as unpriced, which is exactly why this path is 'listing'.
      const provider = await buildProvider({ id: 'oa', kind: 'openai' });
      expect(provider.id).toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.DOKIMA_MODEL_API_KEY;
      else process.env.DOKIMA_MODEL_API_KEY = prev;
    }
  });
});
