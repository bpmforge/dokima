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
import { afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(os.tmpdir(), 'dokima-suite-home-'));
process.env.DOKIMA_HOME = home;

process.on('beforeExit', () => {
  w22_16_write(path.join(os.tmpdir(), 'w22-16-beforeExit'), 'fired');
});
/**
 * Removes it after the file's tests (W22-16).
 *
 * WHAT WAS HERE DID NOT RUN. This was `process.on('exit', rmSync)` — a
 * reasonable-looking best-effort cleanup that fired zero times. The leak it
 * was meant to prevent had reached **22,978 `dokima-suite-home-*` directories**
 * in the machine tmpdir, 86% of all Dokima temp spill, each holding a
 * DOKIMA_HOME's worth of files.
 *
 * MEASURED, NOT GUESSED. Under vitest 3.2.7 the default pool is `forks`, and
 * the pool TERMINATES its child processes rather than letting them exit. An
 * instrumented run proved it: handlers on both `exit` and `beforeExit` wrote a
 * sentinel file, and after a run neither sentinel existed. A handler on the
 * same file registered through `afterAll` did fire. Nothing about the removal
 * was wrong — it was attached to an event this process never reaches.
 *
 * PER FILE, WHICH IS WHERE THE HOME IS SCOPED ANYWAY. `setupFiles` run once
 * per test file, so this teardown pairs exactly with the `mkdtempSync` above
 * it, and a worker reused for the next file makes a fresh one. It runs after a
 * FAILING file too, which the old handler could not have managed even if it
 * had fired.
 *
 * STILL SWALLOWS ITS OWN ERROR, and for the original reason: a temp directory
 * that will not delete is untidy, while a teardown that throws would fail a
 * test file over housekeeping and hide the real result. That trade only makes
 * sense now that the common case actually runs — an unconditional catch on a
 * handler that never fires is how this went unnoticed for months.
 */
afterAll(() => {
  // RETRIED, THEN SAID OUT LOUD (W22-21). The bare `catch {}` this replaces was
  // the last place a leak could hide: `afterAll` demonstrably runs for every
  // home — an instrumented run counted 129 setups against 129 teardowns — so a
  // directory that survives anyway did so because the REMOVAL failed and
  // nothing said which one or why.
  //
  // The retries are the same shape as the e2e helper's (W22-12): a temp
  // directory that loses a race with a checkpoint being written under it is
  // ordinary and worth retrying, while one that still will not go is a real
  // failure. `force` already absorbs "already gone".
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 60 });
  } catch (err) {
    // Deliberately not a throw: failing a test FILE over housekeeping would
    // trade a leak for a red suite, and the leak is the lesser fault. But it is
    // no longer silent — validate-temp-leaks will fail the gate on the
    // directory, and this line is how the next reader learns why it is there.
    console.error(`[test-setup] could not remove ${home}:`, err);
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

/**
 * Declares that a model IS configured, for the whole apps/server suite
 * (W13-34).
 *
 * `resolveModelTarget` used to fall back to a placeholder model id at a
 * guessed endpoint when nothing was configured. A customer walkthrough on a
 * clean install showed where that leads: "Build the board" failed with
 * `env: request failed with 400 Bad Request (HTTP 500)`, because a real
 * LM Studio has no model called `local-model`. It now refuses by name instead,
 * which is what law 9(b) asks for — the model is the user's choice, "asked at
 * setup, never defaulted silently".
 *
 * Nearly every test here assumes a model exists; that assumption used to be
 * satisfied by the guess. Setting the DOCUMENTED CI seam (law 9a) states it
 * out loud instead. A test that wants the unconfigured path deletes these two
 * itself — `interview-routes.test.ts` does exactly that.
 */
process.env.DOKIMA_MODEL_BASE_URL ??= 'http://127.0.0.1:1234/v1';
process.env.DOKIMA_MODEL_ID ??= 'test-model';

