import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveProjectSettings } from '@shipwright/shared';
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
      env: { SHIPWRIGHT_HOME: home },
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
  it('constructs the matching adapter per kind', () => {
    expect(buildProvider({ id: 'x', kind: 'ollama' }).id).toBe('ollama');
    expect(buildProvider({ id: 'x', kind: 'lm-studio' }).id).toBe('lm-studio');
    expect(
      buildProvider({ id: 'my-endpoint', kind: 'oai-compat', baseUrl: 'http://x' }).id,
    ).toBe('my-endpoint');
  });
});
