import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApiServer, type ApiServer } from '../server.js';
import { registerProject, computeFleetRegistryPath } from '../projects.js';
import { PROVIDERS_SETTINGS_KEY } from './providers-store.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4411;

const dirs: string[] = [];
let active: ApiServer | undefined;

afterEach(async () => {
  await active?.app.close();
  active = undefined;
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

const headers = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };

describe('providers routes (W10-01)', () => {
  it('starts empty and round-trips a PUT', async () => {
    const { app, id } = await boot();
    const empty = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/providers`,
      headers,
    });
    expect(empty.json()).toEqual({ providers: [] });

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
