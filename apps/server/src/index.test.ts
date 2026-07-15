import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from './index.js';

describe('apps/server buildServer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-server-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('assembles a working API server against a real project event log', async () => {
    const dbPath = path.join(tmpDir, 'state.db');
    const { app } = await buildServer({ port: 0, dbPath, token: 'test-token' });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { host: '127.0.0.1:0' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', db: true, ws: true });
    } finally {
      await app.close();
    }
  });
});
