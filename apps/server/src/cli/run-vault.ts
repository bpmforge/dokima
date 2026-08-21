import {
  createProjectSecretsVault,
  NoKeychainAdapterError,
  resolveCredentialStore,
  type ProjectSecretsVault,
} from '@dokima/shared';

/**
 * run-vault.ts — chapter of run-build.ts (W14-06, 400-line cap): a verbatim
 * move of the W12-02 vault refusal, not a rewrite.
 */

/**
 * Resolves the project's secrets vault, or refuses (W12-02).
 *
 * This used to degrade to an empty vault on a `NoKeychainAdapterError`, on
 * the argument that "on such a platform `vault.register` would refuse the
 * same way, so no vault secret could ever have been stored to redact."
 * That argument is sound for a machine that has NEVER had a working store,
 * and wrong for the one path that matters: `resolveCredentialStore` also
 * accepts the encrypted-file backend behind `DOKIMA_NO_KEYCHAIN` +
 * `DOKIMA_VAULT_KEY` (P-003), so an operator on Linux CAN register secrets,
 * and `~/.dokima/vault.json` plus the project's name index then persist on
 * disk. A later run that does not carry those two variables — a service
 * unit, a cron entry, a different shell — lands here, degrades to an empty
 * list, and `collectSecretValues` hands the redaction layer nothing to
 * redact while the secrets are still very much registered. That is a silent
 * failure of the control W11-11/14/16/17 were four consecutive tickets
 * spent building, and it is the same class of failure the
 * `DOKIMA_SIGNING_KEY` check above refuses rather than papers over.
 *
 * So: refuse, and name the two variables that fix it — which is exactly
 * what `NoKeychainAdapterError`'s own message already tells the operator to
 * set. `.env` redaction (the other half of `collectSecretValues`) is
 * independent and unaffected, but it is not a substitute: it covers a
 * different secret source, so continuing on it alone would still ship an
 * unredacted vault secret.
 *
 * NOT distinguished here — "an empty vault because nothing was registered"
 * from "an empty vault we cannot read" — and that is a scope call, not an
 * oversight. The discriminator is the name index at
 * `<DOKIMA_HOME>/secrets/<projectId>/`, but `computeProjectId` and the index
 * filename are private to `packages/shared/src/secrets/vault.ts`; reaching
 * them means either widening that package's exports (outside this ticket's
 * write_scope) or re-deriving the project-id hash here, which is precisely
 * the declared-twice defect W12-01 exists to fix. A follow-up that exports a
 * `hasRegisteredSecrets(projectDir)` probe can soften this refusal to a
 * warning for projects that genuinely have none.
 */
export function resolveVaultOrRefusal(
  projectDir: string,
): { ok: true; vault: ProjectSecretsVault } | { ok: false; reason: string } {
  try {
    return {
      ok: true,
      vault: createProjectSecretsVault(resolveCredentialStore(process.env), projectDir),
    };
  } catch (err) {
    if (err instanceof NoKeychainAdapterError) return { ok: false, reason: err.message };
    throw err;
  }
}
