import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFileSecretValues } from './env-secrets.js';

let tmpDirs: string[] = [];

async function mkTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-env-secrets-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

describe('loadEnvFileSecretValues', () => {
  it('returns [] when no .env file exists', async () => {
    const dir = await mkTmp();
    expect(await loadEnvFileSecretValues(dir)).toEqual([]);
  });

  it('parses KEY=VALUE lines, ignoring comments and blank lines', async () => {
    const dir = await mkTmp();
    await fs.writeFile(
      path.join(dir, '.env'),
      [
        '# a comment',
        '',
        'API_KEY=super-secret-value',
        'export TOKEN=another-secret',
      ].join('\n'),
    );
    expect(await loadEnvFileSecretValues(dir)).toEqual([
      'super-secret-value',
      'another-secret',
    ]);
  });

  it('strips matching single or double quotes from values', async () => {
    const dir = await mkTmp();
    await fs.writeFile(
      path.join(dir, '.env'),
      ['DOUBLE="quoted-secret"', "SINGLE='also-quoted'"].join('\n'),
    );
    expect(await loadEnvFileSecretValues(dir)).toEqual(['quoted-secret', 'also-quoted']);
  });

  it('skips keys with empty values', async () => {
    const dir = await mkTmp();
    await fs.writeFile(path.join(dir, '.env'), 'EMPTY=\nFILLED=value\n');
    expect(await loadEnvFileSecretValues(dir)).toEqual(['value']);
  });

  it('reads a custom file name', async () => {
    const dir = await mkTmp();
    await fs.writeFile(path.join(dir, '.env.production'), 'PROD_KEY=prod-secret\n');
    expect(await loadEnvFileSecretValues(dir, '.env.production')).toEqual([
      'prod-secret',
    ]);
  });
});
