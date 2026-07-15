import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CredentialStore } from '../config/credential-store.js';
import { computeShipwrightHome } from '../config/settings-files.js';

const REF_PREFIX = 'shipwright-project-secret:';
const INDEX_FILENAME = 'secrets-index.json';

export interface ProjectSecretsVault {
  register(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | undefined>;
  delete(name: string): Promise<void>;
  listNames(): Promise<string[]>;
  /** Values of every registered secret — for redaction (SC-06); never log these directly. */
  listValues(): Promise<string[]>;
}

function refFor(name: string): string {
  return `${REF_PREFIX}${name}`;
}

async function readIndex(indexPath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed)
    ? parsed.filter((v): v is string => typeof v === 'string')
    : [];
}

async function writeIndex(indexPath: string, names: readonly string[]): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const sorted = [...new Set(names)].sort();
  await fs.writeFile(indexPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/**
 * Project-scoped secrets vault (SC-06, BLUEPRINT §12.5). Values live only
 * in the OS-keychain-backed `CredentialStore` (W0-07); this index file
 * holds registered *names* only, never values — redaction needs to
 * enumerate what to scrub, but neither the macOS Keychain `security` CLI
 * nor the encrypted-file vault expose a cheap "list all" primitive, so the
 * name index is what makes `listValues()` possible without one.
 */
export function createProjectSecretsVault(
  store: CredentialStore,
  env: NodeJS.ProcessEnv = process.env,
): ProjectSecretsVault {
  const indexPath = path.join(computeShipwrightHome(env), INDEX_FILENAME);

  return {
    async register(name, value) {
      await store.set(refFor(name), value);
      const names = await readIndex(indexPath);
      if (!names.includes(name)) {
        await writeIndex(indexPath, [...names, name]);
      }
    },

    async get(name) {
      return store.get(refFor(name));
    },

    async delete(name) {
      await store.delete(refFor(name));
      const names = await readIndex(indexPath);
      await writeIndex(
        indexPath,
        names.filter((n) => n !== name),
      );
    },

    async listNames() {
      return readIndex(indexPath);
    },

    async listValues() {
      const names = await readIndex(indexPath);
      const values: string[] = [];
      for (const name of names) {
        const value = await store.get(refFor(name));
        if (value !== undefined) values.push(value);
      }
      return values;
    },
  };
}
