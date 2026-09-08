import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../vitest.network-guard.ts'],
    name: 'scripts',
    environment: 'node',
    /**
     * W23-15: gate-plan.test.mjs is a `node:test` file, because AB-15's
     * focused verification is `node --test scripts/gate-plan.test.mjs`. Vitest
     * cannot run that API, and a file it collects and cannot run is a red
     * suite for no reason. It is NOT thereby a check nobody runs:
     * gate-plan.suite.test.mjs executes it as a child and fails with it, so it
     * is still part of `pnpm test`.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'gate-plan.test.mjs'],
  },
});
