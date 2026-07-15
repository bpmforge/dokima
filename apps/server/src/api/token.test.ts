import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeTokenPath,
  ensureAuthToken,
  TOKEN_FILE_MODE,
  TOKEN_HOME_MODE,
} from './token.js';

describe('ensureAuthToken', () => {
  let tmpDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-token-test-'));
    env = { SHIPWRIGHT_HOME: path.join(tmpDir, '.shipwright') };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates a 128-bit hex token on first run', async () => {
    const { token, tokenPath } = await ensureAuthToken(env);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(tokenPath).toBe(computeTokenPath(env));
  });

  it('writes the token file with mode 0600 and home dir with 0700', async () => {
    const { tokenPath } = await ensureAuthToken(env);
    const fileStat = await fs.stat(tokenPath);
    const dirStat = await fs.stat(path.dirname(tokenPath));
    expect(fileStat.mode & 0o777).toBe(TOKEN_FILE_MODE);
    expect(dirStat.mode & 0o777).toBe(TOKEN_HOME_MODE);
  });

  it('reuses the same token across calls (persisted, not regenerated)', async () => {
    const first = await ensureAuthToken(env);
    const second = await ensureAuthToken(env);
    expect(second.token).toBe(first.token);
  });

  it('regenerates a fresh token when the file is empty/corrupt', async () => {
    const tokenPath = computeTokenPath(env);
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, '   \n', { mode: 0o600 });
    const { token } = await ensureAuthToken(env);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('re-enforces 0600 on a pre-existing token file with looser permissions', async () => {
    const tokenPath = computeTokenPath(env);
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, 'deadbeefdeadbeefdeadbeefdeadbeef\n', { mode: 0o644 });
    await ensureAuthToken(env);
    const stat = await fs.stat(tokenPath);
    expect(stat.mode & 0o777).toBe(TOKEN_FILE_MODE);
  });
});
