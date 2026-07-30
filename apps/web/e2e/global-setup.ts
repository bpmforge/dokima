/**
 * Makes the E2E suite hermetic across runs (W9-14).
 *
 * `SHIPWRIGHT_HOME` is a FIXED tmp path, and `reuseExistingServer` keeps a
 * local server alive between invocations, so the Fleet registry that home
 * holds was never cleaned by anything. It had reached **1,164 projects /
 * 422KB of fleet.json**, accumulated since 2026-07-23 — every project every
 * test had ever onboarded, almost all pointing at tmp directories that no
 * longer exist.
 *
 * That is not a cosmetic leak. With that registry in place `trace.spec.ts`
 * failed two specs (the newly-onboarded project's card never appeared within
 * the 5s assertion) and the whole suite took 3.7 minutes. Cleared, the
 * identical suite passes 58/58 in 22 seconds. The server was not the
 * bottleneck — `GET /api/v1/projects` measured 286ms with all 1,164 loaded —
 * so this is client-side render volume, and the assertion in trace.spec.ts
 * was right to fail.
 *
 * Deliberately a wipe rather than a prune: a test run should not inherit ANY
 * state from a previous one, and "prune entries whose directory is missing"
 * would be a product behaviour change smuggled in as a test fix. Whether the
 * Fleet view should itself hide or prune projects whose directory has
 * vanished is a real question, but it is a product question and belongs in
 * its own ticket.
 */
import { rm } from 'node:fs/promises';
import { HOME, STATE_DB } from './env-paths.js';

export default async function globalSetup(): Promise<void> {
  // `force` so a first-ever run (nothing on disk yet) is not an error.
  await rm(HOME, { recursive: true, force: true });
  await rm(STATE_DB, { recursive: true, force: true });
  // The `-wal`/`-shm` siblings outlive the DB file itself; leaving them means
  // the next run opens a "new" database that still has a previous run's
  // uncheckpointed pages attached to it.
  await rm(`${STATE_DB}-wal`, { force: true });
  await rm(`${STATE_DB}-shm`, { force: true });
  console.log(`[e2e] cleared ${HOME} and ${STATE_DB} — starting from a clean home`);
}
