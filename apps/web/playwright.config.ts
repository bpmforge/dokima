/**
 * Playwright E2E over the served Canvas SPA (docs/TESTING.md §7): a real
 * `vite build` served by the real apps/server, no mocked browser APIs.
 * `webServer` builds the SPA then boots the real server against a
 * throwaway `.dokima` home + project DB — no CI job here ever talks to
 * a real model provider (the fake-model-gateway fixture stands in when a
 * future ticket wires provider calls into the UI).
 */

import { defineConfig, devices } from '@playwright/test';
import { HOME, PORT, STATE_DB } from './e2e/env-paths.js';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Clears the fixed DOKIMA_HOME before every run. Without it the Fleet
  // registry accumulates across runs forever -- it reached 1,164 projects and
  // took trace.spec.ts red plus the suite from 22s to 3.7m (W9-14).
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command:
      'pnpm --filter @dokima/web run build && pnpm --filter @dokima/server exec tsx src/api/main.ts',
    env: {
      DOKIMA_HOME: HOME,
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
