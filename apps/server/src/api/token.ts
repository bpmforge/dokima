/**
 * Single-user bearer token (D-005, SC-08). Generated once at first run into
 * `~/.dokima/token` (mode 0600, dir 0700) and reused thereafter — the
 * SPA and CLI both read the same file to authenticate against the local
 * server. No plaintext fallback path: a corrupt/empty file is treated as
 * absent and regenerated.
 */

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeDokimaHome } from '@dokima/shared';

export const TOKEN_FILENAME = 'token';
export const TOKEN_FILE_MODE = 0o600;
export const TOKEN_HOME_MODE = 0o700;

export function computeTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(computeDokimaHome(env), TOKEN_FILENAME);
}

function generateToken(): string {
  return randomBytes(16).toString('hex'); // 128-bit, D-005/SC-08
}

/** Reads the existing token, generating and persisting one on first run. */
export async function ensureAuthToken(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ token: string; tokenPath: string }> {
  const home = computeDokimaHome(env);
  await fs.mkdir(home, { recursive: true });
  await fs.chmod(home, TOKEN_HOME_MODE);
  const tokenPath = computeTokenPath(env);

  const existing = await readExistingToken(tokenPath);
  if (existing) {
    await fs.chmod(tokenPath, TOKEN_FILE_MODE);
    return { token: existing, tokenPath };
  }

  const token = generateToken();
  await fs.writeFile(tokenPath, `${token}\n`, { mode: TOKEN_FILE_MODE });
  await fs.chmod(tokenPath, TOKEN_FILE_MODE);
  return { token, tokenPath };
}

async function readExistingToken(tokenPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
