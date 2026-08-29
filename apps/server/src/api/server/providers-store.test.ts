import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistryError, validateProviderRegistry } from '@dokima/gateway';
import {
  listGlobalProviders,
  listProjectProviders,
  listProviders,
  PROVIDERS_SETTINGS_KEY,
  putGlobalProviders,
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

/**
 * W10-70. W10-62 made the global scope READABLE and left no way to write it,
 * so the only route to an every-project provider was hand-editing
 * ~/.dokima/config.json. These cover the write path and the precedence, and
 * mirror the model matrix's (W10-64) so the two halves of "register once, use
 * everywhere" cannot drift apart.
 *
 * DOKIMA_HOME is pinned throughout. W10-64 learned that the hard way: a
 * global-scope test without it wrote the developer's REAL config and would
 * have pointed every project on the machine at a fixture value.
 */
describe('every-project provider registry (W10-70)', () => {
  const savedHome = process.env.DOKIMA_HOME;

  afterEach(() => {
    if (savedHome === undefined) delete process.env.DOKIMA_HOME;
    else process.env.DOKIMA_HOME = savedHome;
  });

  async function scopedHome(): Promise<string> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-prov-home-'));
    dirs.push(home);
    process.env.DOKIMA_HOME = home;
    return home;
  }

  const GLOBAL_ENTRY = {
    id: 'lm-studio',
    kind: 'oai-compat' as const,
    baseUrl: 'http://127.0.0.1:1234/v1',
    enabled: true,
  };

  it('THE ACCEPTANCE TEST: a product created later sees a provider registered once', async () => {
    await scopedHome();
    await putGlobalProviders([GLOBAL_ENTRY]);

    const brandNewProject = await project();

    expect((await listProviders(brandNewProject)).map((e) => e.id)).toEqual([
      'lm-studio',
    ]);
  });

  it('a project registry still WINS over the every-project one', async () => {
    await scopedHome();
    await putGlobalProviders([GLOBAL_ENTRY]);
    const dir = await project();
    await putProviders(dir, [
      { id: 'local-only', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', enabled: true },
    ]);

    expect((await listProviders(dir)).map((e) => e.id)).toEqual(['local-only']);
  });

  it('listProjectProviders never reports an inherited entry', async () => {
    await scopedHome();
    await putGlobalProviders([GLOBAL_ENTRY]);
    const dir = await project();

    expect(await listProjectProviders(dir)).toEqual([]);
    expect(await listProviders(dir)).toHaveLength(1);
  });

  it('a global write goes through the SAME validation — a consent-gated kind cannot slip in', async () => {
    await scopedHome();

    await expect(
      putGlobalProviders([{ id: 'gh', kind: 'copilot', enabled: true }]),
    ).rejects.toBeInstanceOf(ProviderRegistryError);

    expect(await listGlobalProviders()).toEqual([]);
  });

  it('nothing registered at either scope stays the normal first-run state (C-1)', async () => {
    await scopedHome();
    expect(await listProviders(await project())).toEqual([]);
  });
});

/**
 * W21-98, from the SAST triage. All three list functions distinguished
 * "nothing configured" from "configured but unreadable" in the CODE — the
 * `raw === undefined` guard is exactly that test — and then threw the
 * distinction away, catching the validation error and returning the same
 * empty array. A user whose registry had gone invalid saw a Settings panel
 * that said no providers were configured, which is the one thing that was
 * definitely not true.
 *
 * The panel still shows none: a broken registry has no entries to offer, and
 * throwing here would take Settings down. What changes is that the reason
 * leaves the process.
 */
describe('an unreadable provider registry is reported, not silently empty (W21-98)', () => {
  async function projectWithRegistry(raw: unknown): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w2198-providers-'));
    dirs.push(dir);
    await fs.mkdir(path.join(dir, '.dokima'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.dokima', 'settings.json'),
      JSON.stringify({ [PROVIDERS_SETTINGS_KEY]: raw }),
    );
    return dir;
  }

  it('RED FIXTURE: a registry that fails validation says so', async () => {
    // Present and wrong — not absent. `{}` is not a provider array.
    const dir = await projectWithRegistry({ nonsense: true });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await listProjectProviders(dir)).toEqual([]);
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0]?.[0])).toContain('provider registry');
    } finally {
      spy.mockRestore();
    }
  });

  it('a project with NO registry stays silent — absent is not broken', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w2198-none-'));
    dirs.push(dir);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await listProjectProviders(dir)).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
