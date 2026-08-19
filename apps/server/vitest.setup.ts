/**
 * Pins `DOKIMA_HOME` for the whole apps/server suite (W10-71).
 *
 * W10-62, W10-64 and W10-70 made `listProviders` and `listModelMatrix` resolve
 * the GLOBAL settings scope, which lives in `~/.dokima/config.json`. Nothing
 * pinned `DOKIMA_HOME`, so from that moment every test asserting a "nothing
 * configured" state read whatever the developer had actually configured.
 *
 * That is not hypothetical: registering a provider through the Providers panel
 * to verify W10-70 turned `main` red four tests later — providers-store's
 * round-trip, onboard-cli-integration's real-gateway run,
 * onboard-dispatch-port's C-1 env fallback, and pipeline-routes/run.test.ts's
 * own env-fallback case. Each gate was green when its ticket landed, because
 * the machine state that breaks them did not exist yet.
 *
 * Unconditional rather than `??=`: inheriting the real home IS the bug, so
 * there is nothing to preserve. A test that wants a home it controls still
 * assigns `process.env.DOKIMA_HOME` itself and overrides this — several do,
 * and they keep working.
 *
 * Per test FILE, not per run: vitest loads setup files in each worker, so two
 * files can never see each other's global settings either.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(os.tmpdir(), 'dokima-suite-home-'));
process.env.DOKIMA_HOME = home;

process.on('exit', () => {
  // Best-effort: a leaked tmp dir is untidy, a failed cleanup crashing the
  // worker on the way out would be worse.
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/**
 * Pins the FILE-BACKED credential store for the whole suite (W12-43).
 *
 * W12-43 made the signing key mintable, which means a code path under test now
 * WRITES a credential. `resolveCredentialStore` picks the real macOS Keychain
 * on darwin unless `DOKIMA_NO_KEYCHAIN` is set, and nothing set it — so the
 * suite would have written a real signing key into the developer's login
 * keychain, silently, on every run.
 *
 * That is not a hypothetical objection: plan.json records W10-04 declining to
 * add a live credential e2e for precisely this reason rather than "silently
 * writing a real secret into a dev/CI keychain from an automated test".
 *
 * The encrypted-file backend is the one `credential-store.ts`'s own header
 * names as the suite's backend: fully local, deterministic, and written under
 * the `DOKIMA_HOME` pinned above — so it is discarded with the temp dir.
 */
process.env.DOKIMA_NO_KEYCHAIN = '1';
process.env.DOKIMA_VAULT_KEY ??= 'test-vault-key-w1243';

