import { loadEnvFileSecretValues } from './env-secrets.js';
import type { ProjectSecretsVault } from './vault.js';

/**
 * The full extra-secret-value set for redaction (SC-06): vault-registered
 * project secrets plus the project's `.env` file values. Callers pass the
 * result to `redactDeep`/`redactString` before a context packet or event
 * payload leaves the process boundary.
 */
export async function collectSecretValues(
  vault: ProjectSecretsVault,
  projectDir: string,
): Promise<string[]> {
  const [vaultValues, envValues] = await Promise.all([
    vault.listValues(),
    loadEnvFileSecretValues(projectDir),
  ]);
  return [...vaultValues, ...envValues];
}
