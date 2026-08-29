/**
 * Playwright E2E over the served Canvas SPA (docs/TESTING.md §7): a real
 * `vite build` served by the real apps/server, no mocked browser APIs.
 * `webServer` builds the SPA then boots the real server against a
 * throwaway `.dokima` home + project DB — no CI job here ever talks to
 * a real model provider (the fake-model-gateway fixture stands in when a
 * future ticket wires provider calls into the UI).
 */

import { defineConfig, devices } from '@playwright/test';
import { HOME, PORT, STATE_DB, WORKSPACE } from './e2e/env-paths.js';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Clears the fixed DOKIMA_HOME before every run. Without it the Fleet
  // registry accumulates across runs forever -- it reached 1,164 projects and
  // took trace.spec.ts red plus the suite from 22s to 3.7m (W9-14).
  globalSetup: './e2e/global-setup.ts',
  // Removes the temp projects the run made (W22-15). After the run, not
  // during it: a project deleted mid-run stays in the shared fleet
  // registry, and later specs then see a card whose directory has
  // vanished -- which took two suites red before this moved here.
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command:
      // W13-33: `dev-entry.ts`, not `main.ts`. The self-boot moved there because a
      // run-if-main guard inside an imported module fires on the whole bundle.
      'pnpm --filter @dokima/web run build && pnpm --filter @dokima/server exec tsx src/api/dev-entry.ts',
    env: {
      DOKIMA_HOME: HOME,
      // W13-64: pin the workspace inside the throwaway HOME. The guided
      // sample used to hardcode /tmp and this suite glob-deleted every such
      // folder on the machine — which destroyed a real walkthrough's project.
      DOKIMA_WORKSPACE_ROOT: WORKSPACE,
      // W12-43: the served core can now MINT a signing key. Without these it
      // would resolve the real macOS Keychain and write into it from an
      // automated run — the hazard W10-04 declined to introduce. No e2e spec
      // starts a build run today; this keeps that true if one ever does.
      DOKIMA_NO_KEYCHAIN: '1',
      DOKIMA_VAULT_KEY: 'e2e-vault-key-w1243',
      DOKIMA_PORT: String(PORT),
      DOKIMA_STATE_DB: STATE_DB,
    },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
