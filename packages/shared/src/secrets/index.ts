export type { SecretPattern } from './patterns.js';
export { SECRET_PATTERNS } from './patterns.js';

export { redactDeep, redactPatterns, redactString, redactValues } from './redact.js';

export { loadEnvFileSecretValues } from './env-secrets.js';

export type { ProjectSecretsVault } from './vault.js';
export { createProjectSecretsVault } from './vault.js';

export { collectSecretValues } from './secret-values.js';
