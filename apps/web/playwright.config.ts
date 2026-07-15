/**
 * Playwright E2E over the served Canvas SPA (docs/TESTING.md §7): a real
 * `vite build` served by the real apps/server, no mocked browser APIs.
 * `webServer` builds the SPA then boots the real server against a
 * throwaway `.shipwright` home + project DB — no CI job here ever talks to
 * a real model provider (the fake-model-gateway fixture stands in when a
 * future ticket wires provider calls into the UI).
 */

import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = 4402;
const HOME = path.join(os.tmpdir(), 'shipwright-web-e2e-home');
const STATE_DB = path.join(os.tmpdir(), 'shipwright-web-e2e-state.db');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command:
      'pnpm --filter @shipwright/web run build && pnpm --filter @shipwright/server exec tsx src/index.ts',
    env: {
      SHIPWRIGHT_HOME: HOME,
      SHIPWRIGHT_PORT: String(PORT),
      SHIPWRIGHT_STATE_DB: STATE_DB,
    },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
