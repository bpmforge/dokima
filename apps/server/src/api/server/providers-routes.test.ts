import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryCredentialStore, createProjectSecretsVault } from '@dokima/shared';
import { buildApiServer, type ApiServer } from '../server.js';
import { registerProject, computeFleetRegistryPath } from '../projects.js';
import { PROVIDERS_SETTINGS_KEY } from './providers-store.js';
import { registerProvidersRoutes } from './providers-routes.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4411;

const dirs: string[] = [];
let active: ApiServer | undefined;

afterEach(async () => {
  await active?.app.close();
  active = undefined;
  if (savedDokimaHome === undefined) delete process.env.DOKIMA_HOME;
  else process.env.DOKIMA_HOME = savedDokimaHome;
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function boot(): Promise<{
  app: ApiServer['app'];
  id: string;
  projectDir: string;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-prov-home-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-prov-proj-'));
  dirs.push(home, projectDir);
  // W10-70. `fleetHome` scopes the project registry but NOT the global
  // settings file, which putGlobalSetting resolves from DOKIMA_HOME. Without
  // this a scope=global PUT writes the developer's REAL ~/.dokima/config.json
  // — W10-64 established that the hard way, on this machine.
  process.env.DOKIMA_HOME = home;
  const record = await registerProject(computeFleetRegistryPath(home), {
    path: projectDir,
    mode: 'new',
  });
  const server = await buildApiServer({
    token: TOKEN,
    port: PORT,
    isDbOpen: () => true,
    logger: false,
    fleetHome: home,
  });
  active = server;
  return { app: server.app, id: record.id, projectDir };
}

const savedDokimaHome = process.env.DOKIMA_HOME;

const headers = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };

/**
 * Registers the routes directly on a bare Fastify instance rather than
 * `buildApiServer` (W10-42 AC3): the credential-write route needs an
 * injected fake `CredentialStore` and a scoped `DOKIMA_HOME` so the test
 * never touches the real OS keychain or the developer's home directory —
 * `buildApiServer`'s call chain (`server.ts` -> `settings-routes.ts`) only
 * threads `home` through, and both files are outside this ticket's
 * write_scope to extend.
 */
async function bareBoot(): Promise<{
  app: ReturnType<typeof Fastify>;
  id: string;
  projectDir: string;
  home: string;
  store: ReturnType<typeof createInMemoryCredentialStore>;
}> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-prov-bare-home-'));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-prov-bare-proj-'));
  dirs.push(home, projectDir);
  const record = await registerProject(computeFleetRegistryPath(home), {
    path: projectDir,
    mode: 'new',
  });
  const store = createInMemoryCredentialStore();
  const app = Fastify();
  registerProvidersRoutes(app, {
    home,
    credentialStore: store,
    env: { DOKIMA_HOME: home },
  });
  await app.ready();
  return { app, id: record.id, projectDir, home, store };
}

