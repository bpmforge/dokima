import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliIO } from '../../bootstrap/cli.js';
import type { ProviderConfigEntry } from './providers-core.js';
import { runProvidersRefreshCommand } from './providers-refresh.js';

describe('runProvidersRefreshCommand', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchIo(): Promise<CliIO> {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-providers-refresh-'));
    scratchDirs.push(projectDir);
    return { stdout: vi.fn(), stderr: vi.fn(), cwd: projectDir, env: {} };
  }

  it('reports "nothing to refresh" when no providers are configured', async () => {
    const io = await scratchIo();
    const code = await runProvidersRefreshCommand(io, {
      loadConfiguredProviders: vi.fn().mockResolvedValue([]),
    });

    expect(code).toBe(0);
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('nothing to refresh'));
  });

  it('discovers models and warms up every configured provider', async () => {
    const io = await scratchIo();
    const entry: ProviderConfigEntry = { id: 'ollama', kind: 'ollama' };
    const fakeProvider = {
      id: 'ollama',
      chat: vi.fn(),
      listModels: vi.fn().mockResolvedValue([{ id: 'llama3' }, { id: 'mistral' }]),
      getContextLength: vi.fn(),
      health: vi.fn(),
      warmUp: vi
        .fn()
        .mockResolvedValue({ status: 'ok', checkedAt: '2026-07-21T00:00:00Z' }),
      queueStats: vi.fn(),
    };

    const code = await runProvidersRefreshCommand(io, {
      loadConfiguredProviders: vi.fn().mockResolvedValue([entry]),
      buildProvider: vi.fn().mockReturnValue(fakeProvider),
    });

    expect(code).toBe(0);
    expect(fakeProvider.listModels).toHaveBeenCalled();
    expect(fakeProvider.warmUp).toHaveBeenCalled();
    expect(io.stdout).toHaveBeenCalledWith(
      expect.stringContaining('2 model(s) discovered, warm-up ok'),
    );
  });

  it('reports a provider as unreachable without throwing, and exits 1', async () => {
    const io = await scratchIo();
    const entry: ProviderConfigEntry = { id: 'ollama', kind: 'ollama' };
    const fakeProvider = {
      id: 'ollama',
      chat: vi.fn(),
      listModels: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      getContextLength: vi.fn(),
      health: vi.fn(),
      warmUp: vi.fn(),
      queueStats: vi.fn(),
    };

    const code = await runProvidersRefreshCommand(io, {
      loadConfiguredProviders: vi.fn().mockResolvedValue([entry]),
      buildProvider: vi.fn().mockReturnValue(fakeProvider),
    });

    expect(code).toBe(1);
    expect(io.stdout).toHaveBeenCalledWith(
      expect.stringContaining('unreachable: ECONNREFUSED'),
    );
  });
});
