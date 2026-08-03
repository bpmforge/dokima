import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderRegistryError, validateProviderRegistry } from '@dokima/gateway';
import {
  listProviders,
  PROVIDERS_SETTINGS_KEY,
  putProviders,
  removeProvider,
} from './providers-store.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function project(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-providers-'));
  dirs.push(dir);
  return dir;
}

describe('provider registry validation (W10-01)', () => {
  it('accepts a well-formed local endpoint', () => {
    const entries = validateProviderRegistry([
      {
        id: 'lm-studio-box',
        kind: 'oai-compat',
        baseUrl: 'http://127.0.0.1:1234/v1',
        enabled: true,
      },
    ]);
    expect(entries[0]?.id).toBe('lm-studio-box');
  });

  it('refuses an oai-compat entry with no baseUrl — it addresses a user endpoint', () => {
    expect(() =>
      validateProviderRegistry([{ id: 'x', kind: 'oai-compat', enabled: true }]),
    ).toThrowError(/requires baseUrl/);
  });

  it('refuses a non-http baseUrl scheme', () => {
    try {
      validateProviderRegistry([
        { id: 'x', kind: 'oai-compat', baseUrl: 'file:///etc/passwd', enabled: true },
      ]);
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as ProviderRegistryError).rule).toBe('invalid-base-url-scheme');
    }
  });

  it('refuses duplicate ids', () => {
    expect(() =>
      validateProviderRegistry([
        { id: 'dup', kind: 'ollama', enabled: true },
        { id: 'dup', kind: 'ollama', enabled: true },
      ]),
    ).toThrowError(/duplicate provider id/);
  });

  /** RED FIXTURE (D-019): Copilot must never be enableable by a plain registry write. */
  it('refuses to ENABLE copilot without a ledgered consent acknowledgement', () => {
    try {
      validateProviderRegistry([{ id: 'copilot', kind: 'copilot', enabled: true }]);
      throw new Error('expected a consent refusal');
    } catch (err) {
      expect((err as ProviderRegistryError).rule).toBe('consent-required');
    }
    // ...and accepts it once consent exists, so the gate is a gate, not a wall.
    expect(
      validateProviderRegistry(
        [{ id: 'copilot', kind: 'copilot', enabled: true }],
        ['copilot'],
      )[0]?.enabled,
    ).toBe(true);
    // A DISABLED copilot entry is fine without consent — registering is not enabling.
    expect(
      validateProviderRegistry([{ id: 'copilot', kind: 'copilot', enabled: false }])[0]
        ?.enabled,
    ).toBe(false);
  });
});

describe('provider registry persistence (W10-01)', () => {
  it('round-trips through the SAME `providers` settings key the CLI reads', async () => {
    const dir = await project();
    expect(await listProviders(dir)).toEqual([]);

    await putProviders(dir, [
      {
        id: 'local',
        kind: 'oai-compat',
        baseUrl: 'http://127.0.0.1:1234/v1',
        enabled: true,
      },
    ]);
    expect((await listProviders(dir))[0]?.id).toBe('local');

    // The load-bearing assertion: it lands under `providers` in the project
    // settings file, which is exactly what cli/ops/providers-core.ts reads via
    // getEffectiveSettings. One source of truth, not two.
    const raw = JSON.parse(
      await fs.readFile(path.join(dir, '.dokima', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(raw[PROVIDERS_SETTINGS_KEY]).toBeDefined();
  });

  it('a malformed stored value degrades to an empty registry, never throws', async () => {
    const dir = await project();
    await fs.mkdir(path.join(dir, '.dokima'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.dokima', 'settings.json'),
      JSON.stringify({ [PROVIDERS_SETTINGS_KEY]: 'not-an-array' }),
    );
    expect(await listProviders(dir)).toEqual([]);
  });

  it('removeProvider drops one entry and reports an unknown id as a miss', async () => {
    const dir = await project();
    await putProviders(dir, [
      { id: 'a', kind: 'ollama', enabled: true },
      { id: 'b', kind: 'ollama', enabled: true },
    ]);
    const hit = await removeProvider(dir, 'a');
    expect(hit.removed).toBe(true);
    expect(hit.entries.map((e) => e.id)).toEqual(['b']);

    const miss = await removeProvider(dir, 'nope');
    expect(miss.removed).toBe(false);
    expect(miss.entries.map((e) => e.id)).toEqual(['b']);
  });
});

/**
 * W10-62. `listProviders` used to read the project settings file alone, while
 * `dokima doctor` and `dokima providers refresh` read the same key through
 * `getEffectiveSettings`, which merges global. A globally-registered provider
 * was therefore reported healthy by the CLI and invisible to the resolver.
 *
 * Both directions, because a global fallback that overrides an explicit
 * project choice would be a worse bug than the one being fixed.
 */
describe('provider registry scope resolution (W10-62)', () => {
  const savedHome = process.env.DOKIMA_HOME;

  afterEach(() => {
    if (savedHome === undefined) delete process.env.DOKIMA_HOME;
    else process.env.DOKIMA_HOME = savedHome;
  });

  async function globalHome(entries: unknown): Promise<string> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-home-'));
    dirs.push(home);
    await fs.writeFile(
      path.join(home, 'config.json'),
      JSON.stringify({ [PROVIDERS_SETTINGS_KEY]: entries }),
    );
    process.env.DOKIMA_HOME = home;
    return home;
  }

  it('a global-scope provider resolves for a project that has no registry of its own', async () => {
    await globalHome([
      { id: 'lm-studio', kind: 'lm-studio', baseUrl: 'http://127.0.0.1:1234/v1', enabled: true },
    ]);
    const dir = await project();

    const entries = await listProviders(dir);

    expect(entries.map((e) => e.id)).toEqual(['lm-studio']);
    expect(entries[0]?.baseUrl).toBe('http://127.0.0.1:1234/v1');
  });

  it('a project-scope registry WINS over a global one — a fallback never beats an explicit choice', async () => {
    await globalHome([
      { id: 'lm-studio', kind: 'lm-studio', baseUrl: 'http://127.0.0.1:1234/v1', enabled: true },
    ]);
    const dir = await project();
    await putProviders(dir, [
      { id: 'ollama-box', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', enabled: true },
    ]);

    const entries = await listProviders(dir);

    expect(entries.map((e) => e.id)).toEqual(['ollama-box']);
  });

  it('no registry at either scope is still the normal first-run state, not an error (C-1)', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-home-'));
    dirs.push(home);
    process.env.DOKIMA_HOME = home;

    expect(await listProviders(await project())).toEqual([]);
  });
});