describe('providers routes (W10-01)', () => {
  it('starts empty and round-trips a PUT', async () => {
    const { app, id } = await boot();
    const empty = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/providers`,
      headers,
    });
    // W10-70 added `scope`, reporting where the returned entries came from. A
    // project with no registry of its own resolves the every-project one, so an
    // empty result reads as 'global' — nothing is project-scoped yet.
    expect(empty.json()).toEqual({ providers: [], scope: 'global' });

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: {
        providers: [
          {
            id: 'lm-studio',
            kind: 'oai-compat',
            base_url: 'http://127.0.0.1:1234/v1',
            credential_ref: 'keychain:lmstudio',
            enabled: true,
          },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().providers[0]).toMatchObject({
      id: 'lm-studio',
      base_url: 'http://127.0.0.1:1234/v1',
      credential_ref: 'keychain:lmstudio',
    });
  });

  /**
   * RED FIXTURE (Law 8 / FR-S2). The refusal must be WHOLESALE and must land
   * BEFORE persistence — "stored then scrubbed" would leave the caller
   * believing their credential was accepted, and would have written it to disk
   * in the meantime.
   */
  it('REFUSES a literal credential outright and persists nothing', async () => {
    const { app, id, projectDir } = await boot();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: {
        providers: [
          {
            id: 'oops',
            kind: 'oai-compat',
            base_url: 'http://127.0.0.1:1234/v1',
            credential_ref: 'sk-abcdefghijklmnopqrstuvwxyz012345',
            enabled: true,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().rule).toBe('literal-credential-refused');

    // Asserted against the bytes on disk, not the API response.
    const settingsPath = path.join(projectDir, '.dokima', 'settings.json');
    const raw = await fs.readFile(settingsPath, 'utf8').catch(() => '{}');
    expect(raw).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(JSON.parse(raw)[PROVIDERS_SETTINGS_KEY]).toBeUndefined();
  });

  /** RED FIXTURE (D-019): the consent gate is not bypassable through the registry. */
  it('refuses to enable copilot without a ledgered consent ack (403)', async () => {
    const { app, id } = await boot();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: { providers: [{ id: 'copilot', kind: 'copilot', enabled: true }] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().rule).toBe('consent-required');
  });

  it('explains a malformed entry with a named rule rather than a bare 400', async () => {
    const { app, id } = await boot();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: { providers: [{ id: 'x', kind: 'oai-compat', enabled: true }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().rule).toBe('missing-base-url');
  });

  it('DELETE removes one entry (204) and 404s on an unknown id', async () => {
    const { app, id } = await boot();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: { providers: [{ id: 'gone', kind: 'ollama', enabled: true }] },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${id}/providers/gone`,
      headers,
    });
    expect(del.statusCode).toBe(204);

    const miss = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${id}/providers/never`,
      headers,
    });
    expect(miss.statusCode).toBe(404);
  });

  /** FR-S3: every settings write is audited. */
  it('appends a settings.changed event for the registry write', async () => {
    const { app, id, projectDir } = await boot();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: { providers: [{ id: 'audited', kind: 'ollama', enabled: true }] },
    });
    const { openEventLogReader } = await import('@dokima/events');
    const db = openEventLogReader(path.join(projectDir, '.dokima', 'state.db'));
    try {
      const rows = db
        .prepare("SELECT payload FROM events WHERE event_type = 'settings.changed'")
        .all() as { payload: string }[];
      expect(rows.some((r) => r.payload.includes(PROVIDERS_SETTINGS_KEY))).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('GET providers/:providerId/models (W10-42 AC2)', () => {
  it('404s for a providerId not in the registry', async () => {
    const { app, id } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/providers/never-registered/models`,
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  /**
   * `source` must distinguish `discovered` from `bundled` (AC2). A live
   * `discovered` result isn't reachable through this route in a no-network
   * test (`buildCatalogProvider` constructs the real adapter internally —
   * no `fetchImpl` injection point — and CLAUDE.md law 9 forbids live
   * network in tests); that half of the contract is covered at the unit
   * level by `packages/gateway/src/catalog/resolve.test.ts`'s "reachable"
   * cases. This proves the `bundled` half survives the wire, not just the
   * unreachable/null-source case below: an unreachable `ollama` endpoint
   * falls back to `content/model-catalog/catalog.v1.json`'s 8 bundled
   * entries, still marked `unreachable` with its reason, never presented
   * as if it were live.
   */
  it('an unreachable ollama endpoint reports source: bundled with the offline catalog, distinct from discovered', async () => {
    const { app, id } = await boot();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: {
        providers: [
          {
            id: 'offline-ollama',
            kind: 'ollama',
            base_url: 'http://127.0.0.1:9/v1',
            enabled: true,
          },
        ],
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/providers/offline-ollama/models`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('unreachable');
    expect(body.source).toBe('bundled');
    expect(body.models.length).toBeGreaterThan(0);
    expect(typeof body.reason).toBe('string');
    expect(body.reason.length).toBeGreaterThan(0);
  });

  /**
   * RED FIXTURE (W9-15 honest-absence): an unreachable endpoint must report
   * `source: null` + a `reason`, never a silently empty list presented as
   * "no models". `oai-compat` has no bundled catalog entry
   * (content/model-catalog/catalog.v1.json only ships ollama/lm-studio), so
   * this is the sharpest case: bundled fallback is unavailable too.
   */
  it('an unreachable oai-compat endpoint reports unreachable/null-source with a reason, never an empty-looking ok', async () => {
    const { app, id } = await boot();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: {
        providers: [
          {
            id: 'dead-endpoint',
            kind: 'oai-compat',
            base_url: 'http://127.0.0.1:9/v1',
            enabled: true,
          },
        ],
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/providers/dead-endpoint/models`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('unreachable');
    expect(body.source).toBeNull();
    expect(body.models).toEqual([]);
    expect(typeof body.reason).toBe('string');
    expect(body.reason.length).toBeGreaterThan(0);
  });

  /** RED FIXTURE (UX_SPEC §6a "Cloud kind selected"): the copy quoted there is the copy, not a paraphrase. */
  it('a registered but not-yet-constructible cloud kind reports the exact UX_SPEC copy as reason', async () => {
    const { app, id } = await boot();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: { providers: [{ id: 'oa1', kind: 'openai', enabled: true }] },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/providers/oa1/models`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('unreachable');
    expect(body.source).toBeNull();
    expect(body.reason).toBe(
      'provider kind "openai" is registered but not yet constructible from the pipeline: it needs a resolved credential and a real price table (W10 follow-up). Local kinds (ollama, lm-studio, oai-compat) work today.',
    );
  });
});

describe('POST providers/credentials (W10-42 AC3)', () => {
  it('registers the secret in the keychain and returns only the ref name', async () => {
    const { app, id, projectDir, home, store } = await bareBoot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/providers/credentials`,
      payload: { name: 'lmstudio-key', value: 'sk-fake-0123456789abcdef' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ref: 'lmstudio-key' });

    const vault = createProjectSecretsVault(store, projectDir, { DOKIMA_HOME: home });
    expect(await vault.get('lmstudio-key')).toBe('sk-fake-0123456789abcdef');
  });

  it('400s when name or value is missing', async () => {
    const { app, id } = await bareBoot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/providers/credentials`,
      payload: { name: 'only-a-name' },
    });
    expect(res.statusCode).toBe(400);
  });

  /**
   * RED FIXTURE (Law 8 / FR-S2). The literal value must never land in the
   * settings file, the event log, or the vault's own on-disk name index
   * (names only, by `vault.ts`'s own design) — asserted against bytes on
   * disk, not the API response.
   */
  it('never persists the literal secret to settings.json, the event log, or the vault name index', async () => {
    const { app, id, projectDir, home } = await bareBoot();
    const SECRET = 'sk-super-secret-abcdefghijklmnop';
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/providers/credentials`,
      payload: { name: 'red-fixture-key', value: SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain(SECRET);

    const settingsPath = path.join(projectDir, '.dokima', 'settings.json');
    const settingsRaw = await fs.readFile(settingsPath, 'utf8').catch(() => '{}');
    expect(settingsRaw).not.toContain(SECRET);

    const dbPath = path.join(projectDir, '.dokima', 'state.db');
    const dbExists = await fs
      .access(dbPath)
      .then(() => true)
      .catch(() => false);
    if (dbExists) {
      const { openEventLogReader } = await import('@dokima/events');
      const db = openEventLogReader(dbPath);
      try {
        const rows = db.prepare('SELECT payload FROM events').all() as {
          payload: string;
        }[];
        expect(rows.some((r) => r.payload.includes(SECRET))).toBe(false);
      } finally {
        db.close();
      }
    }

    const indexPath = path.join(home, 'secrets');
    const projectHashDirs = await fs.readdir(indexPath).catch(() => [] as string[]);
    for (const dir of projectHashDirs) {
      const raw = await fs.readFile(
        path.join(indexPath, dir, 'secrets-index.json'),
        'utf8',
      );
      expect(raw).not.toContain(SECRET);
      expect(raw).toContain('red-fixture-key');
    }
    expect(projectHashDirs.length).toBeGreaterThan(0);
  });
});

/**
 * W10-70: the write path for the every-project registry, mirroring the model
 * matrix's (W10-64). Without it, W10-62's global READ was unreachable except
 * by hand-editing ~/.dokima/config.json.
 */
describe('providers scope (W10-70)', () => {
  it('defaults to project scope when the body names none', async () => {
    const { app, id } = await boot();

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: {
        providers: [
          { id: 'local', kind: 'oai-compat', base_url: 'http://127.0.0.1:1234/v1', enabled: true },
        ],
      },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().scope).toBe('project');

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/providers`,
      headers,
    });
    expect(get.json().scope).toBe('project');
  });

  it('registers for every project when scope is global, and reports it as inherited', async () => {
    const { app, id } = await boot();

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: {
        scope: 'global',
        providers: [
          { id: 'shared-box', kind: 'oai-compat', base_url: 'http://127.0.0.1:1234/v1', enabled: true },
        ],
      },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().scope).toBe('global');

    // The project has no registry of its own, so the GET resolves the global
    // one and says so — that is what the panel renders as inherited.
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/providers`,
      headers,
    });
    expect(get.json().scope).toBe('global');
    expect(get.json().providers[0]).toMatchObject({ id: 'shared-box' });
  });

  it('refuses an unknown scope rather than silently narrowing it to project', async () => {
    const { app, id } = await boot();

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: {
        scope: 'everywhere',
        providers: [{ id: 'x', kind: 'ollama', enabled: true }],
      },
    });

    expect(put.statusCode).toBe(400);
    expect(put.json().rule).toBe('invalid-scope');
  });

  it('a global write still refuses a literal credential (FR-S2 is not scope-dependent)', async () => {
    const { app, id } = await boot();

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/providers`,
      headers,
      payload: {
        scope: 'global',
        providers: [
          {
            id: 'x',
            kind: 'oai-compat',
            base_url: 'http://127.0.0.1:1234/v1',
            credential_ref: 'sk-abcdefghijklmnopqrstuvwx',
            enabled: true,
          },
        ],
      },
    });

    expect(put.statusCode).toBe(400);
    expect(put.json().rule).toBe('literal-credential-refused');
  });
});
