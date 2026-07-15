import { promises as fs } from 'node:fs';
import path from 'node:path';

const ENV_LINE_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const isDoubleQuoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  const isSingleQuoted =
    trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
  if (isDoubleQuoted || isSingleQuoted) return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Values (not keys — a key like `API_KEY` is not itself a secret) from a
 * project `.env` file, for redaction (SC-06). An absent file yields `[]`,
 * never an error — most projects have no `.env` at all.
 */
export async function loadEnvFileSecretValues(
  projectDir: string,
  fileName = '.env',
): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(projectDir, fileName), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const values: string[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = ENV_LINE_RE.exec(line);
    if (!match) continue;
    const value = stripQuotes(match[2] ?? '');
    if (value.length > 0) values.push(value);
  }
  return values;
}
