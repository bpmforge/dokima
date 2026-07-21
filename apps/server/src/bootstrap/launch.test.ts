import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { detectRunningCore, openBrowser, resolveOpenCommand } from './launch.js';

describe('detectRunningCore', () => {
  it('returns true when healthz responds (ok)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const result = await detectRunningCore({
      port: 4317,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/healthz',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('returns true when healthz responds degraded (503) — still someone is bound there', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    const result = await detectRunningCore({
      port: 4317,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe(true);
  });

  it('returns false when the connection is refused (nothing listening)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await detectRunningCore({
      port: 4317,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe(false);
  });
});

describe('resolveOpenCommand', () => {
  it('uses `open` on macOS', () => {
    expect(resolveOpenCommand('http://x', 'darwin')).toEqual({
      command: 'open',
      args: ['http://x'],
    });
  });

  it('uses `xdg-open` on linux (and WSL, D-009)', () => {
    expect(resolveOpenCommand('http://x', 'linux')).toEqual({
      command: 'xdg-open',
      args: ['http://x'],
    });
  });

  it('uses cmd start on win32', () => {
    expect(resolveOpenCommand('http://x', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '""', 'http://x'],
    });
  });
});

describe('openBrowser', () => {
  function fakeChildProcess() {
    const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
    emitter.unref = vi.fn();
    return emitter;
  }

  it('spawns the platform-resolved command detached and never throws', () => {
    const child = fakeChildProcess();
    const spawnImpl = vi.fn().mockReturnValue(child);
    const result = openBrowser('http://127.0.0.1:4317', {
      platform: 'darwin',
      spawnImpl: spawnImpl as unknown as typeof import('node:child_process').spawn,
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      'open',
      ['http://127.0.0.1:4317'],
      expect.objectContaining({ detached: true }),
    );
    expect(result).toBe(child);
  });

  it('swallows a spawn failure (headless box, no browser) rather than throwing', () => {
    const spawnImpl = vi.fn(() => {
      throw new Error('spawn xdg-open ENOENT');
    });
    const result = openBrowser('http://127.0.0.1:4317', {
      platform: 'linux',
      spawnImpl: spawnImpl as unknown as typeof import('node:child_process').spawn,
    });
    expect(result).toBeNull();
  });
});
